# Navigation & Auth

The mobile app uses React Navigation 7 with a single native stack whose screen set is chosen by auth state, and a bottom-tab shell for the signed-in experience. Authentication runs through Supabase (`@supabase/supabase-js`) against whichever Supabase project the phone is pointed at — Sayabot Cloud by default, or a self-hosted server's own Supabase after pairing. A module-level demo ("guest") mode lets someone look around without an account, and an optional biometric App Lock overlays the entire UI until the owner unlocks it.

Source files: `src/navigation/RootNavigator.tsx`, `src/navigation/TabNavigator.tsx`, `src/core/nav.ts`, `src/hooks/useAuth.ts`, `src/core/supabase.ts`, `src/core/session-mode.ts`, `src/screens/AuthScreen.tsx`, `src/components/AppLockGate.tsx`

---

## 🗺️ Navigation structure

### Root stack (`src/navigation/RootNavigator.tsx`)

`RootNavigator` renders one `Stack.Navigator` inside a themed `NavigationContainer` (ref stored in `navigationRef`, `onReady={flushPendingNavigation}`) and picks its screens from three states (`RootNavigator.tsx:134-163`):

| State | Screen(s) |
| :-- | :-- |
| Not authenticated (`!session && !demoMode`) | `Auth` — `AuthScreen` receives `onEnterDemo={() => setDemoMode(true)}` |
| Authenticated but `!settings.onboarded` | `Onboarding` (`OnboardingScreen`) |
| Authenticated and onboarded | `MainTabs`, `Chat`, `AgentProfile`, `WebPage`, `ShareTarget` (bottom-sheet modal), `Usage`, `Computers`, `AdvancedSettings` |

Shared `screenOptions`: headers hidden, `contentStyle` background `theme.bg`, `animation: "slide_from_right"`, `fullScreenGestureEnabled` (`RootNavigator.tsx:126-132`). The three settings-ish screens (`Usage`, `Computers`, `AdvancedSettings`) re-enable native headers with `headerBackTitle: "More"` and theme-colored tint (`RootNavigator.tsx:147-161`). While `loading || settingsLoading`, a full-screen `ActivityIndicator` splash shows instead (`RootNavigator.tsx:105-118`).

Auth state is `Boolean(session || demoMode)` (`RootNavigator.tsx:120`), so demo mode renders the full tab shell with no Supabase session.

The whole container is wrapped in `<AppLockGate>` (`RootNavigator.tsx:123`). `SignedInEffects` (see [overview](overview.md)) is mounted as a sibling only when `session && settings.onboarded` (`RootNavigator.tsx:125`).

### Tab shell (`src/navigation/TabNavigator.tsx`)

`createBottomTabNavigator` with four tabs (`TabNavigator.tsx:49-61`):

| Tab name | Label | Icon (lucide) | Screen |
| :-- | :-- | :-- | :-- |
| `HomeTab` | Chats | `MessageCircle` | `HomeScreen` |
| `InboxTab` | Inbox | `Bell` | `InboxScreen` |
| `TasksTab` | Tasks | `CheckSquare` | `TasksScreen` |
| `MoreTab` | More | `Ellipsis` | `MoreScreen` |

- The Inbox tab shows a live badge: `questions.length + approvals` from `useInbox(settings.orgSlug)` (`TabNavigator.tsx:23-24, 56-58`).
- iOS gets a translucent tab bar (`position: "absolute"`, transparent background) with an `expo-blur` `BlurView` background tinted per theme; Android uses a solid `theme.surface` bar (`TabNavigator.tsx:31-42`).
- Every tab press fires `haptic.select()` via `screenListeners` (`TabNavigator.tsx:28`).

### Imperative navigation (`src/core/nav.ts`)

`navigationRef` is a `createNavigationContainerRef()` so notifications, quick actions, and share intents can navigate outside React (`nav.ts:4`). `navigateWhenReady(name, params?)` navigates immediately if the container is ready, otherwise queues the call (`nav.ts:8-12`); `flushPendingNavigation()` drains the queue from the container's `onReady` (`nav.ts:14-16`). Callers use nested params, e.g. `navigateWhenReady("MainTabs", { screen: "InboxTab" })` from quick actions (`RootNavigator.tsx:56-60`).

---

## 🔐 Supabase client with server switching (`src/core/supabase.ts`)

The phone can sign in against Sayabot Cloud or a self-hosted server, so the Supabase client is swappable:

- `makeClient(url, anonKey)` creates a client persisting sessions in AsyncStorage with `autoRefreshToken: true`, `persistSession: true`, `detectSessionInUrl: false` (`supabase.ts:19-28`).
- The module-level default client starts on the build's `ENV.SUPABASE_URL` / `ENV.SUPABASE_ANON_KEY` (from `EXPO_PUBLIC_*` at build time; unset builds get the placeholder `https://your-project.supabase.co`).
- The exported `supabase` is a **Proxy**. It forwards every property access to the current client and binds functions to it, so `supabase.from(...)` keeps working after a switch.
- `restoreServerClient()` runs once at startup from `App.tsx`, before anything renders. `switchClient(url, key)` replaces the client (only when the URL differs) and re-runs every registered `onSupabaseClient(setup)` callback. The order of preference:
  1. **Saved self-hosted server.** The `SavedServer` in AsyncStorage key `@sayabot/server_v1` supplies the Supabase project.
  2. **Sayabot Cloud, cached.** `@sayabot/cloud_v1` holds Cloud's own `/api/instance` answer, used only when its `webApiUrl` equals `ENV.WEB_API_URL`. The app switches to it immediately and refreshes the cache in the background. A changed project takes effect on the next launch, never mid-session.
  3. **Sayabot Cloud, first launch.** When the built-in URL is a placeholder (`isPlaceholderSupabaseUrl` in `src/core/server-url.ts`), startup waits for `checkServer(ENV.WEB_API_URL)` (8 s timeout) and switches to Cloud's project. Otherwise it keeps the built-in values and fetches Cloud's answer in the background.

  So Cloud's Supabase project always comes from Cloud itself, the same way a self-hosted server's does. A build made without `EXPO_PUBLIC_SUPABASE_URL` can still sign in. Before this change, such builds (APK 1.1.0) compared the placeholder URL with Cloud's and rejected every code with "This copy of the app is set up for a different Sayabot server".
- `saveServer(server | null)` persists or clears the record `{ webApiUrl, name, supabaseUrl, supabaseAnonKey }` (`supabase.ts:85-88`, `12-17`).

---

## 🎟️ Auth session handling (`src/hooks/useAuth.ts`)

`useAuth` is mounted by `RootNavigator` (and screens) and returns `{ session, user, loading, pairError, signIn, signInWithOAuth, signInWithCode, signOut }` (`useAuth.ts:140`).

On mount (`useAuth.ts:33-103`):

1. `supabase.auth.getSession()` seeds the initial `session`/`user`; `onAuthStateChange` keeps them current (`useAuth.ts:34-44`).
2. **Deep-link handler** for the `sayabot://` scheme (`useAuth.ts:47-77`):
   - If `parsePairLink(url)` matches `sayabot://pair?code=…`, it calls `pairWithCode(pair.code, pair.server)` (see [Pairing & onboarding](pairing-and-onboarding.md)) and records failures in `pairError`.
   - Otherwise `extractTokensFromUrl` pulls `access_token` + `refresh_token` from the URL hash or query (used by the OAuth callback `sayabot://auth/callback`) and restores them with `supabase.auth.setSession` (`useAuth.ts:9-25`, `63-76`).
   - Both the cold-start URL (`Linking.getInitialURL()`) and live `Linking.addEventListener("url")` events are handled (`useAuth.ts:80-84`).
3. **Revocation check**: on launch and on every `AppState` → `active`, `phoneWasRemoved()` asks the web API `GET /api/mobile/device` with `x-device-id` / `x-device-token` headers; a `revoked` status triggers `forgetPairing()` + `supabase.auth.signOut()` so a phone removed on the computer signs itself out (`useAuth.ts:87-96`; server side documented in [Mobile App API](../web/api/api-mobile.md)). Network errors never sign anyone out (`pairing.ts:81-95`).

Sign-in methods:

- `signIn(email, pass)` — `supabase.auth.signInWithPassword` (`useAuth.ts:105-112`).
- `signInWithOAuth("google" | "github")` — `supabase.auth.signInWithOAuth` with `redirectTo: "sayabot://auth/callback"` and `skipBrowserRedirect: true`, then `Linking.openURL(data.url)` opens the provider's browser page; the redirect back delivers the tokens the deep-link handler consumes (`useAuth.ts:114-126`).
- `signInWithCode(code)` — delegates to `pairWithCode(code)` (`useAuth.ts:128-131`).
- `signOut()` — clears demo mode, calls `forgetPairing()`, then `supabase.auth.signOut()` (`useAuth.ts:133-138`).

---

## 👻 Guest / demo mode (`src/core/session-mode.ts`)

A tiny module-level store — no Supabase session involved:

- `isDemoMode()` / `setDemoMode(next)` flip a boolean and notify subscribers (`session-mode.ts:6-20`); `subscribeDemoMode(listener)` returns an unsubscribe function (`session-mode.ts:22-27`).
- `RootNavigator` holds `demoMode` state synced via `subscribeDemoMode` (`RootNavigator.tsx:88, 103`) so the auth check `session || demoMode` reacts instantly.
- Entry: the Auth screen footer's "Just looking" link sets settings `displayName: "Guest"`, `role: "Preview"`, then either calls the passed `onEnterDemo` or `setDemoMode(true)` (`handleDemoSignIn` in `AuthScreen.tsx`). Exit: `signOut()` resets it (`useAuth.ts:134`).

---

## 🖥️ Auth screen (`src/screens/AuthScreen.tsx`)

`AuthScreen` is a self-styled `SafeAreaView` using the static `colors` palette from `src/theme` (not the dynamic theme hook). It is laid out for a first-time visitor: a small hero (logo, "Sayabot", "Your agents, on your phone."), then three sign-in choices, with everything else folded away or moved to a quiet footer. Top to bottom:

1. **"Scan the QR code"** (primary, QR icon) opens `PairScanner`, the camera, pointed at the QR on the computer (Settings → Phones → Add phone). A "Type the code instead" link opens the 8-character code modal (auto-uppercased, `maxLength: 12`, placeholder `ABCD-2345`) with a "Change server" shortcut; that path calls `signInWithCode` with no server, so it uses the phone's current server. The hint under the button reads "On your computer: Settings → Phones → Add phone".
2. **OAuth**: an "or" divider, then a row of two equal buttons, **Google** and **GitHub** (accessibility labels "Continue with Google/GitHub"), each calling `signInWithOAuth`.
3. **Email + password**: collapsed behind a "Use email instead" link (`showEmail` state). Expanded, it shows Email and Password fields (the email field's Next key moves to the password field, whose Go key submits), a "Sign in" / "Create account" button and a "New here? Create an account" / "Have an account? Sign in" toggle. Sign-up uses `supabase.auth.signUp` and, when no session returns, shows "Check your email to confirm this account…". Errors and the hook's `pairError` render in a shared error box above the choices; network-flavored failures become "Couldn't reach <server name>…".
4. **Footer** (outside the scroll view; hidden while the keyboard is open, tracked through `Keyboard` `keyboardDidShow`/`keyboardDidHide`, so it never covers the password field): a server link showing `serverLabel` (the saved server's name, "Sayabot Cloud" on the default URL, else the bare host) that opens the **Choose your server** modal, and a "Just looking" link that enters guest/demo mode (above). Its accessibility hint says preview only.

The server modal debounces 600 ms as you type, runs `checkServer(value)` from `src/core/server-url.ts`, shows `✓ Found <name>` or the error, and its Connect button runs `checkServer` then `useServer(result.server)` (sign out → persist → restart). When a server is already saved, a "Use Sayabot Cloud" action calls `useCloud()` (`AuthScreen.tsx:80-98`, `117-127`, `471-479`). Server URL normalization and the `/api/instance` probe are documented in [Pairing & onboarding](pairing-and-onboarding.md).

---

## 🔁 Session flow summary

Putting the pieces together, a cold start proceeds:

1. `App.tsx` restores the saved server's Supabase client (`restoreServerClient`) before rendering.
2. `RootNavigator` mounts `useAuth`, which seeds `session` from storage, registers the auth listener, deep-link handlers, and the revocation checker, while `useSettings` loads `@sayabot/settings_v1`.
3. While either `useAuth().loading` or `useSettings().loading` is true, only the themed spinner shows.
4. The screen set then resolves to `Auth` → `Onboarding` → `MainTabs` per the table above, with `AppLockGate` wrapping everything.
5. Any later `onAuthStateChange` (token refresh, sign-out, or a server switch via the `supabase` Proxy) updates `session` reactively — `RootNavigator` re-renders its conditional screens without remounting the container.

`useAuth` can be mounted by several components at once (RootNavigator, AuthScreen, MoreScreen); all share the same underlying Supabase listener, and pairing-related work is deduplicated by the `inflight` map in `src/core/pairing.ts` (see [Pairing & onboarding](pairing-and-onboarding.md)).

---

## 🔒 App Lock (`src/components/AppLockGate.tsx`)

`AppLockGate` renders its children always, and overlays a full-screen opaque lock panel (`theme.bg`, a `Lock` icon, "Sayabot is locked", and an Unlock `Button`) when `locked` is true (`AppLockGate.tsx:46-58`). Because it wraps the whole `NavigationContainer`, the lock covers every screen including tabs.

Behavior, driven by the `appLock` setting (`useSettings`):

- **First launch after mount**: once settings finish loading, if `appLock` is on it locks and immediately prompts `LocalAuthentication.authenticateAsync({ promptMessage: "Unlock Sayabot", fallbackLabel: "Use passcode" })`; success sets `locked` false (`AppLockGate.tsx:25-32`, `20-23`). A `checkedOnce` ref guarantees this runs only once.
- **Re-lock after 60 s away**: an `AppState` listener stamps `leftAt` when backgrounding and re-locks on return only if the app was away longer than `RELOCK_AFTER_MS = 60_000` ms (`AppLockGate.tsx:10`, `34-44`). Brief app switches do not re-lock.
- Tapping "Unlock" re-runs the same biometric prompt (`AppLockGate.tsx:55`).
- The setting is toggled during onboarding (with a hardware/enrollment check) and in More settings; see [Pairing & onboarding](pairing-and-onboarding.md) and [Settings & UI kit](settings-and-ui-kit.md).

---

Related docs: [Overview](overview.md), [Pairing & onboarding](pairing-and-onboarding.md), [Settings & UI kit](settings-and-ui-kit.md), [Push & updates](push-and-updates.md), [Mobile App API](../web/api/api-mobile.md), [Auth & authorization](../architecture/auth-and-authorization.md)
