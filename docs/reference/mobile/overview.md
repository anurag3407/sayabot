# Mobile App Overview

The Sayabot mobile app (`apps/mobile`) is an Expo / React Native client (Expo SDK 52, React Native 0.76.9 with the New Architecture enabled) that connects either to the hosted Sayabot Supabase backend or to a self-hosted server paired via a QR/deep link. It ships room chat, the approval inbox, task board, usage stats, computer management, OS share-target intake, and push notifications. This page covers the application entry chain, environment configuration, Metro/build setup, the navigation root, and the app-level integrations (App Lock gate and share-target provider) that boot before any screen renders.

Source files: `App.tsx`, `index.js`, `src/config/env.ts`, `metro.config.js`, `react-native.config.js`, `package.json`, `app.json`, `eas.json`

---

## 🚪 App entry chain

Startup is two files deep:

1. **`index.js:7`** — `registerRootComponent(App)` from `expo` registers the root component under the `"main"` app key, working both in Expo Go and in native builds.
2. **`App.tsx`** — the `App` component performs one blocking async step before rendering anything:
   - `restoreServerClient()` from `src/core/supabase` is awaited in a `useEffect` (`App.tsx:17-20`). Until it settles, `App` returns `null` (blank screen). This restores a previously paired self-hosted server's Supabase client from storage so the correct backend exists _before_ any sign-in attempt.
   - Once ready, the tree renders `<ShareIntentProvider options={{ resetOnBackground: true }}>` (from `expo-share-intent`) wrapping `<SafeAreaProvider>` and `<RootNavigator />` (`App.tsx:22-28`). `resetOnBackground: true` clears a pending share intent when the app is backgrounded, so a stale share is not replayed on next launch.
   - A `ThemedStatusBar` inner component reads `useTheme()` and renders `<StatusBar style={theme.dark ? "light" : "dark"} />` so the OS status bar always matches the active theme (`App.tsx:9-12`).

`AppLockGate` is not mounted here — it wraps the navigation tree inside `RootNavigator` (see [Navigation & auth](navigation-and-auth.md)), so the lock can gate every authenticated screen.

---

## ⚙️ Environment configuration (`src/config/env.ts`)

A single exported `ENV` object, resolved at module load from Expo public env vars (inlined at build time; overridable via EAS secrets):

| Key                 | Env var                         | Default                                          | Used for                                                                                |
| :------------------ | :------------------------------ | :----------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `SUPABASE_URL`      | `EXPO_PUBLIC_SUPABASE_URL`      | `https://your-project.supabase.co`               | Hosted-backend Supabase project URL (`env.ts:7`)                                        |
| `SUPABASE_ANON_KEY` | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | placeholder JWT-shaped string                    | Hosted-backend anon key (`env.ts:8-9`)                                                  |
| `WEB_API_URL`       | `EXPO_PUBLIC_WEB_API_URL`       | `""` (configurable via env, QR pair or settings) | VPS domain of the Next.js web app, for `/api/messages` and tool approvals (`env.ts:12`) |
| `APP_NAME`          | — (constant)                    | `Sayabot`                                        | Display name                                                                            |
| `DEFAULT_ORG_SLUG`  | — (constant)                    | `default`                                        | Fallback org slug                                                                       |

`ENV.SUPABASE_URL` / `SUPABASE_ANON_KEY` are the fallback credentials consumed by `src/core/supabase.ts` when no self-hosted server is paired; `WEB_API_URL` is the default value for the persisted server URL setting managed by `src/core/server-url.ts` (see [Pairing & onboarding](pairing-and-onboarding.md)). A unit test pins the shape of this module (`tests/unit/env.test.ts`).

---

## 📦 Metro & native resolution setup

**`metro.config.js`** extends the default Expo Metro config for monorepo use:

- `config.watchFolders = [monorepoRoot]` — watches the whole Turborepo so edits to workspace packages (e.g. `@sayabot/core`) hot-reload (`metro.config.js:10`).
- `config.resolver.nodeModulesPaths` lists the mobile `node_modules` first, then the repo root `node_modules`, so both hoisted and package-local dependencies resolve (`metro.config.js:13-16`).

**`react-native.config.js`** customizes autolinking for Expo on Android: it injects `expo.modules.ExpoModulesPackage` as a package import/instance for the `expo` dependency (`react-native.config.js:4-11`), which is how Expo modules are wired into the plain React Native Android build.

**`app.json`** (Expo config) highlights:

- `scheme: "sayabot"` — deep links use the `sayabot://` scheme (pair links); `userInterfaceStyle: "automatic"` gives the app light/dark appearance tracking; `newArchEnabled: true` (`app.json:6-10`).
- iOS bundle id / Android package: `in.sayalabs.sayabot`; iOS InfoPlist entries for Face ID, photo library, and camera usage (the camera string covers scanning the connect QR and taking photos); Android permissions `USE_BIOMETRIC`, `USE_FINGERPRINT`, `POST_NOTIFICATIONS` (`app.json`).
- `updates`: `url: https://u.expo.dev/<projectId>`, `enabled: true`, `checkAutomatically: "ON_LOAD"`, `fallbackToCacheTimeout: 0`. `runtimeVersion` is pinned to `version` by `app.config.js` (the bare workflow rejects runtime version policies).
- Config plugins: `expo-camera` (QR scanning on the connect screen, `recordAudioAndroid: false`), `expo-image-picker` (photo/camera permission strings), `expo-local-authentication` (Face ID permission), `expo-notifications` (icon + accent color `#9d8cff`), `expo-quick-actions`, and `expo-share-intent` — the latter registers iOS activation rules (text, 1 web URL, up to 4 images/files) and Android intent filters for `text/*`, `image/*`, and `application/pdf` (`app.json`).

**`eas.json`** build profiles:

- `development` — development client, internal distribution.
- `preview` — internal distribution, Android `buildType: "apk"`, EAS Update channel `production` (this is what `pnpm --filter @sayabot/mobile build:apk` uses).
- `production` — Android APK, channel `production`, `autoIncrement: true`.

---

## 🧾 package.json scripts

`package.json` declares `"main": "index.js"` and these scripts (`package.json:6-16`):

| Script            | Command                                                                                     | Purpose                                                                                                                                                                                                         |
| :---------------- | :------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start` / `dev`   | `expo start`                                                                                | Metro dev server                                                                                                                                                                                                |
| `android` / `ios` | `expo run:android` / `expo run:ios`                                                         | Native dev builds                                                                                                                                                                                               |
| `web`             | `expo start --web`                                                                          | Web bundle of the app                                                                                                                                                                                           |
| `update:ota`      | `eas update --auto --branch production`                                                     | Publish an OTA JS update                                                                                                                                                                                        |
| `build:apk`       | `eas build -p android --profile preview`                                                    | Distributable Android APK                                                                                                                                                                                       |
| `typecheck`       | `tsc --noEmit`                                                                              | TypeScript check of `src/`                                                                                                                                                                                      |
| `lint`            | `eslint src`                                                                                | ESLint over `src/`                                                                                                                                                                                              |
| `test`            | `tsc --noEmit -p tests/unit/tsconfig.json` then five `node --experimental-strip-types` runs | Type-checks the unit-test project, then executes `env.test.ts`, `workspace-draft.test.ts`, `markdown.test.ts`, `server-url.test.ts`, `server-check.test.ts` with Node's native TypeScript stripping (no Vitest) |

Key runtime dependencies: `@react-navigation/native` + `native-stack` + `bottom-tabs` (navigation), `@supabase/supabase-js` (auth/data), `expo-notifications`, `expo-updates`, `expo-share-intent`, `expo-quick-actions`, `expo-local-authentication`, `react-native-webview` (in-app web viewer), `lucide-react-native` + `react-native-svg` (icons), and the workspace package `@sayabot/core` for shared types.

---

## 🧪 Unit tests and module shims

The `test` script doubles as the test runner and the type gate; there is no Vitest in this package — each `tests/unit/*.test.ts` is a plain script with assertions run through `node --experimental-strip-types` (which requires the tested modules to stay free of React Native imports; that is why `pair-link.ts`, `markdown.ts`, and `workspace-draft.ts` are pure).

| Test file                            | Covers                                                                                   |
| :----------------------------------- | :--------------------------------------------------------------------------------------- |
| `tests/unit/env.test.ts`             | Shape/fallbacks of `ENV` in `src/config/env.ts`                                          |
| `tests/unit/workspace-draft.test.ts` | `roomNameSlug`, `taskPriority`, `taskInsertRow`, `delegationMessage`                     |
| `tests/unit/markdown.test.ts`        | `parseBlocks` block splitting (code fences, images, file links, lists, headings, quotes) |
| `tests/unit/server-url.test.ts`      | `normalizeServerUrl` scheme/host/port handling                                           |
| `tests/unit/server-check.test.ts`    | `checkServer` response validation                                                        |

`src/assets.d.ts` declares the module type for image imports (`*.png` etc.) so TypeScript accepts `import markImage from "../../assets/mark.png"` in the Auth screen. The `dist/metadata.json` file is Expo export output, not source.

---

## 🧭 Navigation root & boot-time behaviors

`RootNavigator` (details in [Navigation & auth](navigation-and-auth.md)) is where app-wide effects live once a session exists:

- **Conditional screen sets**: `Auth` when unauthenticated, `Onboarding` when signed in but not onboarded, otherwise the full stack (`MainTabs`, `Chat`, `AgentProfile`, `WebPage`, `ShareTarget`, `Usage`, `Computers`, `AdvancedSettings`) (`RootNavigator.tsx:134-163`).
- **`SignedInEffects`** (`RootNavigator.tsx:31-84`), mounted only when authenticated _and_ `settings.onboarded`, wires:
  - Notification setup: `configureNotifications()`, a `NotificationResponseReceivedListener`, and `getLastNotificationResponseAsync()` to handle the tap that cold-launched the app (`RootNavigator.tsx:38-43`).
  - Push registration whenever `settings.pushNotifications` is on, via `enablePush(false)` (`RootNavigator.tsx:44-46`).
  - Home-screen quick actions: "New chat", "Inbox", "New task" items registered through `QuickActions.setItems`, each navigating via `navigateWhenReady` with a timestamped `action` param (`RootNavigator.tsx:49-60`).
  - **ShareTarget handling**: `useShareIntentContext().hasShareIntent` drives a `navigateWhenReady("ShareTarget")` whenever another app shares content in (`RootNavigator.tsx:63-65`). The `ShareTarget` screen is presented as a bottom-sheet modal (`RootNavigator.tsx:146`).
  - Android background status: `showWorkingStatus(workingText)` publishes an ongoing notification naming which agents are working (and in which chat) while the app is backgrounded, cleared on foreground (`RootNavigator.tsx:67-81`).
- **App lock**: the whole `NavigationContainer` is wrapped in `<AppLockGate>` (`RootNavigator.tsx:123`), which blocks interaction with a biometric/passcode challenge before the UI is usable. See [Navigation & auth](navigation-and-auth.md) for the gate's logic.

---

## 🎨 Theme wiring at the app level

Theming is centralized in `src/theme` and `src/ui/theme` (see [Settings & UI kit](settings-and-ui-kit.md)); the app-level touchpoints are:

- `ThemedStatusBar` maps `theme.dark` to the status bar style (`App.tsx:9-12`).
- `RootNavigator` builds a React Navigation theme by merging `DarkTheme`/`DefaultTheme` with the app palette — `background: theme.bg`, `card: theme.surface`, `text: theme.text`, `border: theme.line`, `primary: theme.accent` — and passes it to `NavigationContainer`; every screen's `contentStyle` background is `theme.bg` (`RootNavigator.tsx:91-101`, `127-131`).
- Boot and loading states (the `ActivityIndicator` splash while `loading || settingsLoading`) use `theme.bg` / `theme.accent` (`RootNavigator.tsx:105-118`).

---

Related docs: [Navigation & auth](navigation-and-auth.md), [Pairing & onboarding](pairing-and-onboarding.md), [Push & updates](push-and-updates.md), [Settings & UI kit](settings-and-ui-kit.md), [Mobile App API](../web/api/api-mobile.md), [System overview](../architecture/system-overview.md)
