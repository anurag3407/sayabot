# Push Notifications & App Updates

Two independent update channels keep the phone current: Expo push notifications deliver agent questions (with an inline "Answer" text field) and danger-tool approvals (Allow / Don't allow) whose actions post straight back to the web API without opening the app; `expo-updates` handles over-the-air JS updates, and a version check against the server's `/api/mobile/version` finds new APKs, which the app downloads and hands to Android's installer. A root-mounted banner runs both checks automatically. This page documents the notification handler, channels and categories, token registration lifecycle, tap/interaction routing, and both update paths.

Source files: `src/core/push.ts`, `src/hooks/useAppUpdates.ts`, `src/components/UpdateBanner.tsx`, `src/core/app-version.ts`, `src/core/apk-install.ts`, `android/app/build.gradle`, `.github/workflows/mobile-updates.yml`

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

| Action                                          | Behavior                                                                                                                                                                                                                                                            |
| :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `"answer"` (question category, with `userText`) | `POST /api/mobile/inbox/answer` with `{ orgSlug: data.orgSlug, taskId: data.refId, answer: response.userText.trim(), alsoPost: false }`, then schedules a local confirmation alert "Answer sent" echoing the first 100 characters. Returns without opening the app. |
| `"allow"` / `"deny"` (approval category)        | `POST /api/v1/tools/{data.refId}/approve` with `{ approved: action === "allow" }` — the same approval endpoint the in-chat card uses. Returns without opening the app.                                                                                              |
| API failure on either                           | Falls through to navigation so the person can act in the app instead (`push.ts:101-103`).                                                                                                                                                                           |
| Plain tap, `kind: "request"`                    | `navigateWhenReady("MainTabs", { screen: "InboxTab" })` — opens the Inbox tab.                                                                                                                                                                                      |
| Plain tap with `data.roomId`                    | `navigateWhenReady("Chat", { roomId, roomName: "Chat", orgSlug })`.                                                                                                                                                                                                 |

`navigateWhenReady` queues navigation until the container is ready (see [Navigation & auth](navigation-and-auth.md)).

---

## 🟢 Working-status notification (`showWorkingStatus`)

Android-only: an ongoing, sticky, low-priority notification (identifier `"agent-working"`, channel `"status"`) titled "Sayabot" whose body names the agents currently working, e.g. "Hermes, Scout are working in job-hunt…" (`push.ts:108-120`; text built from `useHome()` data in `RootNavigator.tsx:67-81`). Passing `null` dismisses it. The app sets it when entering the background and clears it on foreground; the module-level notification handler suppresses its alert/sound so it never interrupts (`push.ts:17-24`).

---

## 🛠️ OS wiring & permissions

- **Android `POST_NOTIFICATIONS`** is declared in `app.json` (`app.json:34`), required on Android 13+ before any channel or notification works; `configureNotifications()` only creates the channels and categories, while runtime permission is requested by `enablePush` (or pre-granted by the OS install-time default on older versions).
- **iOS Face ID permission string** ("Sayabot uses Face ID to keep your chats private when App lock is on.") comes from the `expo-local-authentication` plugin, unrelated to push but configured alongside it in `app.json:62-66`.
- The notification icon and accent color for Android notifications come from the `expo-notifications` plugin config (`./assets/notification-icon.png` — the alpha-only Saya ghost glyph from `brand:icons` — color `#9d8cff`) — the same iris used for the `"agents"` channel light color (`app.json:69-74`).
- `SignedInEffects` also registers the cold-start response listener once per sign-in and removes it on unmount, so a stale listener cannot double-handle taps after a server switch restart (`RootNavigator.tsx:38-43`).

---

## 🔄 App updates (`src/hooks/useAppUpdates.ts`, `src/components/UpdateBanner.tsx`)

Updates come two ways. **Over-the-air (OTA)** JS updates download silently and apply on restart. **New APKs**, needed for native changes, download inside the app and open Android's installer. Android always asks the person to confirm the install, because a sideloaded app can't update itself silently. iOS skips the APK path.

### Shared state

`useAppUpdates()` reads one module-level store through `useSyncExternalStore`, so the root banner, More and Advanced all see the same update. It returns `{ isChecking, isUpdateAvailable, isDownloading, isDownloaded, downloadProgress, updateType, latestVersion, apkUrl, releaseNotes, errorMessage, dismissed, lastCheckedAt, currentVersion, checkForUpdates, applyUpdate, dismiss }`. `CURRENT_APP_VERSION` is `Constants.expoConfig?.version`, from `app.json` (currently `1.2.1`). Concurrent checks share one in-flight promise. A quiet check that finds one already running just waits for it.

Pure helpers live in `src/core/app-version.ts` and are unit-tested in `tests/unit/app-version.test.ts`:

- `parseSemver` strips a leading `v` and treats missing or non-numeric parts as 0. `isNewerVersion(current, latest)` compares numerically, so `1.10.0` is newer than `1.2.0`.
- `resolveApkUrl(base, apkUrl)` keeps absolute links and joins relative ones onto the server.
- `shouldQuietCheck(lastCheckedAt, now)` allows a foreground check at most every `QUIET_CHECK_INTERVAL_MS` (30 minutes).

| Field                                | Meaning                                                                                                       |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `updateType`                         | `"ota"` (an OTA bundle was found), `"apk"` (the server's `latestVersion` is newer) or `null`                  |
| `isDownloading` / `downloadProgress` | An OTA fetch or APK download is running. `downloadProgress` runs from 0 to 1 for APKs and is `null` otherwise |
| `isDownloaded`                       | The OTA bundle is ready for `Updates.reloadAsync()`                                                           |
| `dismissed`                          | The banner was closed. It stays hidden until the next launch, since the store lives in memory                 |
| `lastCheckedAt`                      | When the last check started, used for throttling                                                              |

### `checkForUpdates(manual)`

1. **OTA**, only when `Updates.isEnabled`: `checkForUpdateAsync()`. If an update exists, `fetchUpdateAsync()` runs silently and sets `updateType: "ota"` and `isDownloaded`. A manual check also alerts "Update ready" with **Later** / **Restart**. Failures are logged and the check moves on to the APK step.
2. **APK** (Android only): `GET {settings.webApiUrl || ENV.WEB_API_URL}/api/mobile/version`. When `latestVersion` is newer and an `apkUrl` is present, it sets `updateType: "apk"`. A manual check alerts "Sayabot <v> is available" with **Later** / **Install**. The client ignores `minSupportedVersion`.
3. Otherwise the update state is cleared. A manual check alerts "You're up to date" or "Couldn't check for updates".

### Installing an APK (`src/core/apk-install.ts`)

`downloadAndInstallApk(url, version, onProgress)` first deletes any `Sayabot-*.apk` left in the cache from earlier updates, then downloads into `FileSystem.cacheDirectory` as `Sayabot-<version>.apk` (`expo-file-system`, which follows GitHub's redirect), gets a `content://` URI and starts `android.intent.action.VIEW` with type `application/vnd.android.package-archive` and `FLAG_GRANT_READ_URI_PERMISSION` (`expo-intent-launcher`). The manifest declares `REQUEST_INSTALL_PACKAGES`, so Android shows "Allow from this source" the first time. If any step fails, the link opens in the browser instead. `applyUpdate()` calls `Updates.reloadAsync()` for a downloaded OTA bundle, or this installer for an APK.

### Automatic checks (`UpdateBanner`)

`UpdateBanner` is mounted once in `App.tsx`. It runs a quiet check 3 seconds after launch and again whenever the app returns to the foreground, throttled by `shouldQuietCheck`. When an update is ready, it shows a floating card below the status bar:

- "Update ready" with **Restart** for OTA.
- "Sayabot <v> is available" with **Install** for an APK. While the APK downloads, the card shows "Downloading N%" and a progress bar. Once the download completes it shows "Opening the installer…" until Android's installer returns.

An × button dismisses the card. More and Advanced keep their manual "Check for updates" rows, which share the same store. `restartApp()` in `src/core/server.ts` uses the same `Updates.reloadAsync()` (falling back to `DevSettings.reload()`) when switching servers.

### Build/release plumbing

- **One version source.** `android/app/build.gradle` reads `expo.version` from `app.json`. It sets `versionName`, sets `versionCode = major*10000 + minor*100 + patch` (1.2.0 becomes 10200, so each APK installs over the last) and generates the `expo_runtime_version` string resource. Bumping `app.json` `version` is the only edit needed for a native release.
- **OTA wiring.** `app.json` `updates.url` and the manifest's `expo.modules.updates.EXPO_UPDATE_URL` both point at `https://u.expo.dev/<projectId>`. APKs built before 1.2.0 have no update URL, so they never receive OTA updates and need to be updated once by hand. `app.config.js` sets `runtimeVersion` to `app.json`'s `version`. Expo rejects runtime version _policies_ in the bare workflow, which this project is because `android/` is committed, and the `eas update` step failed with "runtime version policies are not supported" until this was pinned. So an OTA bundle only reaches binaries built from the same version. The APK sends `expo-channel-name: production` with every update check, set in both `app.json` `updates.requestHeaders` and the manifest's `expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`. EAS cloud builds add that header automatically, but Gradle builds don't. Without it, `u.expo.dev` rejects the check ("expo-channel-name: Required"), which is why 1.2.0 never got OTA updates and 1.2.1 was needed. The EAS `production` channel must also map to the `production` branch that CI publishes to. Set it once with `eas channel:edit production --branch production`; an unmapped channel answers "There are no branches linked to the channel".
- **CI** (`.github/workflows/mobile-updates.yml`):
  - `ota-update` publishes `eas update --branch production` on every push touching `apps/mobile/**`. It needs the `EXPO_TOKEN` repo secret and skips with a warning without it.
  - `release-apk` checks whether the latest GitHub release already has `Sayabot-<version>.apk`. If not, it runs `./gradlew assembleRelease` for arm64-v8a and armeabi-v7a, and uploads `Sayabot-<version>.apk` and `Sayabot.apk` with `--clobber`. If no release exists yet, it creates `mobile-v<version>`. Running it via `workflow_dispatch` with `build-apk` always rebuilds.
  - **Signing.** Android only installs an update signed with the same key as the installed app. The release build type uses `signingConfigs.release` when `SAYABOT_RELEASE_STORE_FILE` (plus `SAYABOT_RELEASE_STORE_PASSWORD`, `SAYABOT_RELEASE_KEY_ALIAS` and `SAYABOT_RELEASE_KEY_PASSWORD`) is set. Otherwise it falls back to the committed public `debug.keystore`. In CI, `release-apk` decodes the `ANDROID_KEYSTORE_BASE64` secret into that variable, using the `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` secrets, and warns when they are missing. The published 1.1.0 APK was signed with a different key (certificate SHA-256 `06be1fdb…35edd`) than `debug.keystore` (`fac61745…33b9c`). To let 1.2.0 install over 1.1.0, set the secrets to that original keystore. Otherwise phones must uninstall 1.1.0 once.
- **Cleartext.** The main manifest sets `android:usesCleartextTraffic="true"`, so release builds can reach a self-hosted server on the LAN over `http://` (for example `http://192.168.1.20:3000`, which `normalizeServerUrl` produces for private addresses). Before this, only the debug manifest allowed cleartext, so release APKs failed with "Couldn't reach that server".
- **Memory.** `gradle.properties` gives Gradle `-Xmx4096m` (raised from 2 GB, which ran D8 out of heap while dexing `expo-updates`).
- `desktop-release.yml` carries the `*.apk` assets forward into each new Mac release.
- EAS profiles (`eas.json`) still exist for manual cloud builds (`pnpm mobile:build:apk`). `pnpm mobile:update` publishes OTA updates by hand.

---

Related docs: [Overview](overview.md), [Computers & share](computers-and-share.md), [Navigation & auth](navigation-and-auth.md), [Mobile App API](../web/api/api-mobile.md)
