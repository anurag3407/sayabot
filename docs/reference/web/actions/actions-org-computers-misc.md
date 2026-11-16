# Workspace, Invites, Profiles, Facts, Memory & Computers (Server Actions)

This page covers the workspace lifecycle and personal-data actions: creating workspaces, inviting humans by email or link, member roles, the onboarding wizard, room schedules, owner facts (what bots know about you), memory items, computer start/stop, phone pairing, and the guest-to-account merge used by desktop guest mode.

Source files: `apps/web/src/lib/actions/orgs.ts`, `apps/web/src/lib/actions/invites.ts`, `apps/web/src/lib/actions/workspace-invites.ts`, `apps/web/src/lib/actions/profile.ts`, `apps/web/src/lib/actions/facts.ts`, `apps/web/src/lib/actions/memory.ts`, `apps/web/src/lib/actions/computers.ts`, `apps/web/src/lib/actions/onboarding.ts`, `apps/web/src/lib/actions/guest-merge.ts`, `apps/web/src/lib/actions/phones.ts`, `apps/web/src/lib/workspace-invites.ts`, `apps/web/src/lib/guest-merge.ts`, `apps/web/src/lib/facts.ts`, `apps/web/src/lib/computers.ts`

---

## 🏢 Workspace CRUD and members (`actions/orgs.ts`)

### `createOrg(_prev, formData)`

Authenticated action (`requireUser("/onboarding")`). Name 2–60 chars; an optional custom slug must match `^[a-z0-9][a-z0-9-]{1,47}$` and is run through `uniqueOrgSlug` (reserved-route aware — `shared.ts:62`). Inserts `orgs` then `org_members` with `role: "owner"`; if the owner row fails, the org is deleted (`orgs.ts:47`). Audit `org.created`, then `redirect("/<slug>")`.

### Email invitations

`findUserByEmail(email)` (`orgs.ts:61`) pages through Supabase auth users (up to 10 pages × 200) to match by lowercase email. Both invite actions build the origin from `NEXT_PUBLIC_SITE_URL`, the request `origin` header, or the `host` header fallback (`orgs.ts:94`), and point new users at `/auth/complete?next=/...`:

- `inviteMember(_prev, formData)` (`orgs.ts:73`) — org-admin. Role ∈ `owner | admin | member`; only an owner can invite another owner. Existing users get an `org_members` row; new users get `auth.admin.generateLink({ type: "invite", ... })` (falling back to `inviteUserByEmail`), whose `action_link` is the email's join URL. Optional `roomIds` are filtered to non-DM rooms of the org and the new member is upserted into `room_members` + `room_reads`. Non-existing users also get a `workspace_invites` row (`kind: "email"`). Audit `member.invited`, then `sendWorkspaceInviteEmail({ email, inviterName, workspaceName, role, joinUrl, isExistingUser })` — email failures are logged, not fatal (`orgs.ts:197`). Returns "Member added" or "Invitation sent".
- `inviteToRoom(_prev, formData)` (`orgs.ts:210`) — room-admin (DM rooms refused). If the person exists but is not in the workspace, the caller must be an org admin ("that grants access to the whole workspace"). New users are created as members of the org with a `workspace_invites` row carrying `room_ids: [roomId]`; the room membership + read marker follow. Audit `room.member_invited` (metadata: `newAccount`, `newToWorkspace`), then `sendRoomInviteEmail({ email, inviterName, roomName, joinUrl })`.

### Renaming, removal, roles, SSO

- `renameWorkspaceAction(_prev, formData)` (`orgs.ts:333`) — org-admin, name 2–60; audit `org.renamed`.
- `removeMemberAction(input)` (`orgs.ts:356`) — org-admin plain-object action; cannot remove yourself; removing an owner requires owner rights and at least one remaining owner. Because room membership has no FK to the org row, the member's `room_members` and `room_reads` rows are cleared explicitly before deleting `org_members` (`orgs.ts:378`). Audit `member.removed`.
- `setMemberRole(_prev, formData)` (`orgs.ts:402`) — org-admin; owner promotion and demotion of owners need owner rights, and a workspace always keeps at least one owner. Audit `member.role_changed` with `from`/`to`.
- `updateSso(_prev, formData)` (`orgs.ts:447`) — refuses when `ssoEnabled()` is false for the deployment (env `SSO_ENABLED`, see the configuration reference); owner-only; toggles `orgs.sso_enabled`. Audit `org.sso_changed`.

---

## ✉️ Workspace invite links (`actions/workspace-invites.ts`)

Single-use and permanent join links stored in `workspace_invites` with codes from `generateJoinCode()`; links are `` `${getAppUrl()}/join/<code>` `` (`workspace-invites.ts:14`). `LINK_TTL_MS` = 24 h (`workspace-invites.ts:12`).

- `createInviteLinkAction({ orgSlug, kind: "link" | "permanent", role, roomIds? })` (`workspace-invites.ts:33`) — org-admin. `kind: "link"` gets `max_uses: 1` + 24-hour expiry; `kind: "permanent"` never expires and is deduplicated — one live permanent link per role with no rooms, so re-asking returns the same URL (`workspace-invites.ts:45`). Room ids are cleaned against the org's non-DM rooms. Audits `invite.link_created` / `invite.permanent_link_created`; returns `{ id, url, expiresAt }`.
- `revokeInviteAction(input)` (`workspace-invites.ts:91`) — org-admin; stamps `revoked_at`. An unused **email** invite whose user never signed in (`last_sign_in_at` null) also removes the person from `room_members` and `org_members` (owners excepted) — "since they never signed in" (`workspace-invites.ts:103`). Audit `invite.revoked`.
- `checkJoinCode(code)` (`workspace-invites.ts:128`) — shared by the join page and the accept action. Codes must match `^j_[A-Za-z0-9_-]{16,64}$`; then revocation, expiry, and use-count checks produce precise failure reasons ("turned off", "expired", "already used"); success returns `{ inviteId, orgId, orgSlug, orgName, role, roomIds, inviterName }` (inviter from `created_by` → `profiles`).
- `acceptInviteAction(code)` (`workspace-invites.ts:163`) — requires a signed-in user (`/join/<code>` as `next`). New members first pass `planGate(orgId, "members")` ("… is full on its current plan"); the use-count is claimed with an optimistic `.eq("use_count", previous)` guard so a single-use link cannot be claimed twice by racing tabs (`workspace-invites.ts:187`). Joins as the invite's role, upserts into the invite's rooms + `room_reads`, audits `invite.accepted`, then redirects to the single room or the workspace.

`lib/workspace-invites.ts` supports the settings list: `loadPendingInvites(orgId)` (`workspace-invites.ts:21`) returns up to 100 non-revoked invites as `PendingInviteView` rows — email invites only while the user has not signed in, links only while unexpired and under `max_uses`, with `url = "<app>/join/<code>"` when a code exists.

### External bot key invite (`actions/invites.ts`)

`createRoomBotKey(_prev, formData)` (`invites.ts:25`) — room-admin action, plan-gated (`planGate(orgId, "agents")`). Given a client id (`normalizeClient`, default `claude-code`) and optional handle, it creates an `external` agent (handle synthesized as `<client-slug>-<base36 time>` when omitted, `invites.ts:44`), links it into the room, and issues a room-scoped `agent_api_keys` row with scopes `room:read, room:write, tasks:read, tasks:write, canvas:read, canvas:write, secrets:use` (`invites.ts:88`). Any failure removes the created agent. Returns — **once** — the raw `apiKey`, the MCP connection URL `` `${appUrl}/mcp/<apiKey>` ``, the client config `snippet` (`getClientConfigSnippet`), and an invitation `prompt` (`formatInvitationMessage`). Audit `invite.bot_key_created`.

---

## 👤 Profile (`actions/profile.ts`)

`updateProfileAction(_prev, formData)` (`profile.ts:9`) — self-service: display name 1–60, notification mode `all | mentions | off`, sound flag, and an optional avatar that must be a `data:image/(png|jpeg|webp);base64,` URL ≤ 300 KB or an https URL (`profile.ts:23`). Merges `preferences` (notifications + sound) and updates `profiles`; revalidates the root layout. No audit entry (own profile).

`setAlertModeAction(mode)` (`profile.ts`) writes only `preferences.notifications` (`all | mentions | off`) for the signed-in person. The bot sidebar uses it so changing alerts does not require a display name or photo. Revalidates the root layout. No audit entry.

`setAlertSoundAction(on)` writes only `preferences.sound`. The sidebar disables the toggle while notifications are off. Revalidates the root layout. No audit entry.

---

## 📝 Owner facts (`actions/facts.ts` + `lib/facts.ts`)

Owner facts are what bots know about you — room-scoped or workspace-wide. Write access (`canWriteScope`, `facts.ts:15`): a room fact needs room admin; a fact "for every room" needs org admin.

- `saveOwnerFactAction(input)` (`facts.ts:28`) — the key comes from `canonicalFactKey(label)`; edits keep the existing key, and moving a fact between "this room" and "every room" checks rights on **both** scopes (the old row is deleted and re-upserted, `facts.ts:48`). Writes via `upsertFact` (`lib/facts.ts:22` — canonical key, value trimmed to `MAX_FACT_VALUE`, label defaults to `humanizeFactKey(key)`, source `manual` or `answer`). After saving, `resolveOpenAsksFromFacts` sweeps open keyed questions — the message even reports "Saved, and answered N waiting question(s)" (`facts.ts:81`). Audit `owner_fact.saved`.
- `deleteOwnerFactAction(input)` (`facts.ts:84`) — scope-checked delete; audit `owner_fact.deleted`; message "Forgotten".

`lib/facts.ts` also holds the machinery shared with the inbox answer flow (see the rooms/messages reference):

- `factsVisibleTo(orgId, roomId)` (`facts.ts` (lib)`:57`) — workspace-wide facts plus the room's own (`.or("room_id.is.null,room_id.eq.<roomId>")`, capped at 500).
- `resolveOpenAsksFromFacts({ orgId, roomIds: string[] | null, userId, skipTaskIds? })` (lib `facts.ts:74`) — scans up to 100 open `kind: "request"` tasks (expiry-aware), fills their keyed ask items from facts, and delivers answers with the intro "Already answered:"; `null` roomIds sweeps the whole org.
- `deliverItemAnswers(input)` (lib `facts.ts:127`) — posts a human message with `@handle` prefix in-group (metadata `requestAnswer`, `answeredKeys`, `dmToAgentId` for DM delivery), queues the room message, and closes the task through `mutateTaskInOrchestrator` when `remaining === 0` (otherwise updates `tasks.metadata.items`).

---

## 🧠 Memory (`actions/memory.ts`)

Memory rows in `memories` with scope `agent | room | org` (derived from the input: room → `room`, agent → `agent`, else `org` — `memory.ts:38`):

- `rememberAction(input)` (`memory.ts:20`) — room- or org-level access (no admin requirement). Body required, ≤ 2048 chars; title defaults to the first 80 chars of the body. Both title and body are scrubbed with `redactSecrets()` before insert (`memory.ts:32`); rows are `kind: "fact"`, `source: "human"`, `confidence: 1.0`. Revalidates the room and agents pages. Returns `data.memoryId`.
- `deleteMemoryAction(orgSlug, memoryId)` (`memory.ts:72`) — org-scoped hard delete; revalidates settings.
- `togglePinMemoryAction(orgSlug, memoryId, pinned)` (`memory.ts:92`) — flips `pinned` within the org; revalidates settings.

---

## 🖥️ Computers (`actions/computers.ts` + `lib/computers.ts`)

- `stopComputerAction(_prev, formData)` (`computers.ts:16`) — org-admin form action. Calls computerd `POST {COMPUTERD_URL}/v1/computers/<agentId>/stop` (5 s timeout, `x-internal-secret` from `ORCHESTRATOR_INTERNAL_SECRET`; computerd failures are logged and ignored — the DB row is still updated), then sets `agent_computers.status = "stopped"` scoped by org. Audit `computer.stopped`.
- `startComputerAction(_prev, formData)` (`computers.ts:63`) — org-admin. Calls computerd `POST /v1/computers/<agentId>/ensure` with `{ orgId }` (10 s timeout), then sets `status: "running"` + `started_at`. Audit `computer.started`.

`listComputers(userId, orgId, role)` (`lib/computers.ts:21`) builds the Computers page list from `desktop_hosts` (non-revoked, own or shared with the workspace), filtered through `canOpenHost({ ownerId, viewerId, hostOrgId, whoCanControl, viewerOrgRole })` from `@sayabot/core`, enriched with owner names, `hostOnline(lastSeenAt)` liveness, local agents and host settings → `ComputerView` (`computers.ts` (lib)`:6`).

---

## 🧭 Onboarding & schedules (`actions/onboarding.ts`)

- `setupWorkspaceAction(_prev, formData)` (`onboarding.ts:32`) — authenticated, **once per user** (refuses when an `org_members` row exists, `onboarding.ts:54`). Creates org + owner membership + a private room (`turn_mode: "mentions"`, `turn_cap: 3`, chosen timezone) + room member/schedule/read rows, records `preferences.timezone` and `preferences.onboarding = { orgSlug, roomId }`, seeds a "Room notes" markdown canvas, and audits `workspace.onboarding_created`. Any failure deletes the org so nothing half-exists (`onboarding.ts:131`).
- `saveRoomScheduleAction(_prev, formData)` (`onboarding.ts:136`) — room-admin, DM rooms refused ("Direct chats do not run meetings"). Validates timezone, parses `HH:MM` times via `parseTimeToMinutes` (morning 09:00–09:30, evening 17:00–17:30, check-in window 09:00–17:30 defaults), interval 15–480 min, duration 5–60 min, `checkinMode` `stream` (default) | `digest`. Upserts `room_schedules` and syncs `rooms.timezone`; audit `room.schedule_changed`.
- `finishOnboardingAction(orgSlug, roomId)` (`onboarding.ts:202`) — room-admin. Clears `preferences.onboarding`; if the room has no prior onboarding message, posts the welcome turn: with agents in the room, a human message mentioning `all_bots` ("Introduce yourself in one sentence…") is queued through `queueRoomMessage`; without agents, a system "Welcome to \<room\>." message. Returns `{ path, queued }`.

---

## 👻 Guest merge (`actions/guest-merge.ts` + `lib/guest-merge.ts`)

Desktop guest mode creates anonymous Supabase users; merging promotes them to real accounts:

- `lib/guest-merge.ts` — tickets in `account_merge_tickets` (30-minute TTL, `MERGE_TTL_SECONDS`, cookie `sayabot_guest_merge`, `guest-merge.ts:14`).
  - `createMergeTicket(guestUserId)` (`guest-merge.ts:21`) — returns the raw base64url ticket; only `hashTicket` (SHA-256) is stored.
  - `findMergeTicket(token)` (`guest-merge.ts:39`) — returns `{ id, guestUserId }` for unused, unexpired tickets (tokens ≤ 200 chars).
  - `summarizeGuest(guestUserId)` (`guest-merge.ts:60`) — workspaces (via `org_members`) and computer hosts (`desktop_hosts`) that will move.
  - `completeGuestMerge(token, targetUserId)` (`guest-merge.ts:81`) — claims the ticket (optimistic `used_at` update; released again on failure), runs the SQL function `merge_guest_into_user` (`rpc("merge_guest_into_user", { p_guest, p_target })`, from migration 0031) which re-checks guest/target validity, then deletes the now-empty guest user via `auth.admin.deleteUser`. Returns `{ ok, firstWorkspaceSlug }` or a friendly error.
- `confirmGuestMergeAction(formData)` (`guest-merge.ts` (actions)`:10`) — the `/auth/merge/finish` form handler: returns `void`/redirects rather than `ActionResult`. Anonymous or missing sessions are bounced to `/login?force=true&merge=1`; the ticket is read from the httpOnly cookie, the merge runs, the cookie is deleted, and the user lands on `next` (the desktop flow passes `/auth/desktop`) or their first workspace.

---

## 📱 Phone pairing (`actions/phones.ts`)

Phone devices pair to a person via one-time codes in `device_pairings`:

- `createPhonePairingAction(input)` (`phones.ts:21`) — workspace-member action. Deletes the person's previous `waiting` pairing ("one live code per person"), generates a code (`generatePairingCode`), stores only its `hashAgentApiKey` hash with a 10-minute expiry (`PAIRING_TTL_MINUTES`, `phones.ts:28`), and returns the formatted code, `pairingDeepLink(code, server)`, the server URL, `reach` and `expiresAt`. The server URL is the address a phone can actually open, from `phoneServerUrl(getAppUrl(), requestOrigin, lanIPv4())` in `src/lib/phone-reachable.ts`. `requestOrigin` comes from the `x-forwarded-host`/`host` and `x-forwarded-proto` headers. Order of preference:
  1. The browser's own address, if it isn't loopback (a domain, a Cloudflare tunnel, a LAN IP).
  2. The configured `NEXT_PUBLIC_APP_URL`, if it isn't loopback.
  3. That URL with this machine's Wi-Fi IPv4 (192.168.x preferred) in place of `localhost`, keeping the port.

  `reach` is `"anywhere"` (a public host), `"same-wifi"` (a private address) or `"this-computer"` (nothing reachable). So a Mac running Sayabot itself hands out `http://192.168.x.x:3000` instead of `http://localhost:3000`.
- `phonePairingStatusAction(input)` (`phones.ts:52`) — polls the pairing (own only) and reports `status` (an expired `waiting` reads as `expired`), `deviceName`, `platform`.
- `revokePhoneAction(input)` (`phones.ts:69`) — own phones only; sets `status: "revoked"`, `revoked_at`, clears `device_token_hash`; audit `phone.revoked`.

---

## 🧾 Rows written by these actions

| Table | Written by | Columns of note |
| :--- | :--- | :--- |
| `org_members` | `createOrg`, `setupWorkspaceAction`, invites, `acceptInviteAction` | `role` ∈ `owner \| admin \| member`; the first member of a new workspace is always `owner`. |
| `workspace_invites` | `inviteMember`, `inviteToRoom`, `createInviteLinkAction` | `kind` ∈ `email \| link \| permanent`, `code`, `role`, `room_ids`, `max_uses` (1 for single-use links, `null` for permanent), `use_count`, `last_used_at`, `expires_at`, `revoked_at`, `created_by`. |
| `device_pairings` | phone pairing actions + `POST /api/mobile/pair` | `code_hash`, `status` ∈ `waiting \| paired \| revoked`, `device_name`, `platform`, `device_token_hash`, `expires_at`, `last_seen_at`, `revoked_at`. |
| `memories` | `rememberAction` | `scope` ∈ `agent \| room \| org`, `kind: "fact"`, `source: "human"`, `confidence: 1.0`, `title`/`body` (secret-redacted), `tags`, `pinned`, `created_by_user_id`. |
| `owner_facts` | `upsertFact` | Keyed by `(org_id, key, room_id)` — a `null` `room_id` is the workspace-wide row; `source` ∈ `answer \| manual`; `source_task_id` links inbox answers. |
| `agent_computers` | `createBotAction`, start/stop actions | `profile`, `status` ∈ `none \| stopped \| running`, Docker volume name `saaya-bot-<agentId>`, `started_at`, `last_active_at`. |
| `agent_templates` | `saveAgentAsTemplate` | Org-scoped slug, name/description/category, system prompt, parsed capabilities, `default_model`, `secret_slots`, `starter_tasks`. |

## 🧭 What onboarding leaves behind

`setupWorkspaceAction` creates, in one transaction (org deleted again on any failure): the `orgs` row, the owner `org_members` row, a private room (`turn_mode: "mentions"`, `turn_cap: 3`), the owner as room `admin`, a `room_reads` row, a `room_schedules` row for the chosen timezone, a "Room notes" markdown canvas seeded with `# <room name>`, and `profiles.preferences = { timezone, onboarding: { orgSlug, roomId } }`. `finishOnboardingAction` later clears the `onboarding` key and posts the welcome turn — a human message mentioning `all_bots` when the room has agents (queued to the orchestrator), otherwise a system "Welcome to \<room\>." message.

## 💻 Computer start/stop semantics

Both computer actions call computerd best-effort: `stop` uses a 5-second timeout and `ensure` a 10-second one, with `x-internal-secret` from `ORCHESTRATOR_INTERNAL_SECRET`; a computerd failure is logged and does **not** stop the DB update (`computers.ts:39`, `computers.ts:87`). The database row (`agent_computers.status`) is the UI's source of truth — `stopped` or `running` with `started_at` — while the real container lifecycle (sleep, LRU eviction, wake-and-retry) is computerd's business (see the computerd reference docs). The Computers page list, shared with the phone via `GET /api/mobile/computers`, comes from `listComputers` in `lib/computers.ts` and additionally reflects each Mac's `whoCanControl` sharing setting through `canOpenHost`.

---

## 📱 The pairing handshake end to end

1. The web modal calls `createPhonePairingAction` — previous `waiting` codes are deleted ("one live code per person"), a fresh code is stored hashed, and the modal shows the formatted code plus the deep link (`pairingDeepLink(code, server)`).
2. The phone POSTs the code to `/api/mobile/pair`, which claims the row (`waiting` + unexpired) and returns a magic-link token plus the device token (documented in the mobile API reference).
3. The modal polls `phonePairingStatusAction`; the row is now `paired` with the device's name and platform, so the UI flips to "connected".
4. Whenever the phone opens, `GET /api/mobile/device` compares its device token and stamps `last_seen_at`; `revokePhoneAction` (or the same endpoint's `revoked` state) makes the next check-in answer `revoked`, which is how "Remove this phone" takes effect.

Codes are stored only as `hashAgentApiKey` digests, the TTL is `PAIRING_TTL_MINUTES` (10 minutes), and `revokePhoneAction` clears `device_token_hash` so a removed phone's token can never re-pair.

---

Related docs: [Onboarding](../pages/onboarding.md), [Settings UI](../pages/settings-ui.md), [Computers & remote UI](../pages/computers-remote-ui.md), [Auth flows](../pages/auth-flows.md), [Auth & authorization](../../architecture/auth-and-authorization.md), [Editions & licensing](../../architecture/editions-and-licensing.md)
