# Push Notifications & App Updates

Two independent update channels keep the phone current: Expo push notifications deliver agent questions (with an inline "Answer" text field) and danger-tool approvals (Allow / Don't allow) whose actions post straight back to the web API without opening the app; `expo-updates` handles over-the-air JS updates on load, with a fallback version check against the self-hosted server's `/api/mobile/version` that offers an APK download. This page documents the notification handler, channels and categories, token registration lifecycle, tap/interaction routing, and both update paths.

Source files: `src/core/push.ts`, `src/hooks/useAppUpdates.ts`

---

## 🔔 Notification handler & channels (`src/core/push.ts`)

### Global handler

`Notifications.setNotificationHandler` runs at module load: alerts are shown and audible with badges set — except notifications whose request identifier is `"agent-working"`, the Android working-status notification, which never pops an alert or plays a sound while the app is open (`push.ts:17-24`).

### Channels and categories

`configureNotifications()` (called once from `SignedInEffects` after sign-in, see [Overview](overview.md)) sets up:

- **Android channels** (`push.ts:27-39`):
  - `"agents"` — "Questions and approvals", `AndroidImportance.HIGH`, light color `#9d8cff` (matching the app's notification accent from `app.json`), vibration pattern `[0, 180, 120, 180]`.
  - `"status"` — "Agent activity", `AndroidImportance.LOW`, `showBadge: false` (hosts the working-status notification).
- **iOS/Android interaction categories** (`push.ts:40-52`):
  - `"question"` — an **"Answer"** button with an inline text input (`submitButtonTitle: "Send"`, placeholder "Your answer") and an **"Open"** button; both `opensAppToForeground: true`.
  - `"approval"` — **"Allow"** and **"Don't allow"** (marked `isDestructive`), both opening the app to the foreground.

---

## 📮 Token registration (`enablePush` / `disablePush`)

`enablePush(prompt = true)` returns a boolean (`push.ts:55-65`):

1. Requires a physical device — on a simulator it throws `"Alerts need a real phone, not a simulator."` (`Device.isDevice` check).
2. Reads existing permission status; only when not granted and `prompt` is true does it call `requestPermissionsAsync()`. Returns `false` silently when the person declines — callers treat `false` as "not enabled" (e.g. the onboarding chip).
3. Obtains the Expo push token via `getExpoPushTokenAsync({ projectId })`, where the project id comes from `Constants.expoConfig.extra.eas.projectId` (`c593211b-…` in `app.json:48-51`).
4. Registers it with `api("/api/mobile/push", { body: { token, platform: Platform.OS } })` — `POST /api/mobile/push`, the upsert endpoint documented in [Mobile App API](../web/api/api-mobile.md) (token regex-validated server-side).
5. Caches the token in AsyncStorage under `@sayabot/push_token` so it can be unregistered later.

`disablePush()` (`push.ts:67-71`) reads the cached token and `DELETE`s `POST`-style via `api("/api/mobile/push", { method: "DELETE", body: { token } })` (errors swallowed), then removes the key.

**Who calls these** (`push.ts` consumers):

- `SignedInEffects` calls `enablePush(false)` (no permission prompt) whenever `settings.pushNotifications` is on, on every sign-in (`RootNavigator.tsx:44-46`).
- The onboarding "Get alerts" chip calls `enablePush(true)` (with prompt) and persists the setting on success (`OnboardingScreen.tsx:85-93`).
- AdvancedScreen's "Alerts on this phone" toggle calls `enablePush()`/`disablePush()` and flips the setting; failures surface in the footer note (see [Computers & share](computers-and-share.md)).

---

## 👆 Interaction handling (`handleNotificationResponse`)

Alert payloads carry `AlertData` `{ kind?: "approval" | "request", refId?, roomId?, orgSlug? }` (`push.ts:73-78`). Responses arrive from three places, all wired in `SignedInEffects` (`RootNavigator.tsx:38-43`): a `addNotificationResponseReceivedListener`, `getLastNotificationResponseAsync()` for the cold-start tap, and the module-level categories.

Because on a cold start both the listener and `getLastNotificationResponseAsync()` can report the same tap, responses are deduplicated by a `handledResponses` Set keyed `"<notificationId>:<actionIdentifier>"` — without it, an answer typed into the notification would post twice (`push.ts:80-90`).

Action routing (`push.ts:91-106`):

| Action | Behavior |
| :-- | :-- |
| `"answer"` (question category, with `userText`) | `POST /api/mobile/inbox/answer` with `{ orgSlug: data.orgSlug, taskId: data.refId, answer: response.userText.trim(), alsoPost: false }`, then schedules a local confirmation alert "Answer sent" echoing the first 100 characters. Returns without opening the app. |
| `"allow"` / `"deny"` (approval category) | `POST /api/v1/tools/{data.refId}/approve` with `{ approved: action === "allow" }` — the same approval endpoint the in-chat card uses. Returns without opening the app. |
| API failure on either | Falls through to navigation so the person can act in the app instead (`push.ts:101-103`). |
| Plain tap, `kind: "request"` | `navigateWhenReady("MainTabs", { screen: "InboxTab" })` — opens the Inbox tab. |
| Plain tap with `data.roomId` | `navigateWhenReady("Chat", { roomId, roomName: "Chat", orgSlug })`. |

`navigateWhenReady` queues navigation until the container is ready (see [Navigation & auth](navigation-and-auth.md)).

---

## 🟢 Working-status notification (`showWorkingStatus`)

Android-only: an ongoing, sticky, low-priority notification (identifier `"agent-working"`, channel `"status"`) titled "Sayabot" whose body names the agents currently working, e.g. "Hermes, Scout are working in job-hunt…" (`push.ts:108-120`; text built from `useHome()` data in `RootNavigator.tsx:67-81`). Passing `null` dismisses it. The app sets it when entering the background and clears it on foreground; the module-level notification handler suppresses its alert/sound so it never interrupts (`push.ts:17-24`).

---

## 🛠️ OS wiring & permissions

- **Android `POST_NOTIFICATIONS`** is declared in `app.json` (`app.json:34`), required on Android 13+ before any channel or notification works; `configureNotifications()` only creates the channels and categories, while runtime permission is requested by `enablePush` (or pre-granted by the OS install-time default on older versions).
- **iOS Face ID permission string** ("Sayabot uses Face ID to keep your chats private when App lock is on.") comes from the `expo-local-authentication` plugin, unrelated to push but configured alongside it in `app.json:62-66`.
- The notification icon and accent color for Android notifications come from the `expo-notifications` plugin config (`./assets/notification-icon.png`, color `#9d8cff`) — the same iris used for the `"agents"` channel light color (`app.json:69-74`).
- `SignedInEffects` also registers the cold-start response listener once per sign-in and removes it on unmount, so a stale listener cannot double-handle taps after a server switch restart (`RootNavigator.tsx:38-43`).

---

## 🔄 App updates (`src/hooks/useAppUpdates.ts`)

`useAppUpdates()` returns `{ isChecking, isUpdateAvailable, isDownloading, isDownloaded, updateType, latestVersion, apkUrl, releaseNotes, errorMessage, currentVersion, checkForUpdates, applyUpdate }` (`useAppUpdates.ts:186-192`). `CURRENT_APP_VERSION` is `Constants.expoConfig?.version ?? "1.1.0"` — the Expo config version (`app.json` has `1.1.0`). Version comparison is a hand-rolled semver triple (`parseSemver` strips a leading `v`, tolerates non-numeric parts as 0; `isNewerVersion` compares major/minor/patch) (`useAppUpdates.ts:22-37`).

### Status flags

| Flag | Set when |
| :-- | :-- |
| `isChecking` | A check is running (cleared at every exit path) |
| `isDownloading` | An OTA update was found and `fetchUpdateAsync()` is in flight |
| `isDownloaded` | The OTA bundle is fetched and ready for `reloadAsync()` |
| `updateType` | `"ota"` (OTA found, short-circuits the rest of the check) or `"apk"` (server `latestVersion` is newer) or `null` |
| `latestVersion` / `apkUrl` / `releaseNotes` | Copied from the `/api/mobile/version` response when `updateType` is `"apk"` |
| `errorMessage` | Reset to `undefined` at the start of every check; fetch failures surface only through manual-check alerts, not this field |

### `checkForUpdates(manual)` — two-stage check

**Stage 1: Expo OTA** (`useAppUpdates.ts:53-90`), only when `Updates.isEnabled` (true in release builds per `app.json` `updates.enabled`):

- `Updates.checkForUpdateAsync()` — when an update is available it immediately `fetchUpdateAsync()`s, flags `updateType: "ota"` + `isDownloaded`, and prompts: "Update Ready — A new update has been downloaded. Restart Sayabot now to apply changes?" with **Later** / **Restart Now** (`Updates.reloadAsync()`). The check returns after this; the server check is skipped.
- OTA failures are warned and swallowed, falling through to stage 2.

**Stage 2: self-hosted APK releases** (`useAppUpdates.ts:92-140`):

- `GET {settings.webApiUrl || ENV.WEB_API_URL}/api/mobile/version` (unauthenticated; the endpoint serves env-driven `{ latestVersion, minSupportedVersion, apkUrl, releaseNotes, publishedAt }` — see [Mobile App API](../web/api/api-mobile.md)).
- When `latestVersion` is newer than the installed version, the status switches to `updateType: "apk"` with `apkUrl` and `releaseNotes`; a **manual** check additionally alerts "Version <v> Available" with **Later** / **Download APK**, where the APK URL is opened as-is when absolute or joined onto the server base when relative (`Linking.openURL`) (`useAppUpdates.ts:114-131`).
- A failed fetch sets `fetchFailed`; a manual check then alerts either "Update Check Failed — Could not connect to update server at <base>…" or "Up to Date — Sayabot is currently at the latest version (<current>)" (`useAppUpdates.ts:142-161`). Note `minSupportedVersion` is ignored by the client — only `isNewerVersion(current, latestVersion)` gates the prompt.

### Automatic check and `applyUpdate`

- A quiet `checkForUpdates(false)` runs 2 seconds after mount, on every screen that mounts the hook (`useAppUpdates.ts:178-184`). In practice `AdvancedScreen` mounts it (see [Computers & share](computers-and-share.md)); Expo also auto-checks OTA `ON_LOAD` per the native config.
- `applyUpdate()` re-applies the pending update: OTA — `Updates.reloadAsync()` when downloaded; APK — `Linking.openURL` of the absolute/relative-resolved `apkUrl` (`useAppUpdates.ts:166-176`).
- `restartApp()` in `src/core/server.ts` reuses the same `Updates.reloadAsync()` (with a `DevSettings.reload()` fallback) when switching servers (see [Pairing & onboarding](pairing-and-onboarding.md)).

### Build/release plumbing

- EAS profiles (`eas.json`): `preview` and `production` both build Android APKs on the `production` EAS Update channel; `pnpm --filter @sayabot/mobile update:ota` publishes JS updates (`eas update --auto --branch production`), exposed at the repo root as `pnpm mobile:update` / `pnpm mobile:build:apk`.
- `runtimeVersion` policy is `appVersion`, so OTA updates only apply to the same `app.json` version — a native change requires a new APK (`app.json:42-44`).

---

Related docs: [Overview](overview.md), [Computers & share](computers-and-share.md), [Navigation & auth](navigation-and-auth.md), [Mobile App API](../web/api/api-mobile.md)
