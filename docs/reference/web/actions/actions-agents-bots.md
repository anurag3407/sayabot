# Agents, Bots, Bot Invites & Templates (Server Actions)

Agents are the tenants of Sayabot's engine: `llm` agents run on a provider model, `external` agents are bots from other apps that connect over MCP or webhooks. This page covers the server actions that create and edit agents, the one-step bot creation flow, external-agent credentials, the bot invite-code lifecycle (including key minting when a bot joins), bot DM rooms, and saving agents as reusable templates.

Source files: `apps/web/src/lib/actions/agents.ts`, `apps/web/src/lib/actions/bots.ts`, `apps/web/src/lib/actions/bot-invites.ts`, `apps/web/src/lib/actions/templates.ts`, `apps/web/src/lib/bot-invites.ts`, `apps/web/src/lib/bot-dm.ts`, `apps/web/src/lib/agent-handle.ts`

---

## 🧠 Creating and editing agents (`agents.ts`)

### `createAgent(_prev, formData)`

Org-admin only (`adminOrgAccess`), then a `planGate(orgId, "agents")` quantity check (`agents.ts:88`). Fields are validated by `validateAgentFields` (`agents.ts:40`):

- `handle` must match `/^[a-z][a-z0-9-]{0,38}$/` and avoid the reserved set `all_bots`, `human`, `system`, `moderator` (`agents.ts:35`).
- `displayName` must be 1–60 characters.
- `params` is a JSON-object text field parsed with `parseJsonObject`.
- `toolIds` is a multi-value form field (`formData.getAll`).
- A provider key, when given, must exist in the same org (`agents.ts:91`); `llm` agents with a key require a `model`.
- `external` agents may set `webhookUrl`, which must start with `http(s)://` (`agents.ts:62`).

Behavior on create (`agents.ts:99`):

- `external` + webhook URL generates a signing secret via `generateWebhookSecret()` (from `@sayabot/core/server`), sealed at rest with `sealSecret(secret, getKek())` into `agents.webhook_secret_enc`.
- The `agents` row is inserted with org, handle, display name, kind, `provider_key_id`, `model`, `system_prompt`, `params`, `tool_ids`, `webhook_url`.
- A unique-violation (`23505`) becomes "`@handle` already exists".
- An optional `roomId` links the agent into a non-DM room of the same org at the next `room_agents.position`.
- Audit `agent.created`, `revalidateOrg`, and — for external webhook agents — return `webhookSecret` once in `data` with the message "Copy the webhook secret now." (`agents.ts:158`).

### `updateAgent(_prev, formData)`

Same validation, but the agent's `kind` is loaded from the existing row and cannot be changed (`agents.ts:177`). Updates handle, display name, provider key, model, system prompt, params, tool ids, and webhook URL; unique violations are again mapped to a friendly message. Audit `agent.updated`.

### `deleteAgentAction(input)`

Plain-object action (org admin). Beyond deleting the `agents` row it cleans up references so rooms stay consistent (`agents.ts:228`):

- Deletes any DM room where the agent is the bot side (`rooms.agent_dm_agent_id = agentId`) — a dead DM could never reply.
- Filters the agent out of every `rooms.debate_order` array that contains it.
- Audit `agent.deleted`.

### `testAgent(orgSlug, agentId)`

Org-admin action that refuses external agents ("checked in their webhook delivery log") and calls `testAgentInOrchestrator` (`POST /internal/agents/:agentId/test`, see the [server actions overview](server-actions-overview.md)). Both the reply text and any error are scrubbed with `redactSecrets()` before returning (`agents.ts:269`).

---

## 🤖 One-step bot creation (`createBotAction`)

The streamlined "new bot" path takes a plain object: `{ orgSlug, name, instructions?, keyId?, model?, templateId?, capabilities?, roomId? }` (`agents.ts:294`). It is org-admin gated and plan-gated (`planGate(orgId, "agents")`).

1. **Template**: when `templateId` is set, `agent_templates` is loaded and accepted if it is global (`org_id` null) or belongs to the org (`agents.ts:321`).
2. **Model**: `resolveModelChoice` resolves `keyId`/`model` — a provider key, a `host:…` Mac key, or null for the server default — using the request host from `x-forwarded-host`/`host` headers (`agents.ts:330`). `choice.runner` and `choice.effort` land in `agents.params`.
3. **Capabilities**: merged `DEFAULT_CAPABILITIES` + template defaults + caller overrides, run through `parseCapabilities` (`agents.ts:341`). If the plan does not cover computers, `capabilities.computer` is silently downgraded and a `warning` is attached to the result instead of failing (`agents.ts:347`).
4. **Handle**: `handleFromName` (local to `agents.ts:277`) slugs the display name (max 32 chars, `bot-` prefix when it would not start with a letter, reserved names get `-bot`); collisions get numeric suffixes `name-2`, `name-3`, … by scanning existing handles (`agents.ts:369`).
5. **Rows created**: the `agents` insert carries `capabilities`, `template_id`, and `owner_user_id` (the Mac owner when the key belongs to one, else the caller — `agents.ts:385`). With the `computer` capability an `agent_computers` row is created: profile from capabilities, `status: "none"`, Docker volume name `saaya-bot-<agentId>` (`agents.ts:393`).
6. **Destination**: with `roomId` (a non-DM room of the org) the bot joins it and `data.path` points at that room; otherwise `ensureBotDmRoom` opens the 1:1 chat and `path` points there (`agents.ts:404`).
7. Audit `agent.created` with the template slug and model label, then `revalidateOrg`. Result message: "`<Name>` is ready", with `data: { agentId, handle, path }` plus the computer `warning` when downgraded.

### `updateBotBasicsAction(input)`

Changes only `display_name` (1–60 chars) and `system_prompt` (trimmed, capped at 20,000 chars); the handle stays so @mentions keep working (`agents.ts:444`). The bot's DM room is renamed to match the new display name. Audit `agent.updated`.

---

## 🧭 Model and runner selection

- `refreshModelListsAction(orgSlug)` (`agents.ts:485`) — org-admin action that clears `@sayabot/llm/models` caches (`clearProviderModelCache`, `clearPlanUsageCache`) and force-refreshes the models.dev catalog, the model manifest, and — when the request host is a locally allowed one (`localDetectionAllowed`) — the Codex and Claude CLI model lists. Result: "Model lists refreshed".
- `setAgentModelAction(input)` (`agents.ts:507`) — the model picker on an agent card. `providerKeyId: null` means "use the server's default model". LLM agents only; `resolveModelChoice` decides the final `provider_key_id` / `model` / `params.runner` / `params.effort`, and picking a Mac key sets `owner_user_id` to that Mac's owner ("a Mac only runs its owner's bots"). Audit `agent.model_changed`, or `agent.runner_set` when a runner was chosen.
- `setRoomAgentModelAction(input)` (`agents.ts:572`) — the picker inside a chat with `scope: "chat" | "default"`.
  - `scope: "default"` (without `clear`) delegates to `setAgentModelAction`, then clears `room_agents.model_override` so the chat follows the bot everywhere.
  - `clear` just removes the override and keeps the bot's default.
  - `scope: "chat"` writes a `model_override` object `{ keyId, model, effort, providerKeyId, agentModel, runner }` onto `room_agents` after checking that a Mac pick belongs to the bot's owner (`agents.ts:627`). Audit `room.agent_model_set`.

### Desktop placement (`setAgentWorksOnAction`, `setAgentWhenMacOffAction`)

- `setAgentWorksOnAction` (`agents.ts:665`) stores `params.worksOn` — one of `off | auto | this_computer | local_vm | boat | vps` (labels: Off, Auto, This computer, Local VM, Boat, Your own VPS) plus `params.computer.thisComputer`. `auto` never creates or wakes a Boat; the agent calls `select_computer`. Audit `agent.works_on`.
- `setAgentWhenMacOffAction` (`agents.ts:698`) stores `params.whenMacOff` ∈ `{ auto, server, wait, fail }` — what happens to a message that arrives while the bot's Mac is offline; `auto` deletes the key (system default). No audit entry for this one.

---

## 🔑 External-agent credentials (`bots.ts`)

### `issueAgentApiKey(input: { orgSlug, agentId, label })`

Org-admin action for `external` agents only (`bots.ts:24`). Generates a key with `generateAgentApiKey()` and stores only `prefix`, `key_hash` (and `last4` in the audit metadata) in `agent_api_keys` with `scopes: ["messages:write"]` and a label trimmed to 60 chars (`bots.ts:27`). The plaintext `token` is returned exactly once in `data`. Audit `agent_api_key.issued`.

### `rotateWebhookSecret(input)`

For `external` agents only (`bots.ts:59`): generates a fresh webhook secret, seals it into `agents.webhook_secret_enc`, and returns the plaintext once. Audit `agent.webhook_secret_rotated`.

### `revokeAgentApiKey(input)`

Soft-revokes by setting `revoked_at`; both the key and its owning agent must belong to the caller's org (`bots.ts:96`). Audit `agent_api_key.revoked` with the key prefix.

---

## 🎟️ Bot invite codes (`actions/bot-invites.ts`)

Invites let an outside bot (Claude Code, Hermes, any MCP-capable client) join one room through a single-use URL. The view type `BotInviteView` (`bot-invites.ts:17`) carries the URL, a copy-paste `message` built by `botInviteMessage({ roomName, ownerName, url })`, the normalized client label, the join-request fields, and the expiry.

- `createBotInviteAction({ orgSlug, roomId, name?, app? })` (`bot-invites.ts:69`) — room-admin gated (`adminRoomAccess`). Inserts a `bot_invites` row with a `generateBotInviteCode()` code, optional expected name and app (normalized via `normalizeClient`), creator, and `expires_at` = now + `BOT_INVITE_TTL_DAYS` (7 days, `packages/core/src/bot-invite.ts:10`). Audit `bot_invite.created`; returns the invite view.
- `botInviteStatusAction({ orgSlug, inviteId })` (`bot-invites.ts:104`) — polled by the add-bot dialog so it flips to "asked to join" without a reload; returns the current view.
- `decideBotInviteAction({ orgSlug, inviteId, approve })` (`bot-invites.ts:124`) — room-admin action for a bot that opened the link and is waiting. Only valid while the computed state is `pending`.
  - Decline sets `status: "declined"` with decider and timestamp; audit `bot_invite.declined`.
  - Approve plan-gates (`planGate(orgId, "agents")`), creates an `external` agent (`visibility: "org"`, `owner_user_id` = approver, `bio` = the bot's stated about text), with a handle from `uniqueHandle` (`bot-invites.ts:112` — `handleFromName` plus numeric suffixes), links it into the room, and flips the invite to `approved` guarded by `.eq("status", "pending")`. Any failure (link race, member insert) deletes the just-created agent. Audit `bot_invite.approved`; message: "Approved @handle. It connects on its next check."
- `revokeBotInviteAction({ orgSlug, inviteId })` (`bot-invites.ts:203`) — cancels a link that is still `waiting` or `pending`; anything else is refused ("This link can no longer be cancelled").

Invite states are computed by `botInviteState({ status, expiresAt })` from `@sayabot/core`: `waiting` / `pending` / `expired` / `joined` / `declined` (e.g. an expired `pending` request reads as `expired` — see the tests at `packages/core/src/bot-invite.test.ts:9`).

---

## 📥 Joining: URL, polling and key minting (`lib/bot-invites.ts`)

This server-only module backs the public `bot/[code]` routes (documented in the webhooks/OAuth API reference) and the actions above.

- `botInviteUrl(code)` → `` `${getAppUrl()}/bot/${code}` `` (`bot-invites.ts:46`).
- `loadBotInviteByCode(code)` — validates the code shape `bi_` + 10–64 URL-safe chars, then loads the row (`bot-invites.ts:50`).
- `BotInviteRow` (`bot-invites.ts:19`) — the `bot_invites` table shape, including the join request fields, `poll_token_hash`, `agent_id`, `joined_at`, and `rejected_attempts` (an array of `{ at, app?, userAgent? }`).
- `roomContext(roomId)` (`bot-invites.ts:60`) — room name, owner display name (from `rooms.created_by` → `profiles`), timezone; used to phrase invite messages and setup instructions.
- `pollTokenMatches(row, authorization)` (`bot-invites.ts:80`) — constant-time compare of a `Bearer` poll token's `hashAgentApiKey` digest against `poll_token_hash`, so a bot can poll "has anyone approved me?" without a session.
- `collectBotKey(row)` (`bot-invites.ts:94`) — the one-time key mint:
  1. Claims the invite by updating `approved → joined` guarded on status; two racing polls yield exactly one winner.
  2. Loads the approved agent and generates an agent API key.
  3. Inserts `agent_api_keys` with `room_ids: [roomId]` and the fixed scope set `ROOM_BOT_SCOPES` (`bot-invites.ts:9`): `room:read`, `room:write`, `tasks:read`, `tasks:write`, `canvas:read`, `canvas:write`, `secrets:use`; label `"<client> via invite link for #<room>"`.
  4. If the key insert fails, the invite is reverted to `approved` so the bot can retry on its next poll.
  5. Returns `connectionUrl` = `` `${getAppUrl()}/mcp/${key.token}` `` — the token lives in the MCP path — plus `generateSetupInstructions(...)` with handle, names, room, timezone and client, and posts a system message "`@handle` joined the room from `<client>`." (`bot-invites.ts:146`). Audit `bot_invite.joined` with `actorType: "agent"`.

---

## 💬 Bot DM rooms (`lib/bot-dm.ts`)

`ensureBotDmRoom({ orgId, userId, agentId, agentName })` (`bot-dm.ts:4`) guarantees every human/agent pair has a private chat:

- Returns the existing room found by `rooms.agent_dm_user_id` + `rooms.agent_dm_agent_id`.
- Otherwise inserts a `kind: "dm"` room named after the agent, `turn_mode: "mentions"`, `turn_cap: 3`, timezone UTC, and the DM markers on the room. A `23505` from a concurrent create is resolved by re-querying (`bot-dm.ts:38`).
- Adds the human as room `admin` (`room_members`), the agent at `room_agents.position: 0`, and a `room_reads` row stamped `last_read_at`.
- `letScopedKeysReachDm` (`bot-dm.ts:64`) appends the DM room id to `room_ids` of every non-revoked `agent_api_keys` for that agent, so a bot invited to a room can also read/write its private chat — otherwise an inbox answer could never reach it.

---

## 🏷️ Handle generation (`lib/agent-handle.ts`)

`handleFromName(name)` (`agent-handle.ts:4`) is the client-side helper used by the create-agent form and onboarding wizard to suggest a handle: NFKD-normalize, strip combining marks, lowercase, non-alphanumerics to `-`, drop leading non-letters and trailing hyphens, cap at 39 characters. The server keeps its own stricter variants (max 32 + `bot-` fallback in `agents.ts:277`, and `@sayabot/core`'s version inside the invite flow), so a suggested handle is always re-validated server-side.

---

## 📋 Saving an agent as a template (`templates.ts`)

`saveAgentAsTemplate(_prev, formData)` (`templates.ts:16`) — org-admin form action:

1. Loads the agent (must be in the org) with `system_prompt`, `model`, `capabilities`, `tool_ids`.
2. Converts the agent's active `agent_secret_grants` (non-revoked) into template `secret_slots` — `{ name, label, required: true, allowedHosts, inject }` per grant (`templates.ts:54`).
3. Inserts an `agent_templates` row: org-scoped, slug = `<name-slug>-<base36 timestamp>`, name/description/category (`general` default), system prompt, parsed capabilities, `default_model`, secret slots, `starter_tasks: []`.
4. Audit `template.created`; returns the template in `data`.

---

Related docs: [Agents UI](../pages/agents-ui.md), [Room chat UI](../pages/room-chat-ui.md), [Security model](../../architecture/security-model.md), [Turn lifecycle](../../architecture/turn-lifecycle.md), [Auth & authorization](../../architecture/auth-and-authorization.md)
