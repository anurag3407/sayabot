# Sayabot Desktop — Install & Auto-Updates

The Mac app updates itself without a package manager or auto-update service: it asks the Sayabot server which version is newest, downloads that exact version's DMG, verifies the app inside really is that version, and then quits so a detached shell helper can swap `/Applications/Sayabot.app` and reopen it. `updater.ts` is the state machine; `mac-install.ts` is the download/verify/swap mechanics. Distribution and signing are covered in [auto-updates.md](../../auto-updates.md) and [macos-signing-and-notarization.md](../../macos-signing-and-notarization.md).

Source files: `apps/desktop/src/updater.ts`, `src/mac-install.ts`, wiring in `src/main.ts`

---

## ⏰ When Updates Are Checked (`src/main.ts:1077-1086`)

`DesktopUpdater.check(false)` runs: **15 seconds after launch**, then **every hour**, and on `browser-window-focus` whenever more than **10 minutes** have passed since the last check. Automatic checks never interrupt — they only update the menu, a notification, and the workspace page. Manual checks ("Check for Updates…" menu, `checkForUpdatesWithDialog` at `src/main.ts:506`) answer in dialogs.

`fetchVersion` (`src/main.ts:455-462`) calls `GET <serverUrl>/api/version` (10 s timeout) — the **signed-in server**, so self-hosted deployments distribute their own builds. The response `VersionInfo` (`src/updater.ts:16-21`) carries `latestDesktopVersion`, per-arch `dmgUrls`, an optional `dmgUrl`, and `releaseNotes`.

The `DesktopUpdater` is constructed in `main.ts` (`src/main.ts:452-478`) with injected dependencies, so the state machine itself has no Electron or network code and is fully unit-tested (`updater.test.ts`):

| Dep | Provided by `main.ts` |
| :--- | :--- |
| `currentVersion` / `arch` | `app.getVersion()` / `process.arch` |
| `fetchVersion` | `GET <updateServerBase()>/api/version` — base is the session's `serverUrl`, else the config's, else `https://sayabot.sayalabs.in` (trailing slashes stripped) |
| `download` | `downloadFile` from `mac-install.ts` |
| `inspect` | `inspectDmg` from `mac-install.ts` |
| `install` | `installTarget` + `canReplace` + `runDetached(stageMacUpdate(...))` + `quitForUpdate()` |
| `dmgPath` | `temp/sayabot-updates/Sayabot-<version>.dmg` |

## 🚦 The State Machine (`DesktopUpdater`, `src/updater.ts:71`)

One `UpdateState` is shared by the menu (`updateMenuItem`, `src/main.ts:544`), the macOS notification, and the renderer (broadcast on `app:update-state` to every window on every change, `src/main.ts:489-503`), so they can never disagree:

| Status | Extra fields | Set when |
| :--- | :--- | :--- |
| `idle` | `checkedAt` | No update, or up-to-date after a check |
| `checking` | — | A check is in flight (menu shows a disabled item) |
| `available` | `latest`, `notes` | The server's `latestDesktopVersion` is a strictly newer semver; `notes` is trimmed `releaseNotes` |
| `downloading` | `latest`, `percent` (number or null) | DMG download in progress; percent is de-duplicated before broadcast |
| `installing` | `latest` | DMG verified; the helper is about to swap the app |
| `error` | `message`, `latest` (null unless a check succeeded first) | Any failure in check/download/verify/install |

```
idle → checking → available → downloading → installing   (success path)
                ↘ idle (up to date)      ↘ error (any step)
```

- `check(manual)` (`src/updater.ts:103`) — no-op while downloading/installing; concurrent checks share one promise. Version comparison is strict semver via `parseVersion`/`isNewer` (`src/updater.ts:39-53`) — a malformed `latestDesktopVersion` throws. On failure, a **manual** check reports `{ status: "error", message }`, but an **automatic** check silently keeps the previous state (a flaky network must not flash an error).
- `install()` (`src/updater.ts:133`) — idempotent (a second call returns while busy). Downloads via `deps.download`, then **verifies**: `inspectDmg` mounts the DMG read-only and reads `CFBundleShortVersionString` from the enclosed `Sayabot.app`; anything other than the expected version aborts with "The download is version X, not Y. Nothing was changed." Only then does it flip to `installing` and call `deps.install`.
- `NotPublishedError` (HTTP 404 from the download) becomes "Sayabot X is still being published. Try again in a few minutes."

### Pinned download URLs (`dmgUrlFor`, `src/updater.ts:59`)

A "latest" link could hand over a different build than the one the version check saw, so the URL is pinned to the checked version's own release:

1. `dmgUrls[arm64|x64]` if given;
2. else `dmgUrl` **unless** it points at `/releases/latest/download/` (rewriting its arch suffix);
3. else the GitHub release asset `https://github.com/anurag3407/sayabot/releases/download/v<version>/Sayabot-<chip>.dmg` (`REPO_DOWNLOADS`).

Progress: `downloadFile` streams the response through a counting `Transform` and reports whole-number percentages (or `null` when `content-length` is missing); the updater de-duplicates repeated percentages before broadcasting state (`src/updater.ts:147-152`). The DMG lands in `temp/sayabot-updates/Sayabot-<version>.dmg`. A truncated download (`received !== total`) fails.

`install()` step by step (`src/updater.ts:133-172`):

1. Busy? return. Not `available`? run a **manual** `check(true)` and bail unless an update became available (so "Install Update…" from the menu works without a prior check).
2. Resolve `dmgPath` and the pinned `dmgUrlFor`, set `downloading` with `percent: 0`.
3. Download, broadcasting only new whole percentages.
4. `inspect` the DMG: version must equal `latest`, else error ("Nothing was changed") and the stale DMG simply remains in temp.
5. Set `installing`, call `deps.install` (which spawns the helper and quits — the process may be gone before this promise resolves; errors after this point surface only in `update.log`).
6. Any thrown error maps to a `error` state with a plain message (`NotPublishedError` special-cased).

---

## 🔁 The Swap Helper (`src/mac-install.ts`)

### Choosing the target (`installTarget`, `src/mac-install.ts:20`)

The update replaces **the copy that is running**: the bundle path is derived from `process.execPath`. Apps started from a mounted volume (`/Volumes/`) or macOS App Translocation install to the fallback `/Applications/Sayabot.app` instead.

`canReplace(target)` (`src/mac-install.ts:29`) checks the containing folder and the app itself are writable; if not, `main.ts` opens the DMG in Finder for a manual drag and throws ("Sayabot can't replace itself in …"), leaving the app untouched.

### The script (`macUpdateInstallScript`, `src/mac-install.ts:44`)

`stageMacUpdate` (`src/mac-install.ts:141`) writes the generated bash script (mode 0o755) into a fresh `sayabot-update-*` temp dir; `runDetached` spawns `bash <script>` detached/unref'd; `main.ts` then quits via `quitForUpdate` (`src/main.ts:481`) — a normal `app.quit()` with a 5-second force `app.exit(0)` in case something holds the quit up.

The script, with `set -uo pipefail` and everything logged to `~/Library/Logs/Sayabot/update.log`:

1. Waits up to 60 s (300 × 0.2 s) for the app's PID to exit; fails if it never quits.
2. `hdiutil attach` the DMG `-nobrowse -readonly -noautoopen` and locates `Sayabot.app` (max depth 2).
3. Verifies the bundle's `CFBundleShortVersionString` equals the expected version (`PlistBuddy`).
4. `ditto`-copies the new app to `TARGET.new`, moves the running app to `TARGET.old`, renames `.new` → target, deletes `.old`.
5. Strips the quarantine xattr, detaches, deletes the DMG, and `open "$TARGET"` — Sayabot relaunches itself.

**Rollback on any failure**: detach, remove `TARGET.new`, and if the target is missing but `.old` exists, move it back — then reopen the old app, so a failed update never leaves you without Sayabot.

Files involved, at a glance:

| Path | Role |
| :--- | :--- |
| `temp/sayabot-updates/Sayabot-<version>.dmg` | downloaded update (deleted by the helper on success) |
| `temp/sayabot-update-XXXX/install.sh` | the staged helper script (0o755, in a fresh mkdtemp dir) |
| `~/Library/Logs/Sayabot/update.log` | the helper's complete log — the only place install failures are visible after the app quits |
| `/Applications/Sayabot.app` → `.new` → `.old` | the swap dance |

---

## 🖥️ Update UI Surfaces (`src/main.ts`)

- **Menu** (`updateMenuItem`, `src/main.ts:544`): state-dependent label — "Check for Updates…", "Install Sayabot X…", disabled "Downloading X (n%)…"/"Installing X…"/"Checking…", or "Retry Installing Sayabot X…" after an error with a known version.
- **Notification** (`src/main.ts:489-503`): exactly **once per version** (`notifiedVersion` guard), "Sayabot X is available — Click to install"; clicking triggers `updater.install()`.
- **Workspace page**: the `app:update-state` push plus the bridged IPC — `app:check-for-updates` (manual shows dialogs), `app:get-update-state`, `app:install-update`, `app:get-version`; the legacy `app:restart` from older "update ready" toasts reloads the page instead of relaunching (`src/main.ts:996-998`).
- **Manual dialog** (`checkForUpdatesWithDialog`, `src/main.ts:506`): if a download/install is already running it reports that with the percent done; otherwise it runs the check and then either prompts "Install Now / Later" (with release notes and the current version in the detail), reports "Sayabot is up to date — you have version X", or shows the check error as a warning.

---

## 📦 First-Run Distribution Notes

There is **no first-run installer logic in this codebase's desktop app** — no CLI shims are written and PATH setup is read-only (the runner and binary search look in Homebrew, nvm/volta/fnm, and `~/.local/bin` locations; see [local-agents-and-injector.md](./local-agents-and-injector.md)). What ships is the electron-builder artifact: DMG + zip per arch (scripts `package:mac`/`package:dmg`/`package:arm64`/`package:x64`), hardened runtime with `build/entitlements.mac.plist`, `afterSign: build/adhoc-sign.cjs`, `publish: null`, and the `sayabot://` protocol registration that macOS records at install time (see [overview.md](./overview.md)). Signing/notarization status and the full checklist live in [macos-signing-and-notarization.md](../../macos-signing-and-notarization.md).

## 🧪 Tests

`updater.test.ts` covers version comparison, URL pinning and state transitions; `mac-install.test.ts` covers `installTarget` (translocation/volume/fallback), `bashSingleQuote`, and the generated install script's rollback steps.

---

## 🪟 Windows updates (`src/win-install.ts`)

The same `DesktopUpdater` runs on Windows. `main.ts` sets `platform: "win32"`, so `install()` downloads `winZipUrlFor` (`Sayabot-win-<arch>.zip` pinned to the checked version, or `winUrls[arm64|x64]` from `GET /api/version`) instead of a DMG. `inspect` is `inspectWinZip`: PowerShell `Expand-Archive`, then `Sayabot.exe`'s `ProductVersion`, normalized by `normalizeProductVersion` (`1.2.3.0` → `1.2.3`).

`installTargetWin(exe)` is the directory containing the running `Sayabot.exe`. A dev `electron.exe` falls back to `%LOCALAPPDATA%\Programs\Sayabot`. `canReplaceWin` requires that folder (and its parent) to be writable. If it is not, the zip is opened and the update stops with a message to run `Sayabot Setup`.

`stageWinUpdate` writes `install.ps1` and `runDetachedWin` starts it with Windows PowerShell, then the app quits. The script waits up to 60 seconds for the app PID to exit, expands the zip, checks the product version, robocopies into `Sayabot.new`, renames the live folder to `Sayabot.old`, renames `.new` into place, deletes `.old` and the zip, and `Start-Process`es `Sayabot.exe`. On failure it removes `.new` and, if `Sayabot.exe` is gone but `.old` exists, moves `.old` back and reopens it. The log is `%LOCALAPPDATA%\Sayabot\Logs\update.log`.

First-run install is the NSIS exe (`Sayabot-Setup-<arch>.exe`), not the zip. `apps/web/public/install-windows.ps1` downloads that exe and runs it with `/S`. The download page and `/download/windows` (default x64, `?arch=arm64` for ARM) point at the setup exe. CI (`.github/workflows/desktop-release.yml`, job `build-windows`) builds both arches on `windows-latest` after the Mac job has published the release, then `gh release upload`s the exe and zip files.

## Related docs

- [Overview (lifecycle, IPC, storage)](./overview.md)
- [Host service (registration & heartbeat)](./host.md)
- [Auto-Updates architecture & guide](../../auto-updates.md)
- [macOS code signing & notarization](../../macos-signing-and-notarization.md)
- [Desktop Host API (server side)](../web/api/api-desktop.md)
