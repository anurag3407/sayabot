# Sayabot Desktop — Overview

`apps/desktop` is the **Electron app** ("Sayabot", bundle id `in.sayalabs.sayabot.desktop`) for macOS and Windows: a controller window that signs in (or starts as a guest), opens the Sayabot workspace in-app, and turns that computer into a **Sayabot host** — reporting to the server, answering remote-desktop requests, running local agent jobs, fulfilling secret lookups and local MCP calls. This page documents the app lifecycle, window management, the IPC surface between main and renderer, secure session/config storage, server URL resolution, and the packaging scripts.

Source files: `apps/desktop/src/main.ts`, `src/preload.ts`, `src/remote-preload.ts`, `src/storage.ts`, `src/server-url.ts`, `package.json`

---

## 🚀 App Lifecycle (`src/main.ts`)

`main.ts` is the Electron main process. On module load it:

1. **Registers the `sayabot://` URL scheme** — via `app.setAsDefaultProtocolClient`, passing `process.execPath` + the script path when running from `process.defaultApp` (dev). The Windows NSIS installer also registers the scheme (`package.json` `build.win.protocols`).
2. **Enforces a single instance** — `app.requestSingleInstanceLock()`; a second launch quits, and its `second-instance` event refocuses the window and handles any `sayabot://` argument found in `argv`.
3. **Handles deep links** — macOS `open-url` events are queued in `pendingDeepLinkUrl` if the app is not ready yet, then processed by `handleDeepLink`. On Windows the first launch puts `sayabot://` on `process.argv`; `app.whenReady` copies that into `pendingDeepLinkUrl` before the window is created. A second launch still arrives through `second-instance`. `handleDeepLink`:
   - `sayabot://connect?server=<url>` — shown by a self-hosted server's download page; always runs `connectFromLink`, which validates the server (`checkServer`), asks for confirmation in a dialog ("Only connect to servers you trust"), and switches via `useServer`. A link can never silently move the app to another server.
   - `sayabot://auth/callback` (or host `auth`) — carries `access_token`, `refresh_token`, `email`, `user_id`, `server_url` query params from the browser login; saved as the `AuthSession` (`src/main.ts:18-26`), the host restarts (`startHost`), the workspace opens, and `auth:session-updated` is broadcast to the renderer. If the previous session was a different non-guest user, `host?.forget()` drops the old computer registration.
4. **`app.whenReady()`** (`src/main.ts:1064-1087`) — creates the window, calls `startHost()`, re-creates the window on `activate` (macOS dock clicks), and schedules update checks: first at 15 s, then hourly, plus a focus-triggered check at most every 10 minutes.
5. **Teardown** — `before-quit` stops the runner and host (`src/main.ts:1089-1092`); `window-all-closed` quits on non-darwin only (`src/main.ts:1094-1098`), so closing the window keeps the Mac hosted.

### Session keeping

`refreshSessionIfNeeded` (`src/main.ts:686`) decodes the access token's JWT payload and refreshes when it expires within 10 minutes, via `POST /api/desktop/refresh` with the refresh token. A `401` clears the session locally (revoked/merged login); a successful refresh persists the new tokens, restarts the host, and returns the updated session. A background `setInterval` runs it **every 15 minutes** (`src/main.ts:757-759`) so tokens never expire.

### Guest mode

`createGuestSession` (`src/main.ts:829`) implements [Desktop guest mode](../../desktop-guest-mode.md): it fetches `GET /api/desktop/guest` for `{ enabled, supabaseUrl, anonKey }`, then signs up an **anonymous Supabase user** directly from the Mac (so the Mac's own IP is rate-limited) with no email/password and `data: { signup_source: "desktop_guest" }`. The returned tokens become an `AuthSession` with `isGuest: true`. `auth:guest-status` (`src/main.ts:872`) tells the controller page whether to auto-start a guest (`serverChosen` && !`guestDeclined` && guest allowed), needs a server choice, or should show sign-in. `auth:start-guest` (`src/main.ts:912`) deduplicates concurrent starts through `guestInFlight`. Guests sign in later via `signInFromMenu` (`src/main.ts:793`), which asks `POST /api/account/merge` for a merge-link URL so the guest workspace travels into the real account.

---

## 🪟 Window Management

`createWindow` (`src/main.ts:640`) builds a single `BrowserWindow`:

- 1240×840 (min 900×600), background `#070907`. On macOS the title bar is `hiddenInset` with traffic lights at `{x:16, y:16}`. On Windows the native title bar is kept so the window can move, minimize, and close.
- `webPreferences`: `preload.js`, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: false` (the preload needs full `ipcRenderer`).
- `setWindowOpenHandler` denies every `window.open` and forwards the URL to `shell.openExternal` (`src/main.ts:659-662`) — no popups inside the app.

Two content modes share this window:

- **Controller page** — `loadLocalHtml` (`src/main.ts:290`) loads `dist/renderer/index.html`, falling back to `src/renderer/index.html` when running from source. The page is the start screen: server choice, guest start, sign-in card, and runner status (it calls the `sayabotDesktop` bridge). It uses the app's graphite + iris palette and shows the live mascot trio (`renderer/mascots/{pip,nova,moss}-live.svg`, exported by `pnpm --filter @sayabot/web brand:mascots`) in place of a static logo; the trio hops while a guest workspace is being set up or browser sign-in is pending. The text links are real `<button>`s and errors are `role="alert"`.
- **Workspace** — `openWorkspaceInWindow` (`src/main.ts:761`) refreshes the session and loads `<serverUrl>/auth/complete#access_token=…&refresh_token=…`, so the web app picks up the login from the URL hash with no password entry. On launch, an existing session opens the workspace directly (`src/main.ts:668-676`).

Menu items "Return to Controller" (⌘H) and "Open Workspace in Window" (⌘W) flip between the two; `changeServerFromMenu` (`src/main.ts:299`) signs out, tears down host/runner/vault/MCP singletons, resets `serverChosen`, and reloads the controller. `app:restart` IPC does **not** relaunch the app — it reloads the workspace page ignoring cache (`src/main.ts:996-998`).

---

## 🌉 The IPC Surface

### Controller bridge (`src/preload.ts`)

The preload exposes one object, `window.sayabotDesktop` (`DesktopBridge`, `src/preload.ts:17-48`), via `contextBridge.exposeInMainWorld`. Every method is an `ipcRenderer.invoke` round trip:

| Bridge method | IPC channel | Main handler |
| :--- | :--- | :--- |
| `getSession()` | `auth:get-session` | returns `AuthSession \| null` (`src/main.ts:775`) |
| `startBrowserAuth()` | `auth:start-browser-auth` | opens `<server>/login?force=true&next=/auth/desktop` in the browser (`src/main.ts:779`) |
| `getGuestStatus()` | `auth:guest-status` | `{ autoStart, needsServerChoice, guestAllowed }` |
| `getServerInfo()` | `config:server-info` | `{ url, name, isCloud, chosen }` |
| `checkServer(input)` | `config:check-server` | runs `checkServer` (see below) |
| `chooseServer(input)` | `config:choose-server` | checks + `useServer`; null means Sayabot Cloud (`src/main.ts:898`) |
| `startGuest()` | `auth:start-guest` | creates the anonymous session |
| `signOut()` | `auth:sign-out` | sets `guestDeclined`, clears session, `host?.forget()`, clears web storage (`src/main.ts:935`) |
| `getServerUrl()` / `setServerUrl(url)` | `config:get-server-url` / `config:set-server-url` | normalized via `normalizeServerUrl` |
| `openWorkspaceInWindow()` / `openWorkspaceInBrowser()` / `returnToController()` | `workspace:*` | window navigation / opens `<server>/login` externally |
| `getLocalRunnerStatus()` / `toggleLocalRunner()` | `runner:get-status` / `runner:toggle` | `{ running, busy, port: 4100 }` — the runner is enabled from the web's Computers settings, so the toggle just reports (`src/main.ts:990`) |
| `restartApp()` | `app:restart` | reloads the page (see above) |
| `getVersion()` | `app:get-version` | `app.getVersion()` |
| `checkForUpdates(manual?)` / `getUpdateState()` / `installUpdate()` | `app:*` | desktop updater (see [install-and-updates.md](./install-and-updates.md)) |
| `getPlanLimits(force?)` / `getLocalUsage(days)` | `usage:plan-limits` / `usage:local` | gated by `fromWorkspace` (see [usage-and-cloud-handoff.md](./usage-and-cloud-handoff.md)) |
| `onUpdateState(cb)` / `onSessionUpdate(cb)` | events `app:update-state` / `auth:session-updated` | push events; both return unsubscribe functions |

`host:get-status` (`src/main.ts:983`) is a registered-but-unbridged channel returning `{ registered, settings }` from `host.lastReply`.

### Remote-host bridge (`src/remote-preload.ts`)

The hidden WebRTC capture window gets a minimal `window.remoteHost` bridge (`src/remote-preload.ts:4-11`):

- `onStart(cb)` — receives `remote-host:start` with `{ sessionId, offer, sourceId }`.
- `answer(sessionId, answer)` / `ended(sessionId, reason?)` / `input(sessionId, raw)` — sent to channels `remote-host:answer` / `remote-host:ended` / `remote-host:input`, which `DesktopHost` subscribes to in its constructor (`src/host.ts:175-181`).

The capture window's page (`src/renderer/remote-host.html`) captures the screen with `chromeMediaSource: "desktop"` (capped at 1920×1200 @ 30 fps), answers the viewer's SDP offer over an `RTCPeerConnection` (Google STUN), relays data-channel input messages (≤ 2,000 chars) back to main, and stops tracks if the viewer never connects within 45 s.

---

## 🔐 Config, Session & Host Credential Storage

Three JSON files live in Electron's `userData` directory (`getUserDataDir`, `src/main.ts:238`):

| File | Written by | Contents |
| :--- | :--- | :--- |
| `sayabot-config.json` | `loadConfig`/`saveConfig` (`src/main.ts:242-262`) | `serverUrl` (default `https://sayabot.sayalabs.in`), `enableLocalRunner` (default true), `guestDeclined`, `serverChosen`, `serverName`, `serverGuestMode` |
| `sayabot-session.json` | `loadSession`/`saveSession` (`src/main.ts:264-288`) | access/refresh tokens, email, user id, server URL, `isGuest`; `saveSession(null)` deletes the file |
| `sayabot-host.json` | `saveHostAuth` (`src/host.ts:73-80`) | the computer registration: `hostId`, `hostToken`, `serverUrl`, `userId` — written with **mode 0o600** |

The host token is the long-lived computer credential (see [host.md](./host.md)); everything the server needs for account identity travels as bearer tokens over HTTPS, and no plaintext of Sayabot's own secrets is stored on disk beyond these session files.

### Server checks (`checkServer`, `src/main.ts:50`)

`checkServer` normalizes the input, then fetches `GET /api/instance` (8 s timeout, `redirect: "manual"`) and expects `{ sayabot: true, name?, edition?, guestMode? }`. Older servers without `/api/instance` are probed in the same round trip via `checkLegacyServer` (`src/main.ts:85`): `GET /api/version` must return `latestDesktopVersion`, and `GET /api/desktop/guest` supplies guest mode. Failures map to plain-language errors (timeout, DNS, TLS, "isn't running Sayabot").

`useServer` (`src/main.ts:111`) handles switching: leaving a non-Cloud server runs `leaveCloudHome` (snapshot return, see [usage-and-cloud-handoff.md](./usage-and-cloud-handoff.md)) and writes `cloud-home-return.json`; leaving Cloud saves the snapshot to `cloud-home.json` via `fetchWorkspaceSnapshot`. It then persists the new server, and on an actual switch clears the session and stops host/runner/vault/MCP.

---

## 🧭 Server URL Resolution (`src/server-url.ts`)

`normalizeServerUrl(input)` (`src/server-url.ts:2`) turns typed input into a base URL, returning `null` for anything unusable:

- Rejects empty input, whitespace, or a non-http(s) scheme (so `ftp://` etc. fail).
- Adds a scheme: **`http://`** for local-looking hosts (`localhost`, `127.*`, `10.*`, `192.168.*`, `172.16-31.*`, `*.local`), **`https://`** otherwise.
- Requires a plausible hostname (a dot, `localhost`, or an IP).
- Returns `protocol//host/path` with trailing slashes stripped — no query, no fragment.

---

## 📦 Disk Usage Report (`src/storage.ts`)

`measureLocalStorage` (`src/storage.ts:51`) feeds the heartbeat's storage field. `folderSize` walks iteratively, skips symlinks, and caps at `MAX_ENTRIES` (200,000) entries — hitting the cap marks the result `approximate: true` so a huge folder can't stall the app. It measures:

- **`appData`** — Electron's `userData` folder.
- **`agents`** — each directory under `~/Sayabot/agents/` (the local runner's per-agent working folders, up to 100), sized individually and sorted largest first.

The result (`LocalStorageReport`) carries `measuredAt` plus `{ bytes, files, approximate }` per folder.

---

## ⚙️ Scripts & Build Config (`package.json`)

| Script | What it does |
| :--- | :--- |
| `dev` | `tsc` → `build:usage` → `node scripts/copy-renderer.mjs` → `electron .` |
| `build` | same without launching Electron. The renderer copy is Node `fs.cpSync`, so it runs on Windows as well as macOS. |
| `build:usage` | esbuild-bundles `src/usage/index.ts` to `dist/usage.js` (CJS, node20 target) — a separate bundle because it imports `@sayabot/core/scanner` |
| `typecheck` | `tsc --noEmit` for the app plus `tsc -p tsconfig.usage.json` for the usage module (`tsconfig.usage.json` is a no-emit ESNext/Bundler project that excludes tests) |
| `package:mac` / `package:dmg` / `package:arm64` / `package:x64` | `electron-builder` targets: `dmg`+`zip` |
| `package:win` / `package:win:x64` / `package:win:arm64` | `node scripts/make-ico.mjs` (wraps `assets/icon.png`, the Saya icon written by `pnpm --filter @sayabot/web brand:icons`, into `build/icon.ico`), then `electron-builder --win nsis zip`. Produces `Sayabot-Setup-<arch>.exe` (first-run installer) and `Sayabot-win-<arch>.zip` (the file the in-app updater swaps). Run these on Windows. Root aliases: `pnpm desktop:package:win`, `desktop:package:win:x64`, `desktop:package:win:arm64`. `deploy/desktop/package-windows.ps1` is the same x64 build (arm64 when `SAYABOT_WIN_ARM64=1`). |
| `test` | `vitest run` (unit tests live next to sources) |

The `build` (electron-builder) block: appId `in.sayalabs.sayabot.desktop`, product name **Sayabot**, mac category `public.app-category.developer-tools`, **hardened runtime** with `build/entitlements.mac.plist`, `afterSign: build/adhoc-sign.cjs` (no-op unless the platform is `darwin`), `publish: null` (updates come from the Sayabot server, not a binary publish channel), artifact `Sayabot-${arch}.${ext}` into `dist/installers` for Mac. It registers the `sayabot` URL scheme as an installer protocol, and `extendInfo` declares the two macOS usage descriptions the remote host needs: `NSAppleEventsUsageDescription` (System Events keystrokes) and `NSScreenCaptureUsageDescription` (screen sharing during allowed sessions). The DMG layout is a 660×400 window with a background image and the standard app + Applications link.

Windows (`build.win` + `build.nsis`): per-user NSIS installer (`oneClick: false`, `perMachine: false`, `requestedExecutionLevel: asInvoker`) so the app runs in the signed-in session and can see that user's CLIs. Default folder is `%LOCALAPPDATA%\Programs\Sayabot`. Artifacts are `Sayabot-Setup-${arch}.exe` and `Sayabot-win-${arch}.zip`. The icon is `build/icon.ico`, generated from `assets/icon.png` by `scripts/make-ico.mjs` before packaging. There is no Authenticode certificate in CI (`CSC_IDENTITY_AUTO_DISCOVERY=false`); SmartScreen will warn until one is added.

---

## Related docs

- [Host service (registration & heartbeat)](./host.md)
- [Local runner & event streaming](./runner-and-stream.md)
- [Install & updates](./install-and-updates.md)
- [Usage scanning & cloud handoff](./usage-and-cloud-handoff.md)
- [Desktop Host API (server side)](../web/api/api-desktop.md)
- [Agents on your Mac](../../agents-on-your-mac.md)
- [Desktop guest mode](../../desktop-guest-mode.md)
- [Workspace Shell & UI Kit](../web/pages/ui-shell-and-kit.md)
