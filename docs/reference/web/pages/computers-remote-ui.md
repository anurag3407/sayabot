# Computers & Remote Desktop UI

Two screens manage the person-sized computers agents can see and click. `/[org]/settings/computers` lists the desktops registered to you or shared with the workspace (rows in `desktop_hosts`), with per-computer control settings and workspace-wide "Boat key + VPS" configuration. `/[org]/remote/[hostId]` is the remote desktop viewer: a direct **WebRTC** session to the Mac app on that computer, with mouse/keyboard over a data channel — the server only relays the WebRTC offer/answer through the `remote_sessions` table.

Source files: `apps/web/src/app/(workspace)/[org]/settings/computers/page.tsx`, `apps/web/src/app/(workspace)/[org]/remote/[hostId]/page.tsx`, `apps/web/src/components/computers/computers-view.tsx`, `apps/web/src/components/computers/remote-viewer.tsx`, `apps/web/src/lib/computers.ts`, `apps/web/src/lib/computer-settings.ts`, `apps/web/src/lib/actions/desktop.ts`, `apps/web/src/app/api/remote/sessions/route.ts`, `apps/web/src/app/api/remote/sessions/[id]/route.ts`

---

## 🖥️ Computers Settings Page (`settings/computers/page.tsx`)

`export const dynamic = "force-dynamic"` — the page must always reflect current host presence. It:

1. `requireOrgAccess(orgSlug)` for the session.
2. `listComputers(userId, orgId, role)` — the visible hosts (see below).
3. Reads `org_computer_settings` (`boat_last4, vps_ssh_alias, vps_start_automatically`) via the admin client; a query error just yields `null` settings.
4. Renders `<ComputersView>` with `canEdit = isOrgAdmin(access.role)`.

## 🧾 Computer Listing (`lib/computers.ts`)

`listComputers(userId, orgId, role)` (server-only) selects all non-revoked `desktop_hosts` where `user_id = me OR org_id = myOrg`, then:

- Resolves owner display names from `profiles` for the "X's computer" label.
- Filters through `canOpenHost({ ownerId, viewerId, hostOrgId, whoCanControl, viewerOrgRole })` from `@sayabot/core` — ownership plus the host's own sharing setting decide who may open it.
- Maps each row to `ComputerView`: `id, name, platform, appVersion, online` (via `hostOnline(last_seen_at)`), `lastSeenAt`, `mine`, `ownerName`, `permissions` (macOS permission states), `localAgents` (coding CLIs found signed in), and `settings`.

## ⚙️ Computers View (`components/computers/computers-view.tsx`)

Client component; header explains "The agent stays on this Mac or on Cloud. These are the desktops it can see and click."

### `ComputerCard`

One card per computer:

- **Header row**: Monitor icon, name, `Online`/`Offline` (green when online), platform (`darwin` rendered as "macOS"), app version, owner attribution for shared machines, and a **Connect** button linking to `/[org]/remote/<id>` — visually disabled (`pointer-events-none`, grey) when the computer is offline.
- **Owner-only settings block** (`computer.mine`, `computers-view.tsx:91-181`):
  - macOS permission rows for **Screen Recording** and **Accessibility** (`PermissionRow`): "Allowed" when `granted`, "Unknown" when missing, otherwise "Needs permission"; when either isn't granted, a hint points at System Settings → Privacy & Security.
  - **Who can control this computer** — `Select` bound to `settings.whoCanControl` (`only_me` | `admins` | `members`).
  - **Ask on this computer** — toggle (`role="switch"`) for `settings.askOnComputer` (default true): "Each session waits until a person at the computer allows it. With no answer in 30 seconds, it's refused."
  - **Run agents on this computer** — toggle for `settings.runnerEnabled` (Claude Code / Codex on the owner's subscription).
  - **Use this computer for my agents** — toggle for `settings.localDefault` (only effective while `runnerEnabled`): agents with no key or computer of their own run here, in workspaces only the owner is in; when offline the server answers.
  - "Found here: …" line listing `localAgents` names with non-ready statuses in parentheses.
  - **Remove this computer** — `removeHostAction` (soft revoke).
- Every setting change calls `updateHostSettingsAction` with the patch, toasts "Saved" / error, and `router.refresh()`.

### Cloud desktops and your server

Above the Macs list, the page renders `ComputerProviders` (`src/components/providers/computer-providers.tsx`) with the `ComputerProvidersView` from `loadComputerProviders(orgId)` (Boat API key, E2B API key, Self-hosted VPS, and 1Password browser logins). Non-admins see the status pills only. The Macs follow under "Your Macs".

### Empty state

"No computers yet" with a link to `/download` — install Sayabot for Mac and sign in.

## 🔧 Host Settings Actions (`lib/actions/desktop.ts`)

- **`updateHostSettingsAction`** — gated by `ownHost()`: org access + `host.user_id === me` ("Only the person who set up this computer can change it"). Merges the patch into `settings`; `localDefault: true` requires `pickDefaultApp(localAgents)` to find a signed-in CLI (else fails "Sign in to Claude Code, Codex, Gemini CLI or OpenCode on this computer first") and sets `runnerEnabled: true`. Sharing beyond "only me" **or** enabling the runner ties the host to the workspace by writing `org_id` (cleared back to `null` otherwise, `desktop.ts:47-49`). Audited as `desktop.settings_changed` with the full settings in metadata; revalidates the computers page.
- **`removeHostAction`** — owner-only; sets `revoked_at` (soft revoke; the row and its history remain) and returns `"<name> removed"`.

## 🔐 Sealed provider keys (`lib/computer-settings.ts`)

`computerProviderUpdate(input)` is the pure builder behind `saveComputerProviderAction` (see [settings-ui.md](./settings-ui.md#-ai-providers-keys)). It returns only the chosen provider's columns plus `org_id`/`updated_at`, so an upsert leaves the other providers alone:

- `boat`: token must match `/^(boat|box)_[A-Za-z0-9_-]{8,}$/`; sealed into `boat_ciphertext/iv/tag` + `boat_last4`. `e2b`: token must match `/^e2b_[A-Za-z0-9_-]{8,}$/`; sealed into `e2b_*`. `clear` nulls the four columns.
- `vps` by address: `parseSshAddress` reads `ssh -p 2222 user@host`, `user@host:2222`, `user@host` or `host` (user defaults to `root`, port to 22) into `vps_host/vps_user/vps_port` and nulls the alias. A pasted private key must be a whole `-----BEGIN … PRIVATE KEY-----` block without a passphrase (`checkPrivateKey`) and is sealed into `vps_key_*`; an empty key field keeps the saved one.
- `vps` by SSH config name: `/^[A-Za-z0-9_.:@-]+$/`, not starting with `-`, max 80 chars; clears host, user, port and any saved key.
- `vps_start_automatically` is written on every VPS save. The row never contains a plaintext key.

## 🎥 Remote Desktop Page (`remote/[hostId]/page.tsx`)

`force-dynamic`; resolves the host via `listComputers(...)` (so the same `canOpenHost` permission check applies) and `notFound()` when it isn't visible to this viewer. Renders `<RemoteViewer orgSlug hostId hostName>`.

## 📡 Remote Viewer (`components/computers/remote-viewer.tsx`)

`RemoteViewer` is a client component implementing the whole WebRTC handshake:

1. Creates an `RTCPeerConnection` with Google STUN servers (`remote-viewer.tsx:11`), adds a **recvonly** video transceiver, and opens an ordered data channel named `input`.
2. Waits for ICE gathering to complete (max 3 s via `waitForIce`), then `POST /api/remote/sessions` with `{ hostId, offer, control: true }`.
3. Enters phase `waiting` and **polls** `GET /api/remote/sessions/<id>` every second for up to 60 s (`remote-viewer.tsx:98-112`). On `status: "answered"` it applies the answer; `denied`/`failed`/`ended` produce their phases; timeout produces "The computer didn't answer. Is the Sayabot app open on it?".
4. Phases: `starting` → `waiting` → `connected` / `denied` / `ended` / `error`. Connection state changes map to messages (a `failed` connection explains that strict networks can block direct connections).
5. `hangUp()` closes the peer connection and `DELETE /api/remote/sessions/<id>`; also runs on unmount. The toolbar offers **Control on / View only** toggle, **Full screen** (`requestFullscreen` on the video container), and a danger **Disconnect** button; the header shows phase text ("Waiting for the computer to allow it…", "Connected · you're in control", etc.).

Input when `control` is on and connected:

- **Pointer**: `point(e)` maps screen coordinates through `contentRect(video)` (`remote-viewer.tsx:27-35`) — the object-contain letterbox math — to normalized 0–1 x/y inside the actual video picture. Sends `{ t: "move" | "down" | "up", x, y, b }` (button `2` for right-click), throttling moves to one per 30 ms; wheel sends `{ t: "scroll", dy, dx }` divided by 20.
- **Keyboard** (window-level `keydown`, `remote-viewer.tsx:144-155`): single characters without cmd/ctrl go as `{ t: "text", s }`; special keys (`SPECIAL_KEYS` set: Enter, Backspace, arrows, Home/End, PageUp/Down, Tab, Escape, Delete, space) and modified single chars go as `{ t: "key", key, mods: ["cmd"|"ctrl"|"alt"|"shift"] }`; everything else is ignored. Matched events are `preventDefault()`ed.
- The video cursor is hidden while controlling; context menu is suppressed.

## 🔁 Session Routes (`api/remote/sessions/*`)

These routes are in the middleware's public-path list (`/api/remote`) and authenticate with `userFromRequest` from `lib/route-bearer.ts` (session cookie or bearer token) instead of the workspace redirect.

- **`POST /api/remote/sessions`** (`route.ts`): requires a user; validates `hostId` + `offer` (string ≤ 100,000 chars). Loads the host (404 when missing/revoked), then `canOpenHost` with `orgRoleOf(viewerId, host.org_id)` (403 "You don't have access to this computer"), then `hostOnline(host.last_seen_at)` (409 "That computer is offline. Open the Sayabot app on it."). Inserts a `remote_sessions` row `{ host_id, viewer_user_id, offer, control }` and returns `{ id }`. The Mac app on that host picks the session up (authenticated as the host via `x-host-id`/`x-host-token`, see `lib/desktop-hosts.ts`), shows an Allow prompt when `askOnComputer` is on, and writes back the answer.
- **`GET /api/remote/sessions/<id>`**: the viewer polls for `{ status, answer, error }`; `answer` is only returned when `status === "answered"`, and only to the session's own `viewer_user_id` (404 otherwise).
- **`DELETE /api/remote/sessions/<id>`**: owner-viewer sets `status: "ended"` + `ended_at`.

## 🧩 Supporting Module: `lib/desktop-hosts.ts`

Server-only helpers shared with the desktop API routes: the `HostRow` shape (including the `settings` union `whoCanControl` / `askOnComputer` / `runnerEnabled` / `localDefault: { app } | false`), constant-time `hostFromRequest` auth (`x-host-id` + `x-host-token` hashed and compared via `hashAgentApiKey`), `orgRoleOf`, `pickDefaultApp` (readiness-ordered: Claude Code, Codex, Copilot, Cursor, Gemini CLI, OpenCode, then the rest of `MAC_CLI_APP_IDS`), `withLocalDefault` (auto-enables the runner the first time a signed-in CLI appears; once the owner turns the default off, leaves it alone), and `macDefaultApp` (used by onboarding's "no key needed" option).

## Related docs

- [Settings UI](./settings-ui.md) — the settings shell this page lives in
- [App overview](./app-overview.md) — workspace shell and update plumbing shared with the Mac app
- [lib-reference](./lib-reference.md) — `desktop-bridge.ts` / `desktop-hosts.ts` / `mac-runner.ts` details
- [Agents UI](./agents-ui.md) — agents configured to run "on this computer"
- [Onboarding](./onboarding.md) — the "no key needed" path that reads `macDefaultApp`
- ../../architecture/security-model.md — host token auth and permission checks
- ../../database/schema-computers-devices-desktop.md — `desktop_hosts`, `remote_sessions`, `org_computer_settings` tables
- ../../../tools-and-sandboxes.md — computerd sandboxes (the agent-side computers, distinct from these desktop hosts)
- ../../../desktop-guest-mode.md — the desktop app that answers these sessions
