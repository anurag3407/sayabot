# Desktop Host API

`app/api/desktop/*` serves Sayabot for Mac / the Electron desktop app. The app pairs once as a **host**, then authenticates every call with its host id and token. Over this surface the desktop registers and heartbeats, refreshes logins, hands local agent apps (Claude Code, Codex, …) queued runner jobs, receives one-time password-manager tokens and MCP calls to execute on the computer, answers WebRTC remote-desktop requests, and carries workspace data between the Mac and Sayabot Cloud.

Source files: `apps/web/src/app/api/desktop/register/route.ts`, `apps/web/src/app/api/desktop/heartbeat/route.ts`, `apps/web/src/app/api/desktop/refresh/route.ts`, `apps/web/src/app/api/desktop/guest/route.ts`, `apps/web/src/app/api/desktop/cloud-home/route.ts`, `apps/web/src/app/api/desktop/workspace-snapshot/route.ts`, `apps/web/src/app/api/desktop/workspace-import/route.ts`, `apps/web/src/app/api/desktop/jobs/claim/route.ts`, `apps/web/src/app/api/desktop/jobs/[id]/route.ts`, `apps/web/src/app/api/desktop/jobs/[id]/events/route.ts`, `apps/web/src/app/api/desktop/jobs/[id]/approvals/route.ts`, `apps/web/src/app/api/desktop/jobs/[id]/approvals/[toolCallId]/route.ts`, `apps/web/src/app/api/desktop/secrets/claim/route.ts`, `apps/web/src/app/api/desktop/secrets/[id]/route.ts`, `apps/web/src/app/api/desktop/mcp/claim/route.ts`, `apps/web/src/app/api/desktop/mcp/[id]/route.ts`, `apps/web/src/app/api/desktop/sessions/[id]/route.ts`, `apps/web/src/lib/desktop-hosts.ts`

---

## 🔑 Host identity (`lib/desktop-hosts.ts`)

`hostFromRequest(request)` (`desktop-hosts.ts:35`) authenticates a desktop call from two headers: `x-host-id` (UUID) and `x-host-token`. It loads the `desktop_hosts` row, refuses revoked hosts, and compares `hashAgentApiKey(token)` against `token_hash` character-by-character in constant time (`sameHash`, `desktop-hosts.ts:27`). All host routes return `401 { error: "unauthorized" }` without a valid host.

`HostRow` (`desktop-hosts.ts:5`) carries `user_id`, optional `org_id`, name/platform/app_version, `token_hash`, `permissions`, `local_agents`, `settings` (`whoCanControl: "only_me" | "admins" | "members"`, `askOnComputer`, `runnerEnabled`, `localDefault`), liveness and revocation timestamps.

Two helpers drive the "run agents on my Mac" defaults: `pickDefaultApp` picks the most capable signed-in app (order `claude-code`, `codex`, `copilot`, `cursor`, `gemini`, `opencode`, then the rest of `MAC_CLI_APPS`, never an app with a `usePolicy` (Antigravity, Kimi Code, Qoder, Command Code, Devin), which must be picked per bot), and `withLocalDefault` turns `runnerEnabled: true` + `localDefault: { app }` on the first time a ready app appears, keeps the choice current, and never touches it again once the owner set it to `false` (`desktop-hosts.ts:71`).

---

## 📝 Registration — `POST /api/desktop/register`

**Auth:** `userFromRequest` (bearer or session). The saved login may have expired, so the body may carry a `refreshToken` (≤ 4,000 chars) that is exchanged once via Supabase `refreshSession` (`register/route.ts:23`); a renewed `session { accessToken, refreshToken }` comes back in the response.

- With a valid `x-host-id`/`x-host-token` pair owned by the same user, the existing host is **re-registered**: name, platform, app_version and a fresh `token_hash` are updated, keeping the host's id and settings (`register/route.ts:46`).
- Otherwise a new `desktop_hosts` row is inserted with defaults `settings: { whoCanControl: "only_me", askOnComputer: true, runnerEnabled: false }` (`register/route.ts:66`); name ≤ 80 ("My computer" fallback), platform ≤ 20, version ≤ 40.

**Response:** `{ hostId, hostToken }` (plaintext token, shown once) plus the refreshed session when one was minted.

---

## 💓 Heartbeat — `POST /api/desktop/heartbeat`

**Auth:** `hostFromRequest`. Sent every couple of seconds; the body is all-optional (`heartbeat/route.ts:35`):

- `permissions` — OS permission states (`granted | denied | not-determined | restricted | unknown`), keys ≤ 30 lowercase chars (`heartbeat/route.ts:29`).
- `localAgents` — up to 20 detected agent apps `{ id, name, status, version?, account?, models? }`; nested `models` are sanitized by `reportedModels` (≤ 200 per app, ids validated by `MODEL_ID`, up to 8 effort options each) (`heartbeat/route.ts:9`). Omitted bodies keep the stored `local_agents`.
- `storage` — sent about every 10 minutes: app-data bytes and per-agent `{ handle, bytes, files, approximate }` (≤ 100 agents), stamped `measuredAt` (`heartbeat/route.ts:65`).
- `settings` — derived via `withLocalDefault` and persisted when it changes.

The update also stamps `last_seen_at`. The response hands the host its work queue (`heartbeat/route.ts:131`):

```json
{
  "settings": { … },
  "sessions": [{ "id", "viewerName", "isOwner", "control", "offer" }],
  "queuedJobs": 0,
  "secretJobs": 0,
  "mcpCalls": 0
}
```

`sessions` are `remote_sessions` rows with `status: "requested"` newer than two minutes (older requests are treated as abandoned by the viewer, `heartbeat/route.ts:99`) — the desktop opens these with the bundled WebRTC `offer`.

---

## 🔄 Session refresh — `POST /api/desktop/refresh`

**Auth:** none; body `{ refreshToken }` (required, ≤ 4,000 chars — `400` otherwise). Exchanges it through an anonymous Supabase client (`refresh/route.ts:24`).

- Invalid/expired token → **401**, which tells the Mac app the login is dead and it should sign out locally; network/5xx Supabase failures map to **502** so a transient outage never logs anyone out (`refresh/route.ts:27`).
- Success: `{ accessToken, refreshToken, email, userId, isAnonymous, expiresAt }` — `isAnonymous` lets the desktop notice that a saved guest became a full account (`refresh/route.ts:41`).

## 👻 Guest mode — `GET /api/desktop/guest`

**Auth:** none; force-dynamic. Reports whether the server allows starting without an account — `desktopGuestModeEnabled()` (env `DESKTOP_GUEST_MODE`, on unless `false/0/off`). When enabled it returns `{ enabled: true, supabaseUrl, anonKey }` — both values already public in the web bundle; the desktop performs the anonymous sign-up itself so Supabase's per-IP limit applies to each person's own address (`guest/route.ts:8`). Misconfigured Supabase yields `{ enabled: false }`.

---

## 🏠 Cloud handoff — `GET/POST/DELETE /api/desktop/cloud-home`

**Auth:** `hostFromRequest`; force-dynamic. Moves the person's workspace data between the Mac and Sayabot Cloud via `cloud_home_copies` (one row per user).

- `homeState(userId, orgId)` (`cloud-home/route.ts:11`) computes `{ cloudReady, planActive, copied }` — plan active means a non-free plan with `status: "active" | "trialing"` from `workspacePlan`.
- `GET` returns that state; the desktop applies `planCloudHandoff(state)` from `@sayabot/core` to decide "copy up, copy back, or leave alone".
- `POST` (`cloud-home/route.ts:32`) stores the Mac's snapshot once (`409 { error: "Nothing to copy" }` unless the plan says `copy_to_cloud`): body `{ snapshot }` parsed by `parseWorkspaceCopy`, upserted with `copied_at`, `restored_at: null` — a second copy while one is held is refused. If the host belongs to a workspace, the snapshot is also replayed into the server via `restoreWorkspaceCopy` (errors swallowed).
- `DELETE` (`cloud-home/route.ts:56`) returns the stored snapshot (only when the plan says `copy_back`, else `409 "Nothing to copy back"`) and marks it `restored_at` so a later plan can copy again.

### Snapshot transport — `GET /api/desktop/workspace-snapshot` and `POST /api/desktop/workspace-import`

- `GET` (`workspace-snapshot/route.ts:11`) — host with an org. Assembles the Mac's data: bots (≤ 200 agents with prompts/params), chats (≤ 200 rooms + the 30 newest messages per room, ≤ 600 total), routines (schedule expression, prompt, timezone, enabled), **provider keys with their sealed envelope intact** (`ciphertext/iv/tag/last4/base_url` — "Key material stays in its envelope. Nothing here is decrypted.", `workspace-snapshot/route.ts:9`, ≤ 50 keys), and org computer settings (sealed Boat credentials + VPS alias/autostart). Response: `{ snapshot: { bots, chats, routines, keys, computers } }`.
- `POST` (`workspace-import/route.ts:9`) — host with an org; body `{ snapshot }` parsed by `parseWorkspaceCopy` and restored onto the server via `restoreWorkspaceCopy(orgId, snapshot)` ("Existing rows stay."). Returns `{ ok: true }`.

---

## ⚙️ Runner jobs (Claude Code / Codex on the Mac)

### `POST /api/desktop/jobs/claim` (`jobs/claim/route.ts:15`)

**Auth:** `hostFromRequest`. Returns the oldest `queued` `local_runner_jobs` row for the host; disabled runner → `{ job: null }`. The claim is a guarded update to `status: "running"` (status guard = each job runs once) and **wipes `mcp_token_enc`** — the run's tool token is handed over exactly once (`jobs/claim/route.ts:31`).

Response job payload (`jobs/claim/route.ts:63`):

```json
{
  "id": "…",
  "prompt": "…",
  "system": "…" | null,
  "app": "claude-code",
  "model": null,
  "effort": null,
  "agentHandle": "…",
  "agentName": "…",
  "mcp": { "url": "<origin>/api/v1/mcp", "token": "…" } | null,
  "allow": [ …macAllowRules(agent.params) ] | [],
  "permissions": "review" | "ask" | "auto" | "turbo",
  "room": { "id", "name", "path": "/<orgSlug>/r/<roomId>" | null } | null
}
```

`system` is `local_runner_jobs.system_prompt` (set only for ACP apps on Mac app 1.0.32+; null means the system prompt is already in `prompt`). `app` comes from the job row or the agent's `params.runner.app` (default `claude-code`); `model`/`effort` are null to keep the app's own defaults; `mcp` is present only when the sealed token could be opened with `getKek()`, and `allow` carries the agent's pre-approved step rules (empty under `review`). `permissions` is the room's execution mode as this Mac applies it, from `macPermissions(mode, setBy, host.user_id)` in `lib/mac-runner.ts`: `review_all` → `review`; `auto`/`turbo` only when `rooms.execution_mode_set_by` is this host's owner, otherwise `ask`; anything else `ask`. The mode is read in its own query so a server ahead of its migration still hands out jobs.

### Progress and completion — `POST /api/desktop/jobs/[id]` (`jobs/[id]/route.ts:11`)

Body `{ output?, status?: "done" | "failed", error?, usage?, model? }`. Output is stored cumulatively but truncated to the last 100,000 chars (`MAX_OUTPUT`); a terminal status stamps `finished_at` (error ≤ 1,000 chars). Updates are guarded `.eq("status", "running")`; if the job is no longer running — the room stopped the turn — the reply is `{ cancelled: true }` so the Mac kills the app. When `status` is `"done"`, `recordMacJobUsage` inserts a `usage_events` row for that job: provider is the app id (`copilot`, `codex`, …), model is the one the app reported or the one the job asked for (`auto` when that is what was chosen), tokens come from `usage` when the app sent them and otherwise from the reply text. The event time is the job's `created_at`, so posting done twice does not add a second row. Cost is stored as 0; the Usage page treats these apps as the person's own plan.

### Live tool cards — `POST /api/desktop/jobs/[id]/events` (`jobs/[id]/events/route.ts:9`)

Body `{ events: [...] }`, at most 50 per call (`400 "invalid events"`). Delegates to `recordMacToolEvents(jobId, hostId, events)` on the orchestrator (see the server-actions overview), which validates the job belongs to this host and returns `{ ids: { … } }`.

### Approvals

- `POST /api/desktop/jobs/[id]/approvals` (`jobs/[id]/approvals/route.ts:10`) — body `{ key, toolName, args? }` (`400` when missing). Delegates to `requestMacApproval(jobId, hostId, ...)` on the orchestrator: the request becomes an approval card answerable from web, phone or the Mac itself, and the response contains the `toolCallId` to poll.
- `GET /api/desktop/jobs/[id]/approvals/[toolCallId]` (`jobs/[id]/approvals/[toolCallId]/route.ts:10`) — polls the decision. The `tool_calls` row must carry the Mac marker with matching `jobId` **and** `hostId` (`404 "not found"` otherwise). Response: `{ status: "pending" | "approved" | "rejected", remembered, message }` — `remembered` is true when the owner chose "always allow" (`args._remembered`), and `message` carries the rejection reason (default "Refused").

---

## 🔐 Password-manager delegation (`api/desktop/secrets/*`)

Used by the password-manager connectors in `authMode: "computer"` (1Password, Bitwarden, Proton Pass) — the computer runs the local CLI; the server never builds a shell line.

- `POST /api/desktop/secrets/claim` (`secrets/claim/route.ts:13`) — host with an org. Claims the oldest `queued` `desktop_secret_jobs` (guarded update to `running`, exactly once) and validates it against `SOURCES = { onepassword, bitwarden, protonpass }` and the connector: the `workspace_connectors` row must belong to the host's org, match the source, and be `active` — otherwise the job fails with "Connector is not available" / "Could not read the saved key". On success the connector's token is **decrypted and handed over in the response** (`{ job: { id, source, action, query, vault, token } }`) — the one place a connector secret leaves the server for the computer.
- `POST /api/desktop/secrets/[id]` (`secrets/[id]/route.ts:8`) — returns the outcome: `{ result }` is JSON-sealed with `sealSecret(..., getKek())` (≤ 200,000 chars) into `result_enc` ("The plaintext is not stored"), or `{ error }` (≤ 500 chars) marks the job `failed`. Both guarded on `status: "running"` + host ownership; anything else is `404 { error: "job not found" }`.

## 🧩 Local MCP delegation (`api/desktop/mcp/*`)

Lets agents call MCP servers cataloged as **local apps** on the computer (e.g. Obsidian).

- `POST /api/desktop/mcp/claim` (`mcp/claim/route.ts:11`) — host with an org. Claims the oldest `queued` `desktop_mcp_calls` (guarded, exactly once); only methods `tools/list` and `tools/call` are allowed. The referenced `mcp_servers` row must belong to the host's org, have `catalog_app` equal to the call's `app_id`, and be `enabled` — otherwise the call fails with "App is not connected". The response carries `{ call: { id, serverId, appId, method, params, env } }` where `env` is the allow-listed subset (`OBSIDIAN_API_KEY`, `OBSIDIAN_HOST`, `OBSIDIAN_PORT`) of the server's sealed headers (`ENV_KEYS`, `mcp/claim/route.ts:8`); a sealed payload that cannot be opened fails the call.
- `POST /api/desktop/mcp/[id]` (`mcp/[id]/route.ts:5`) — body `{ result?, error? }`. Successful results are stored **unsealed but capped** at 400,000 characters of JSON (`413 { error: "result too large" }`); errors (≤ 500 chars) mark the call `failed`. Guarded on `running` + host; else `404 { error: "call not found" }`.

---

## 🖥️ Remote desktop — `POST /api/desktop/sessions/[id]`

**Auth:** `hostFromRequest`. The computer answers, declines, or closes a remote-viewing request on `remote_sessions` (`sessions/[id]/route.ts:5`):

- `{ action: "answer", answer }` (WebRTC answer < 100,000 chars) — only while `status: "requested"`, else `409 { error: "no longer waiting" }`; sets `status: "answered"`.
- `{ action: "deny", reason? }` — sets `status: "denied"` with the reason (≤ 200 chars, default "Declined on the computer") and `ended_at`.
- `{ action: "end" | "fail", reason? }` — sets `status: "ended" | "failed"`.
- Anything else: `400 { error: "unknown action" }`; sessions on other hosts: `404 { error: "not found" }`.

The viewer side of these sessions is created through the `/api/remote/sessions*` routes (plain-text mention: see the proxy/files API reference).

---

Related docs: [Computers & remote UI](../pages/computers-remote-ui.md), [Agents on your Mac](../../../agents-on-your-mac.md), [Auth & authorization](../../architecture/auth-and-authorization.md), [Security model](../../architecture/security-model.md)
