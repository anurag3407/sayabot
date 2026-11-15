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
- The module-level default client points at `ENV.SUPABASE_URL` / `ENV.SUPABASE_ANON_KEY` (`supabase.ts:30-31`).
- The exported `supabase` is a **Proxy** that forwards every property access to the current client and binds functions to it, so `supabase.from(...)` keeps working after a switch (`supabase.ts:52-59`).
- `restoreServerClient()` runs once at startup from `App.tsx` before anything renders: it loads `SavedServer` from AsyncStorage key `@sayabot/server_v1`, and if the saved server's Supabase URL differs from the build default, replaces the current client and re-runs every registered `onSupabaseClient(setup)` callback (`supabase.ts:74-82`, `43-46`).
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
- Entry: the Auth screen's "Look around without an account" button sets settings `displayName: "Guest"`, `role: "Preview"`, then either calls the passed `onEnterDemo` or `setDemoMode(true)` (`AuthScreen.tsx:185-202`). Exit: `signOut()` resets it (`useAuth.ts:134`).

---

## 🖥️ Auth screen (`src/screens/AuthScreen.tsx`)

`AuthScreen` is a self-styled `SafeAreaView` using the static `colors` palette from `src/theme` (not the dynamic theme hook). Its sign-in options, top to bottom (`AuthScreen.tsx:243-366`):

1. **"Sign in with a code"** (primary) — opens a modal with an 8-character code input (auto-uppercased, `maxLength: 12`, placeholder `ABCD-2345`) and a "Change server" shortcut into the server sheet; submit calls `signInWithCode` (`AuthScreen.tsx:47-59`, `385-428`). The modal shows the current `settings.webApiUrl` as the target server (`AuthScreen.tsx:411`).
2. **OAuth** — "Continue with Google" and "Continue with GitHub" buttons calling `signInWithOAuth` (`AuthScreen.tsx:259-276`).
3. **Email + password** — sign-in and sign-up toggle; sign-up uses `supabase.auth.signUp` and, when no session returns, shows "Check your email to confirm this account…" (`AuthScreen.tsx:146-183`). Errors and the hook's `pairError` render in a shared error box; network-flavored failures become "Couldn't reach <server name>…" (`AuthScreen.tsx:101-107`, `231-235`).
4. **Guest** — "Look around without an account" (demo mode, above).
5. **Server pill** — bottom indicator showing "Server: <name>" ("Sayabot Cloud" when on the default URL) opening the **Choose your server** modal (`AuthScreen.tsx:368-379`, `430-490`).

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
