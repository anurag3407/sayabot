# Proxy, Files & Utility Routes

The remaining API surface of the web app: the catch-all `/api/v1` proxy to the orchestrator and computerd (including mobile tool approvals and computer control), the message-send endpoint behind the offline outbox, the attachment file route, provider/model/usage read endpoints, server identity and health probes, remote-desktop session setup, workspace activity and routines endpoints, the guest merge entry, Supabase's auth email hook, and app download redirects.

Source files: `apps/web/src/app/api/v1/[...path]/route.ts`, `apps/web/src/app/api/messages/route.ts`, `apps/web/src/app/api/files/[...path]/route.ts`, `apps/web/src/app/api/providers/local/route.ts`, `apps/web/src/app/api/providers/saya/route.ts`, `apps/web/src/app/api/usage/local/route.ts`, `apps/web/src/app/api/instance/route.ts`, `apps/web/src/app/api/health/route.ts`, `apps/web/src/app/api/version/route.ts`, `apps/web/src/app/api/remote/sessions/route.ts`, `apps/web/src/app/api/remote/sessions/[id]/route.ts`, `apps/web/src/app/api/connectors/copilot/route.ts`, `apps/web/src/app/api/connectors/models/route.ts`, `apps/web/src/app/api/connectors/models/room/route.ts`, `apps/web/src/app/api/workspaces/[org]/activity/route.ts`, `apps/web/src/app/api/workspaces/[org]/routines/route.ts`, `apps/web/src/app/api/workspaces/[org]/routines/[id]/route.ts`, `apps/web/src/app/api/workspaces/[org]/routines/[id]/run/route.ts`, `apps/web/src/app/api/account/merge/route.ts`, `apps/web/src/app/api/auth/send-email/route.ts`, `apps/web/src/app/api/download/{android,apk,mac}/route.ts`

---

## 🌉 The `/api/v1` catch-all proxy (`api/v1/[...path]/route.ts`)

The web's general gateway to the engine: `GET`/`POST`/`DELETE /api/v1/<path…>` is forwarded to `ORCHESTRATOR_URL/v1/…` — except `computers/…` paths, which go to `COMPUTERD_URL/v1/…` (`v1/[...path]/route.ts:322`). `maxDuration = 300` for long streams.

**Auth:** `authenticateUser` (`v1/[...path]/route.ts:15`) — `authorization: Bearer <supabase token>` first, else the web session cookie; `401 { error: "unauthorized" }` where required. Path segments must match `^[A-Za-z0-9_-]+$` (no dots, slashes or traversal — `404 "not found"` otherwise, `v1/[...path]/route.ts:272`).

Special-cased inside the proxy (all other paths stream straight through with the caller's `authorization` header plus MCP/thread headers, and the reply's `content-type`, `www-authenticate`, `allow`, `mcp-session-id`; `x-accel-buffering: no` keeps live streams unbuffered):

- **Tool approvals** — `POST /v1/tools/<toolCallId>/approve` is handled locally (`v1/[...path]/route.ts:31`), body `{ approved?: boolean }`: the `tool_calls` row must be `pending_approval` (`400`/`404` otherwise); a step on someone's Mac is the Mac owner's to allow (checked by `macApprovalBlock`), everything else requires a room admin or org owner/admin (`v1/[...path]/route.ts:104`). Writes `approved_by` / `resolved_at`, fires `rpc("notify_tool_resolution")` to wake the waiting engine, and audits `tool.approved` / `tool.rejected`. This is the phone app's approval path.
- **Other `/tools/…` paths are refused** with `403 { error: "forbidden" }` — the orchestrator's internal tool endpoints are never exposed (`v1/[...path]/route.ts:282`).
- **Computer control** — every `computers/…` route is authorized by `authorizeComputerAccess` (`v1/[...path]/route.ts:153`): resolve the org from `agent_computers` (falling back to `agents`), require org membership, and require the **admin** role for `DELETE` (`v1/[...path]/route.ts:305`). `POST /v1/computers/<agentId>/stop` (the phone's stop button) is handled locally as an admin-only action that calls computerd `POST /v1/computers/<agentId>/stop` (5 s timeout, internal secret) and stamps `agent_computers.status = "stopped"` (`v1/[...path]/route.ts:234`); `exec` steps are audited as `computer.exec` before forwarding. Computer routes forward with `x-internal-secret` added to the caller's own auth.

---

## 💬 Sending messages — `POST /api/messages`

The endpoint the offline outbox flushes against (see the rooms/messages actions reference). **Auth:** Supabase bearer or session. Body `{ orgSlug, roomId, content, threadRootId?, clientId? }` — string-typed fields required (`400 "invalid fields"`, JSON errors `400 "invalid JSON"`). Room access is resolved with the caller's own client (`404 "room not found"`), the write goes through `insertHumanMessage` (validation, thread normalization, `clientId` idempotency — see the actions reference), and `queueRoomMessage` kicks the engine.

**Response:** `{ messageId, queued, warning? }` — `queued: false` carries the warning "Saved; the agent queue is unreachable." (`messages/route.ts:74`).

## 📎 Attachments — `GET /api/files/[...path]`

Serves chat attachments stored by `POST /api/mobile/upload`. **Auth:** `userFromRequest` (bearer or session). Only `rooms/<roomId>/…` paths are served (UUID room, no `..` or embedded slashes — `404 { error: "not found" }` otherwise, `files/[...path]/route.ts:12`), and only to people who can read that room through RLS (`404` again when not). On success it mints a **60-second signed URL** for the private `attachments` bucket and `302`-redirects to it with `cache-control: private, max-age=30` (`files/[...path]/route.ts:19`).

---

## 🧠 Provider & model endpoints

- `GET /api/providers/local` (`providers/local/route.ts:17`) — session-auth (`requireRouteUser`). When the server itself runs on the caller's machine (`localDetectionAllowed(host)`) it scans locally via `detectLocalAgents()` and answers `{ available: true, agents, source: "server" }`; otherwise it reads the caller's five most recent Mac hosts and reports the signed-in agent apps of the most recently seen Mac that reported any (`source: "mac"`, with `hostName`, `lastSeenAt`, `appVersion`), or `{ available: false, agents: [] }`.
- `GET /api/providers/saya` (`providers/saya/route.ts:12`) — any signed-in client. Returns the server's shared Saya AI provider as `{ enabled, …sayaAiPublic() }` — names and aliases only, never the key, endpoint or real model ids; `Cache-Control: private, no-store`.
- `GET /api/connectors/models?org=<slug>[&refresh=1]` (`connectors/models/route.ts:16`) — member-level. The title-bar model picker's grouped list from `loadWorkspaceModels({ access, host })`: server models, local apps, per-key provider model lists, and the person's Macs. `?refresh=1` force-clears the caches (models.dev, manifest, Codex/Claude CLI lists) — admin only. Response `{ groups, canManage }`, `maxDuration = 60`.
- `GET /api/connectors/models/room?org=<slug>&room=<roomId>` (`connectors/models/room/route.ts:22`) — member-level; the per-chat picker: every bot in the room with `{ id, handle, displayName, editable (kind === "llm"), bot: { keyId, model, effort }, chat: override | null }` from `room_agents.model_override` and `agentModelUse`. Response `{ bots, canEdit }`.
- `GET /api/connectors/copilot` (`connectors/copilot/route.ts:12`) — session-auth; starts GitHub's device sign-in (`startCopilotDeviceFlow`) and returns the `DeviceCodeFlow` (`deviceCode`, `userCode`, `verificationUri`, `expiresIn`, `interval`).
- `POST /api/connectors/copilot` (`connectors/copilot/route.ts:31`) — body `{ deviceCode, org? }`. Polls GitHub; while pending answers `{ status }`. On success it verifies the Copilot plan (`getCopilotInternalToken`) and — when `org` is set, admins only (`403 "Only workspace admins can connect AI accounts"`) — saves the GitHub token via `storeProviderKey` (label `GitHub Copilot (<plan>)`, `verify: true`); a refused key is `422 { status: "error" }`. Final response `{ status: "complete", plan, label, last4 }` — **no token ever returns to the browser**.

---

## 📊 Local usage — `GET /api/usage/local`

Reads Claude Code / Codex / Antigravity logs from the **server machine's** home folder via `scanLocalUsage` from `@sayabot/core/scanner`. That is only meaningful when Sayabot runs on the caller's own computer, so `isOwnMachine` (`usage/local/route.ts:14`) requires either `SAYABOT_LOCAL_USAGE_SCAN=1` (or `=0` to force off) or a loopback hostname — on hosted servers it answers `{ ok: false, available: false, records: [], events: [] }`.

Enabled runs take `?days=` (default 30) and `?providers=csv`, and return `{ ok, available, days, records, summary, events, scannedAt, providersScanned }` with a token/cost breakdown by provider, model and day; scan errors come back as `500` with an empty summary (`usage/local/route.ts:56`).

---

## 🏠 Identity, health, version

- `GET /api/instance` (`instance/route.ts:18`) — public, CORS `*`, no-store. What the Mac/phone apps probe before trusting an address: `{ sayabot: true, name: instanceName(), edition, url: getPublicOrigin(request), guestMode, supabase: { url, anonKey }, version }` — the Supabase anon key ships in every browser bundle, so it is public by design.
- `GET /api/health` (`health/route.ts:5`) — Docker/nginx liveness: `{ ok: true, service: "sayabot-web", commit: GIT_COMMIT_SHA }`; deliberately excluded from the auth proxy so it never touches Supabase.
- `GET /api/version` (`version/route.ts:67`) — CORS `*`. `{ version, gitCommit, buildTime, latestDesktopVersion, latestMobileVersion, dmgUrl, dmgUrls: { arm64, x64 }, apkUrl, releaseNotes }`. `latestDesktopVersion` reads GitHub releases for `anurag3407/sayabot`, ignoring drafts/prereleases and any release whose two DMGs are not fully uploaded, cached 10 minutes, overridable with `DESKTOP_LATEST_VERSION` (`version/route.ts:36`).

---

## 🖥️ Remote desktop sessions

- `POST /api/remote/sessions` (`remote/sessions/route.ts:8`) — bearer/session. Body `{ hostId, offer ≤ 100,000, control? }` (`400 "hostId and offer are required"`). The host must exist and not be revoked (`404 "Computer not found"`), the viewer must pass `canOpenHost` (owner or permitted org role — `403`), and the host must be online (`409 "That computer is offline…"`, via `hostOnline(last_seen_at)`). Inserts a `remote_sessions` row with `status: "requested"`, the WebRTC offer, and `control: body.control === true`; returns `{ id }`. The desktop picks it up on its next heartbeat (see the desktop API reference) and answers via `/api/desktop/sessions/[id]`.
- `GET /api/remote/sessions/[id]` (`remote/sessions/[id]/route.ts:18`) — the viewer polls for the answer: own sessions only (`404 "not found"` otherwise); returns `{ status, answer (only when "answered"), error }`.
- `DELETE /api/remote/sessions/[id]` — the viewer hangs up: sets `status: "ended"` + `ended_at`; returns `{ ok: true }`.

---

## 🗂️ Workspace data endpoints

All `/api/workspaces/[org]/…` routes resolve the caller through `getOrgAccess` (session client, RLS); non-members get `404 { error: "Not found" }`.

- `GET /api/workspaces/[org]/activity` (`workspaces/[org]/activity/route.ts:7`) — sidebar refresh: `{ items (chat list from `loadChatList`), inboxCount, adminRoomIds }` with `no-store`.
- `GET /api/workspaces/[org]/routines` (`workspaces/[org]/routines/route.ts:6`) — every routine in the org (RLS) with agent/room joins and a `human_schedule` from `humanReadableCron`.
- `POST /api/workspaces/[org]/routines` (`workspaces/[org]/routines/route.ts:59`) — creates one: `name`, `schedule_expr`, `agent_id`, `prompt` are required (`400` each); the expression is normalized with `normalizeCronExpression` (natural shorthand like "daily at 9am" accepted) and validated by `isValidCron` (`400` with a suggested format otherwise). Stores `schedule_kind: "cron"`, timezone (default UTC), `next_run_at` from `getNextCronRun`, creator; responds `201 { routine }`.
- `GET/PATCH/DELETE /api/workspaces/[org]/routines/[id]` (`workspaces/[org]/routines/[id]/route.ts`) — detail (plus the 20 latest `routine_runs`), partial update (name/description/prompt/agent/room/enabled/metadata; schedule/timezone changes re-validate cron and recompute `next_run_at`, disabled → null), and delete — all org-scoped.
- `POST /api/workspaces/[org]/routines/[id]/run` (`workspaces/[org]/routines/[id]/run/route.ts:6`) — run-now: verifies the routine in the org, then `runRoutineInOrchestrator` (`POST /internal/routines/:id/run`); orchestrator failure is `502`, success `{ ok: true, message: "Routine '<name>' executed." }`.

---

## 👻 Guest merge entry — `POST /api/account/merge`

**Auth:** `userFromRequest`; **anonymous users only** (`400 { error: "Only guest accounts can be merged" }` otherwise — `account/merge/route.ts:24`). Creates a 30-minute merge ticket (`createMergeTicket`, see the workspace actions reference) and returns `{ url: "<origin>/auth/merge?ticket=…&next=…" }` for the person to open in a system browser, sign in, and confirm the move. The origin comes from `x-forwarded-host`/`x-forwarded-proto` or `NEXT_PUBLIC_SITE_URL` (`account/merge/route.ts:8`).

## ✉️ Auth email hook — `POST /api/auth/send-email`

Supabase Auth's "Send Email" hook (also usable as a generic auth email webhook, `auth/send-email/route.ts:9`). Body `{ user: { email, user_metadata }, email_data: { token, token_hash?, redirect_to?, email_action_type } }` (`400 { error: "Missing required email payload" }` otherwise). The link prefers `redirect_to`, else `token_hash` → `/auth/callback?token_hash=…&type=…`, else `/auth/complete`. Dispatch by `email_action_type` (`auth/send-email/route.ts:34`): `signup`/`email_change` → `sendVerificationEmail` (with the 6-digit `token`), `magiclink`/`login` → `sendMagicLinkEmail`, `recovery` → `sendPasswordResetEmail`, `invite` → `sendWorkspaceInviteEmail` (workspace name "Sayalabs", role member). Unknown types are logged and acknowledged `{ ok: true }`; template rendering failures are `500`.

## ⬇️ Downloads

Three public redirects over the landing page's `DOWNLOADS` constants, all `force-dynamic` with no-cache headers: `GET /api/download/android` → the Android APK URL (`download/android/route.ts:6`), `GET /api/download/apk` → the legacy APK alias, and `GET /api/download/mac?arch=x64` → the Intel DMG (any other `arch`, or none, gets the arm64 DMG — `download/mac/route.ts:6`).

---

## 📤 What the proxy forwards

Into the upstream call (`v1/[...path]/route.ts:325`):

| Header | Direction | Purpose |
| :--- | :--- | :--- |
| `authorization` | → | The caller's own Supabase token, re-validated upstream. |
| `content-type`, `accept` | → | Body negotiation. |
| `x-sayabot-thread-id`, `x-sayabot-reply-to` (and legacy `x-mesh-*`) | → | MCP thread/reply addressing. |
| `mcp-protocol-version`, `mcp-session-id` | → | MCP session continuity. |
| `x-internal-secret` | → computers only | Lets computerd trust the web app; never added for orchestrator paths. |

Back to the client: `content-type`, `www-authenticate`, `allow`, `mcp-session-id`, plus `x-accel-buffering: no` so SSE streams and streaming bodies are not buffered by intermediate proxies (`v1/[...path]/route.ts:362`). Non-GET/HEAD bodies stream through with `duplex: "half"`.

## 🧭 Guard summary

| Path under `/api` | Guard | Body |
| :--- | :--- | :--- |
| `v1/tools/:id/approve` (POST) | bearer/session + Mac-owner or room/org admin | `{ approved }` → `{ ok, status }` |
| `v1/tools/…` (other) | none allowed | `403 { error: "forbidden" }` |
| `v1/computers/…` | bearer/session + org member (`admin` for DELETE) | streams computerd |
| `v1/computers/:id/stop` (POST) | org admin | `{ ok, status: "stopped" }` |
| `v1/…` (anything else) | none (upstream decides) | streamed orchestrator response |
| `messages` (POST) | bearer/session + room access | `{ messageId, queued, warning? }` |
| `files/rooms/<roomId>/…` (GET) | bearer/session + room RLS | `302` → 60-second signed URL |
| `providers/local`, `providers/saya` | session (saya: bearer too) | `{ available, agents \| enabled, … }` |
| `connectors/models`, `connectors/models/room` | session + org member | `{ groups \| bots, canManage \| canEdit }` |
| `connectors/copilot` | session (`POST`: org admin) | device flow / `{ status, plan, label, last4 }` |
| `remote/sessions` (POST) | bearer/session + `canOpenHost` + host online | `{ id }` |
| `remote/sessions/:id` (GET/DELETE) | bearer/session + own session | `{ status, answer, error }` / `{ ok: true }` |
| `workspaces/:org/activity`, `/routines*` | session + `getOrgAccess` (RLS) | JSON domain payloads |
| `account/merge` (POST) | bearer/session + anonymous-only | `{ url }` |
| `auth/send-email` (POST) | Supabase Auth hook (no browser session) | `{ ok: true }` |
| `instance`, `version`, `health`, `download/*` | public | JSON / redirects |

## 📥 Representative responses

`POST /api/messages` — the exact JSON the outbox and chat UI consume (`messages/route.ts:71`):

```json
{ "messageId": "…", "queued": true, "warning": null }
```

`GET /api/instance` — the server-picker payload (CORS `*`, no-store):

```json
{
  "sayabot": true,
  "name": "Sayabot",
  "edition": "self-hosted",
  "url": "https://sayabot.example.com",
  "guestMode": true,
  "supabase": { "url": "…", "anonKey": "…" },
  "version": "1.0.1"
}
```

`GET /api/files/rooms/<roomId>/<uuid>/<name>` — `302` to a Supabase Storage signed URL valid for 60 seconds; the browser follows it, nothing is proxied through Sayabot.

---

Related docs: [Agents on your Mac](../../../agents-on-your-mac.md), [Auth & authorization](../../architecture/auth-and-authorization.md), [Realtime & events](../../architecture/realtime-and-events.md), [Computers & remote UI](../pages/computers-remote-ui.md), [Model system](../pages/model-system.md)
