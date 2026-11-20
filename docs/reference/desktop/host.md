# Sayabot Desktop — The Host Service

Once someone is signed in, the Mac app becomes a **Sayabot host**: it registers once with the server (earning its own `hostId`/`hostToken` pair), heartbeats every 2.5 seconds, picks up remote-desktop requests, and hands queued work to the local runner, vault and MCP executors. `DesktopHost` is the single authenticated HTTP client for the computer — everything else in the app calls through its `get`/`post`.

Source files: `apps/desktop/src/host.ts`, `src/host-auth.ts` (registration ownership), `src/renderer/remote-host.html` + `src/remote-preload.ts` (capture window)

---

## 🔑 Registration (`register`, `src/host.ts:239`)

Registration is `POST /api/desktop/register` with the **user's** bearer token, body `{ name: hostname (`.local` stripped), platform, version: app.getVersion(), refreshToken }`. When a previous registration exists for the same server, its `x-host-id`/`x-host-token` headers are sent so the server keeps that computer row (`src/host.ts:242-245`). The response `{ hostId, hostToken, session? }` is saved atomically to `sayabot-host.json` (mode 0o600, previous copy kept as `.bak`); if the server returns refreshed user tokens, `deps.onSessionUpdate` persists them into the session file.

### Whose registration is it? (`src/host-auth.ts`)

Heartbeats land on the account that **registered** the computer, so a stale registration must never be reused by a new login. `hostAuthPlan(saved, serverUrl, userId)` (`src/host-auth.ts:19`) decides:

| Result       | Condition                                             | Action in `connect()`                                                                                                        |
| :----------- | :---------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `"reuse"`    | same server + same (or unknown) user id               | use saved credentials                                                                                                        |
| `"verify"`   | saved before `userId` was recorded (pre-1.0.13 files) | re-register sending the old headers; **if the server is unreachable, keep using the saved registration** (`src/host.ts:206`) |
| `"register"` | nothing saved, another server, or another account     | register; offline means no host this time                                                                                    |

`start()` (`src/host.ts:191`) deduplicates concurrent connects through a `starting` promise and is safe to call on every login change. When the resulting `hostId` differs from the previous one, the agents and storage scans are reset so the new computer row is populated immediately (`src/host.ts:208-212`). `forget()` (`src/host.ts:232`) stops the host and deletes the saved registration (used on sign-out, 401, and account switches).

## 💓 Heartbeat (`heartbeat`, `src/host.ts`)

`HEARTBEAT_MS` is **2,500 ms**; a `beating` guard prevents overlap. Each beat is `POST /api/desktop/heartbeat` with:

- **`permissions`** — `permissionState()` (`src/host.ts`): macOS screen-recording status and accessibility (`isTrustedAccessibilityClient`). On Windows, screen is `granted` unless `getMediaAccessStatus("screen")` is `denied` or `restricted`, and accessibility is `granted` (injection uses the interactive session). Other platforms stay `"unknown"`.
- **`localAgents`** — re-scanned at most every **60 s** via the injected `detectLocalAgents` (see [local-agents-and-injector.md](./local-agents-and-injector.md)); the server keeps the last list in between.
- **`storage`** — re-measured at most every **10 min** via `measureLocalStorage`, off the heartbeat so the walk cannot delay a claim (see [overview.md](./overview.md)).

The reply (`HeartbeatReply`, `src/host.ts:49-55`) carries everything the computer needs to act:

```typescript
{
  settings: { whoCanControl?: string; askOnComputer?: boolean; runnerEnabled?: boolean }
  sessions: Array<{ id, viewerName, isOwner, control, offer: string | null }>
  queuedJobs: number
  secretJobs?: number
  mcpCalls?: number
}
```

`lastReply` is kept public for `host:get-status`. `deps.onHeartbeat` drives the workers in `main.ts`: the runner's `maybeRun(queuedJobs, settings.runnerEnabled)`, the vault's `maybeRun(secretJobs)`, and local MCP's `maybeRun(mcpCalls)` — each one job at a time.

One beat, end to end:

```
every 2,500 ms (skipped if the previous beat is still in flight)
├─ scan agents?        (> 60 s since last)  → deps.detectLocalAgents() in the background → localAgents on a later beat
├─ measure storage?    (> 10 min since last) → measureLocalStorage() in the background → storage on a later beat
├─ POST /api/desktop/heartbeat { permissions, localAgents?, storage? }  (aborts after 12 s)
├─ save reply to lastReply, fire deps.onHeartbeat(reply)   (runner / vault / local MCP)
├─ void maybeCloudHandoff()                                 (throttled to 10 min)
└─ for each reply.sessions[] not in `handled` → mark handled → handleSession(...)
```

### Session settings (`reply.settings`)

| Setting         | Meaning on this Mac                                                                                                   |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------- |
| `runnerEnabled` | Whether the local runner may claim jobs (the switch lives in the web's Computers settings, so every device shares it) |
| `askOnComputer` | When not `false`, every remote-desktop session triggers the local confirmation dialog before capture starts           |
| `whoCanControl` | Reported through to the UI (via `host:get-status`); the Mac itself always confirms locally regardless of who asked    |

`main.ts` tracks `localRunnerRunning = Boolean(reply.settings.runnerEnabled)` on every beat so the controller page's status is the server's truth (`src/main.ts:197-199`).

### Authenticated transport (`get`/`post`, `src/host.ts:285-315`)

Every call sends `x-host-id` + `x-host-token` headers and aborts after 12 seconds, so one stalled request cannot freeze the heartbeat (and with it, job claims). A `401` on `post` calls `forget()` and returns `null` — the computer was removed on the web or its token rotated elsewhere, so it re-registers on next start. All network failures degrade to `null`; callers treat that as "nothing to do".

While the host loop is running, `powerSaveBlocker.start("prevent-app-suspension")` keeps macOS from suspending the process under App Nap. Without that, a backgrounded Sayabot stops heartbeating and a queued job expires as "didn't pick this up" even though the app is still open. `stop()` and a failed connect release the blocker.

---

## 🖥️ Remote Desktop Sessions

Each heartbeat reply's `sessions` list is deduplicated by a `handled` set and dispatched to `handleSession` (`src/host.ts:422`), which can refuse at several gates, posting `action: "deny"` with a reason:

1. **No offer** in the reply → deny.
2. **Screen Recording permission** missing on macOS → trigger `desktopCapturer.getSources` once (which makes macOS show its own prompt) and deny with "Screen Recording isn't allowed…".
3. **Local confirmation** — unless `settings.askOnComputer === false`, `askAtComputer` (`src/host.ts:400`) shows a modal dialog ("`<viewerName>` wants to see/control this computer", default button **Don't allow**, auto-refused after 30 s via `AbortController`).
4. **No capturable screen** → deny.

If control was requested, actual control is only enabled when `injector.supported` (darwin or win32) **and** accessibility is granted. The primary display's capturer source is matched by `display_id`; the hidden capture window (`ensureCaptureWindow`, `src/host.ts:446`) loads `remote-host.html` with the `remote-preload.js` bridge and receives `remote-host:start` with `{ sessionId, offer, sourceId }` once it finishes loading.

### Input injection

The capture window relays viewer input over its WebRTC data channel → `remote-host:input` → `DesktopHost.input` (`src/host.ts:465`):

- The session must be `active` **with `control: true`**, else the event is dropped.
- `parseInput` (`src/host.ts:91`) mirrors `@sayabot/core`'s `parseRemoteInput`: it accepts only `move`/`down`/`up` (coordinates clamped to 0–1, button `b` forced to 0 or 2), `scroll` (clamped ±50), `key` (≤ 20 chars, mods filtered to cmd/ctrl/alt/shift), and `text` (1–500 chars). Everything else is dropped.
- Normalized coordinates are scaled to the primary display's pixel bounds; `key` events get a numeric `code` from `KEY_CODES` when known.
- `Injector.send` posts the event (see [local-agents-and-injector.md](./local-agents-and-injector.md)).

Session closure from the capture side arrives on `remote-host:ended`, posting `action: "fail"` (with reason) or `"end"` (`src/host.ts:176-179`); answers go out as `{ action: "answer", answer }`.

The `active` map (`src/host.ts:164`) remembers which accepted sessions have `control: true` — it is the only gate the input path checks, and entries are removed on `remote-host:ended`. The `handled` set only prevents re-processing a session id across heartbeats; a session that was denied stays denied (the server moves it on), and a repeated id (e.g. after reconnect) is never re-offered to the capture window. The capture window itself is a single hidden `BrowserWindow` reused for all sessions (`show: false`, 320×200, `backgroundThrottling: false` so capture survives in the background), destroyed by `stop()`.

---

## ☁️ Cloud Home Handoff

Two hooks implement [workspace cloud handoff](./usage-and-cloud-handoff.md):

- `maybeCloudHandoff` (`src/host.ts:339`) runs at most every **10 minutes** inside the heartbeat. It reads this Mac's snapshot (`cloud-home.json`, or a synthesized one from detected agents on first run) and calls `syncCloudHandoff`, which copies bots/chats/routines/keys **up to Sayabot Cloud** when a plan is active (`copy_to_cloud`) or writes the cloud copy **back down** after the plan ends (`copy_back`, setting the `cloud-home-return.json` flag).
- `importReturnedHome` (`src/host.ts:318`) fires when the return flag exists and the Mac now points at a **non-Cloud** server: the saved snapshot is pushed into the new server via `importWorkspaceSnapshot` (`POST /api/desktop/workspace-import`) and the flag is removed — but only if the snapshot actually contains records (`snapshotHasRecords`).

`main.ts` also calls `fetchWorkspaceSnapshot`/`leaveCloudHome` directly during server switches (see [overview.md](./overview.md)).

---

## 🧩 What the Host Exposes (summary)

| Capability                     | Mechanism                                | Server route                                                                          |
| :----------------------------- | :--------------------------------------- | :------------------------------------------------------------------------------------ |
| Presence, settings, job counts | heartbeat every 2.5 s                    | `POST /api/desktop/heartbeat`                                                         |
| One-time registration          | user bearer token → host token           | `POST /api/desktop/register`                                                          |
| Screen share + control         | WebRTC answer/deny/end + input injection | `POST /api/desktop/sessions/[id]`                                                     |
| Local agent jobs               | claimed by the runner                    | `POST /api/desktop/jobs/claim`, `/api/desktop/jobs/[id]`, `/events`, `/approvals`     |
| Password-manager lookups       | claimed by `VaultRunner`                 | `POST /api/desktop/secrets/claim`, `/api/desktop/secrets/[id]`                        |
| Local MCP programs             | claimed by `LocalMcpHost`                | `POST /api/desktop/mcp/claim`, `/api/desktop/mcp/[id]`                                |
| Workspace snapshot portability | handoff sync                             | `GET/POST/DELETE /api/desktop/cloud-home`, `/workspace-snapshot`, `/workspace-import` |

---

## Related docs

- [Overview (lifecycle, IPC, storage)](./overview.md)
- [Local runner & event streaming](./runner-and-stream.md)
- [Local agents & injector](./local-agents-and-injector.md)
- [Usage scanning & cloud handoff](./usage-and-cloud-handoff.md)
- [Desktop Host API (server side)](../web/api/api-desktop.md)
- [Computers & remote UI](../web/pages/computers-remote-ui.md)
- [Desktop guest mode](../../desktop-guest-mode.md)
