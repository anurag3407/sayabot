# Agents UI

The agents surface has three screens: the workspace roster (`/agents`) with per-agent usage bars, inline model pickers and a compact "More settings" form; a one-field "new bot" page (`/agents/new`) that creates the bot and opens its chat; and the bot profile page (`/agents/[agentId]`) with basics, runtime, computer, secret grants, connector scoping and assigned tasks. Day-to-day edits (name, look, standing instructions, reply style, tools, memory notes, skills, computer, routines, access, model effort, permissions, alerts) happen in the chat's right sidebar — see [Room chat UI](./room-chat-ui.md). Two creation APIs coexist deliberately: `createAgent` (the full form, kinds `llm`/`external`) and `createBotAction` (name + prompt, everything else chosen later from the chat).

Source files: `apps/web/src/app/(workspace)/[org]/agents/page.tsx`, `agents/new/page.tsx`, `agents/[agentId]/page.tsx`, `apps/web/src/components/agents/*`, `apps/web/src/lib/actions/agents.ts`, `apps/web/src/lib/actions/bots.ts`

---

## 📋 Agents Roster (`/agents`)

The page (`agents/page.tsx`) is a server component; `maxDuration = 60` because it builds live model lists:

1. `requireOrgAccess` + `isOrgAdmin` decide `canEdit`; non-admins get read-only rendering with "Only workspace admins can change agents."
2. Loads agents, provider keys, MCP servers and rooms (DM rooms excluded from "add to room").
3. Usage: `loadUsageRollup(orgId, since=30d)` + `usageByAgent` produce per-agent token/cost/request stats rendered as a bar scaled to the busiest agent, plus a workspace header row (Tokens · 30 days, Replies & runs, Spend) linking to `/analytics`.
4. Models: admins get `loadWorkspaceModels({ access, host, keys, agents })` — the same PickerGroups as the title-bar picker (see the [model system](./model-system.md)). Non-admins (or when the catalog is empty) fall back to a minimal group list built from raw keys.
5. **Fallback model display**: when the server has no Saya model configured (`devModelConfigured()` false), an agent with no key and no runner is shown as answering through the first ready CLI app on the server (`agents/page.tsx:67`).

Each agent row shows a mascot (green dot when active in the last 24 h — `activeRecently` checks `usage.lastAt` within a day), "Created here" vs "Invited" badge (`agent.kind === "external"`), and:

- **Model control** — `AgentModelPicker` for `kind === "llm"` (saves via `setAgentModelAction`); "Uses its own app's model" for `external`.
- **Test** — `AgentTestButton` (admins, llm only).
- **More settings** `<details>` — an `ActionForm` over `updateAgent` with handle/name, system prompt (llm), webhook URL (external), plus an Advanced area with raw `params` JSON and MCP-server checkboxes (`toolIds`). LLM agents carry hidden `providerKeyId`/`model` fields so the form doesn't clobber a picker-set model.
- **Delete** — `DeleteAgentButton` with confirm ("This removes it from every room and deletes direct chats with it. Its messages in rooms stay.").

Admins also get an **Add agent to a room** section: an `ActionForm` over `addAgentToRoom` (from `src/lib/actions/rooms.ts`) with agent + room selects ("Agents reply in the order they were added"; debate order is set in room settings), and the `AddAgentChooser` header button.

`AddAgentChooser` (`add-agent-chooser.tsx`) opens a two-card dialog: "Create a new agent" (links to the Marketplace `?tab=agents` and `/agents/new`) and "Invite one you already use" (Hermes, Claude Code, Codex, Cursor…) which picks a room and opens `InviteBotDialog` (`src/components/room/invite-bot-dialog.tsx`). Without rooms it offers "Make a room first →".

## ➕ New Bot (`/agents/new`)

The page accepts `?template=<slug|id>` (from the Marketplace; template usable if global or org-owned) and `?room=<id>` (from a group chat's "Add bot"). `NewBotForm` (`new-bot-form.tsx`) is intentionally minimal — name (≤60, live mascot reacts) and optional system prompt — and calls:

```typescript
// apps/web/src/components/agents/new-bot-form.tsx:51
const result = await createBotAction({ orgSlug, name, instructions: systemPrompt, templateId, roomId })
```

On success it toasts any warning (e.g. plan-gated computer) and `router.push`es to `result.data.path`.

### `createBotAction` (`lib/actions/agents.ts:294`)

1. `adminOrgAccess` + `planGate(orgId, "agents")` (plan limits).
2. Optionally loads the `agent_templates` row (global or org-owned) for its system prompt and `default_capabilities`.
3. `resolveModelChoice` with the optional `keyId`/`model` — usually null, meaning "server default"; a `host:…` keyId is validated against the caller's own Mac.
4. Merges capabilities: `DEFAULT_CAPABILITIES` ← template defaults ← request overrides. On Cloud, `planGate(orgId, "computers")` may strip the `computer` capability and return a warning instead of failing.
5. Derives the handle from the name (`handleFromName`: NFKD-slug, `bot-` prefix when it can't start with a letter, reserved handles suffixed) and de-clashes with `-2`, `-3`…
6. Inserts the agent (`owner_user_id` = the Mac owner when the choice was a Mac), creates the `agent_computers` row (volume `saaya-bot-<agentId>`) when it has a computer, and either joins the given group room (`room_agents` at the end of `position` order, path = that room) or **opens a 1:1 DM** via `ensureBotDmRoom` (`src/lib/bot-dm.ts`).
7. Audits `agent.created` and returns `{ agentId, handle, path }`.

## 🔧 Full Create Form (`agent-create-form.tsx`)

`AgentCreateForm` is the classic `useActionState` form over `createAgent` (used where the full kind/model/MCP control is wanted). Notable behaviours:

- Name auto-fills the handle via `handleFromName` (`src/lib/agent-handle.ts`) until the handle is edited.
- Kind select: "AI model (uses an API key)" vs "Bring your own bot (ChatGPT, Claude, Gemini, Cursor via MCP, or a webhook)". External agents take an optional webhook URL; leaving it empty means they connect over MCP from their owner's client.
- Model select from saved keys (label · provider · `•••• last4`) plus "Server default model" when available; model input has a `MODEL_SUGGESTIONS[provider]` datalist that resets when the key changes.
- `noModelAvailable` (llm + no keys + no server model) disables submit with a link to `/settings/keys`.
- Optional "add to room" select; Advanced area with params JSON + MCP server checkboxes ("Leave all unchecked to allow every enabled server").
- On success: resets the form, toasts, refreshes, and **auto-tests** the new llm agent via `testAgent` ("Finding out now beats a failed reply in the room later", `agent-create-form.tsx:57`); external agents with a webhook get a one-time webhook secret display with `CopyButton`.

### `createAgent` / `updateAgent` (`lib/actions/agents.ts`)

Shared `validateAgentFields` (`agents.ts:40`) enforces one rule set for both actions:

| Field | Rule |
| :--- | :--- |
| `handle` | lowercase, regex `/^[a-z][a-z0-9-]{0,38}$/` — "Use lowercase letters, numbers and hyphens, starting with a letter" |
| reserved handles | `all_bots`, `human`, `system`, `moderator` ("That handle is reserved") |
| `displayName` | 1–60 chars |
| `params` | parseable JSON (`parseJsonObject` from `src/lib/actions/shared.ts`) |
| `toolIds` | repeated form values filtered to strings (MCP server ids) |
| `providerKeyId` + `model` | "A model id is required when a provider key is attached" (`kind === "llm"`) |
| `webhookUrl` | "Webhook URL must start with http(s)://" — "External agents without a webhook connect over MCP from their owner's own client." |

`createAgent` verifies the key belongs to the org, gates on plan (`planGate(orgId, "agents")`), generates a webhook secret for external+webhook agents (sealed with `sealSecret(secret, getKek())` into `webhook_secret_enc`), and appends the agent to `room_agents` positionally (max existing `position` + 1) when `roomId` given. Uniqueness violations (PG `23505`) return "@handle already exists". Success returns `{ agentId, kind, webhookSecret }` with a message that prioritizes the one-time secret ("Copy the webhook secret now."), then room join, then plain creation. `updateAgent` re-validates the same fields against the **existing** kind and audits `agent.updated`.

## 🧾 Bot Profile (`/agents/[agentId]`)

A server component querying with the admin client: the agent with `agent_computers`, unrevoked `agent_secret_grants` (with `vault_secrets(label, last4)`), the latest 10 assigned `tasks` (as `MESH-<number>`), connector grants and workspace connectors. Header: avatar initial, `@handle · kind`, and a "Save as Template" `ActionForm` over `saveAgentAsTemplate` (from `src/lib/actions/templates.ts`) for admins. Sections:

- **`BotBasicsForm`** — name + system prompt, saving through `updateBotBasicsAction` (prompt truncated to 20k). The save also renames the bot's DM room to match (`agents.ts:468`). Submit stays disabled until something changed.
- **Model & Runtime card** — read-only `runsOnLabel(agent)` (from `src/lib/runs-on.ts`), engine/maxSteps/temperature from `params`, then:
  - **`WorksOnForm`** — the shared `WorksOnPicker` + a "This computer can use the Mac screen" checkbox, submitting `setAgentWorksOnAction` on Save. Non-admins see a static "Works on <label>" line.
  - **`WorksOnPicker`** (`src/components/agents/works-on-picker.tsx`) — five tiles from `WORKS_ON_TILES` (`src/lib/works-on.ts`): Auto, **Cloud desktop**, Private desktop (`local_vm`), This computer, Off. Choosing Cloud desktop picks the first set-up provider (else Boat) and shows a **Cloud provider** switch — Boat | Self-hosted VPS | E2B (`CLOUD_PROVIDERS` in `lib/computer-providers-shared.ts`) — with that provider's description and setup status from `getComputerProvidersAction` (fetched once per workspace per page load; `forgetComputerProviders` drops the cache after a Settings save). An unset provider shows "Not set up yet" with a link to `/settings/keys#computers` for admins. The same picker is used in the room side panel's Screen tab and the bot config panel's Computer section.
  - **`MacOffForm`** — only when `params.runner.hostId` is set: what to do while the Mac is off — `auto` (server model if any, else wait), `server`, `wait` (holds messages up to 15 minutes), `fail` (tells you) — saved by `setAgentWhenMacOffAction`.
- **Capabilities card** — `parseCapabilities(agent.capabilities)` rendered as chips, enabled ones highlighted, disabled struck through.
- **Persistent Computer** (when `capabilities.computer`) — `ComputerPanel` (`src/components/room/computer-panel.tsx`) with the container status/profile/last-active.
- **Secret Grants** — read-only list of `$ENV_NAME (vault label)` rows with allowed hosts and truncated placeholder, linking to `/settings/vault`.
- **`AgentConnectorScopeManager`** — Tier-2 connector scoping (below).
- **Assigned Tasks** — latest 10 with status chips.

### Connector scoping (`agent-connector-scope.tsx`)

`AgentConnectorScopeManager` lists existing grants (connector name + source chip + human-readable scopes: folders, `#channels`/chats, repos, recipients, vaults, "Read only", or "Full workspace access for this connector") with Revoke buttons (window `confirm`, then `deleteAgentConnectorGrant` from `src/lib/actions/connectors.ts`). The grant form adapts per connector `source`: Google Drive folder IDs, Slack channels, Discord channel IDs / Telegram chat IDs, WhatsApp recipient numbers, 1Password/Bitwarden/Proton Pass vaults, GitHub `owner/repo` lists, and a "Read only" checkbox for messaging sources. Submission builds a `FormData` and calls `saveAgentConnectorGrant` — the exact scope fields are documented with the connector actions in `docs/reference/web/actions/`.

## ⚡ Test & Delete

- **`AgentTestButton`** calls `testAgent(orgSlug, agentId)`, which rejects external agents ("checked in their webhook delivery log"), invokes `testAgentInOrchestrator` (`src/lib/orchestrator.ts` — the orchestrator runs a real turn), and returns `@handle replied in <latency> ms via <model>` with the reply — **both error and reply pass through `redactSecrets().text`** before leaving the server (`agents.ts:269`).
- **`DeleteAgentButton`** (`delete-agent-button.tsx`) confirms and calls `deleteAgentAction`, which deletes the agent's DM rooms outright ("A direct chat with a deleted agent could never get another reply"), scrubs the agent from any `debate_order` arrays, deletes the agent row (rooms/messages cascade per schema), audits `agent.deleted`, and refreshes.

## 🔑 External-Agent Credentials (`lib/actions/bots.ts`)

Three admin-gated actions for `kind === "external"` agents only:

| Action | Behaviour |
| :--- | :--- |
| `issueAgentApiKey({ orgSlug, agentId, label })` | `generateAgentApiKey()` (`@sayabot/core/server`); stores only `prefix` + `key_hash` + `scopes: ["messages:write"]` in `agent_api_keys`; audits with last4; returns the raw token once ("Copy it now; it is not shown again"). |
| `rotateWebhookSecret({ orgSlug, agentId })` | New `generateWebhookSecret()` sealed into `webhook_secret_enc` via `sealSecret(secret, getKek())`; returns the plaintext once with "Update the bot before it receives its next turn." |
| `revokeAgentApiKey({ orgSlug, keyId })` | Sets `revoked_at`; verifies the key's agent belongs to the caller's org. |

## 🎛️ Model Actions (`lib/actions/agents.ts` recap)

- **`setAgentModelAction`** — the agent-card picker: validates via `resolveModelChoice`, writes `provider_key_id` / `model` / `params.effort` (added/removed only when effort was supplied) / `params.runner` (deleted when the choice isn't a runner), and **claims ownership** (`owner_user_id`) when a Mac was chosen — "A Mac only runs its owner's bots." Audits `agent.model_changed` or `agent.runner_set`; message: "@handle now uses <label>".
- **`setRoomAgentModelAction`** — the chat picker: verifies the bot is in the room; `scope: "default"` delegates to `setAgentModelAction` then clears `room_agents.model_override`; `clear` just clears the override; `scope: "chat"` stores the full resolved choice as `model_override` JSON `{ keyId, model, effort, providerKeyId, agentModel, runner }` — refusing Mac choices for bots the caller doesn't own ("Use 'Chat + bot default' to take it over"). Audits `room.agent_model_set`.
- **`refreshModelListsAction`** — clears the provider-model and plan-usage caches, then force-refreshes the models.dev catalog, the manifest, and (when the server runs on a personal machine) the Codex and Claude CLI catalogs. Cache schedules otherwise: models.dev daily, manifest hourly, CLI lists 6 h, key lists 10 min, plan usage 45 s (`agents.ts:481`).

---

## Related docs

- [Model system](./model-system.md) — the picker panel, catalog and `resolveModelChoice` internals
- [Room chat UI](./room-chat-ui.md) — where invite dialogs and model overrides surface in chat
- [Settings UI](./settings-ui.md) — `/settings/bots` (external-agent MCP entry points) and the vault
- [Onboarding](./onboarding.md) — the wizard's step 3 calls `createAgent` + `addAgentToRoom`
- ../../database/schema-agents-and-templates.md — `agents`, `agent_computers`, `agent_api_keys`, `agent_templates`
- ../../architecture/turn-lifecycle.md — what a tested turn runs through
- Action signatures (`createAgent`, `createBotAction`, `setAgentModelAction`, connector grants) are catalogued in `docs/reference/web/actions/`.
