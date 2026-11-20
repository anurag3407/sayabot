# Settings & UI Kit

All persisted app state lives in one `AppSettings` object in AsyncStorage (`@sayabot/settings_v1`), read and written through a cached, listener-based `useSettings` hook so every screen updates in sync. The More tab surfaces profile, workspace tools, appearance (including an OLED "Black" mode), haptics, App Lock, update checks, and sign-out. Theming runs through two parallel systems: the active design system in `src/ui/theme.ts` (a `Theme` object selected by `useTheme()` from `themeMode` + OS color scheme) and a legacy static palette in `src/theme/index.ts` that older screens still import. The `src/ui/*` primitives — Mascot avatars, bottom Sheet, variant `Text`, Buttons/Rows/Chips, haptics, and RichText — are the shared building blocks every screen composes.

Source files: `src/screens/MoreScreen.tsx`, `src/hooks/useSettings.ts`, `src/core/settings.ts`, `src/theme/index.ts`, `src/ui/theme.ts`, `src/ui/Mascot.tsx`, `src/ui/Sheet.tsx`, `src/ui/Text.tsx`, `src/ui/controls.tsx`, `src/ui/haptics.ts`, `src/hooks/usePalette.ts`, `src/ui/RichText.tsx`

---

## ⚙️ Settings storage (`src/core/settings.ts`)

### `AppSettings` shape and defaults

`AppSettings` (`settings.ts:5-45`) groups into: profile & workspace (`displayName: "Operator"`, `orgSlug: ENV.DEFAULT_ORG_SLUG`, `role: "Workspace Owner"`), AI & BYOK (`aiProvider: "openrouter"`, `modelName: "anthropic/claude-3.5-sonnet"`, `apiKey`, `temperature: 0.7`, `maxBudgetTurns: 12`), gateway & infrastructure (`webApiUrl: ENV.WEB_API_URL`, `supabaseUrl: ENV.SUPABASE_URL`, `deviceId`, `deviceToken`), agent guardrails (`toolApprovalMode: "always_ask"`, `defaultComputerProfile: "standard"`, `autoOpenTerminal: false`), UI & experience (`themeMode: "system"`, `fontSize: "normal"`, `hapticsEnabled: true`, `appLock: false`, `onboarded: false`, `soundEffects: true`), and notifications (`pushNotifications`, `notifyOnTaskComplete`, `notifyOnApproval`, `notifyOnMention` all `true`) (`settings.ts:47-78`).

- `loadSettings()` reads the JSON blob and merges it over `DEFAULT_SETTINGS` (so new fields get defaults); parse failures warn and fall back to defaults (`settings.ts:94-109`).
- `saveSettings(updates)` merges, persists, and refreshes an in-memory `activeWebApiUrl` (`settings.ts:111-122`).
- `currentWebApiUrl()` returns the cached `webApiUrl` (trailing slashes stripped, defaulting to `ENV.WEB_API_URL`) and is read at request time everywhere so a server change applies to the next call (`settings.ts:89-92`).
- `resetSettings()` removes the key and restores defaults (`settings.ts:124-133`).
- Connection probes used by AdvancedScreen diagnostics: `pingGateway(targetUrl?)` — `GET {url}/api/health` with a 6 s timeout, `HEAD` root fallback, `ok` = status < 500, reports `latencyMs`; `pingDatabase()` — `supabase.from("orgs").select("id").limit(1).maybeSingle()` treating `PGRST116` (no rows) as success (`settings.ts:135-211`).

### `useSettings` hook (`src/hooks/useSettings.ts`)

A module-level cache + listener set makes settings a global store (`useSettings.ts:14-23`):

- First mounter triggers `loadSettings()` and notifies everyone; later mounters get the cache synchronously (`useSettings.ts:39-48`).
- `updateSettings(partial)` saves then notifies all subscribers; `resetAll()` resets; `applySettings(partial)` is the outside-React escape hatch (used by pairing, home org switching) doing the same as `updateSettings` (`useSettings.ts:55-65`, `95-99`).
- Also returns `runDiagnostics(customUrl?)` (runs both pings in parallel, sets `gatewayPing`/`databasePing`/`testingConnection`) (`useSettings.ts:67-80`).
- `loading` is true only until the first load resolves — `RootNavigator` waits on it before rendering any screen (see [Navigation & auth](navigation-and-auth.md)).

---

## 💾 AsyncStorage keys inventory

| Key                      | Written by                                       | Contents                                                                                                   |
| :----------------------- | :----------------------------------------------- | :--------------------------------------------------------------------------------------------------------- |
| `@sayabot/settings_v1`   | `saveSettings` via `useSettings`/`applySettings` | The full `AppSettings` JSON (profile, gateway, guardrails, UI, notification flags)                         |
| `@sayabot/server_v1`     | `saveServer` in `src/core/supabase.ts`           | `SavedServer { webApiUrl, name, supabaseUrl, supabaseAnonKey }` — the server the Supabase client points at |
| `@sayabot/home_cache_v1` | `refreshHome` in `src/hooks/useHome.ts`          | The last `HomeData` snapshot for instant cold-start rendering                                              |
| `@sayabot/push_token`    | `enablePush` in `src/core/push.ts`               | The registered Expo push token, for later `DELETE /api/mobile/push`                                        |

Note the split: "Reset this app" clears only `@sayabot/settings_v1`; the paired server, cached home data, and push token keys are untouched, and Supabase sessions persist in Supabase's own AsyncStorage entries.

---

## 🧾 More screen (`src/screens/MoreScreen.tsx`)

`MoreScreen` (the `MoreTab`) is a grouped list over `useHome()` and `useSettings()`:

- **Profile header** — `PersonAvatar` initials, `data.user.name` and email (`MoreScreen.tsx:48-56`).
- **Workspace group** (titled with the org name):
  - **Computers** → navigates to the `Computers` stack screen ("Remote desktop and agents on your Mac").
  - **Usage** → `Usage` screen, with a live value column summing agent usage: "<compactNumber tokens> · $<cost>" (`MoreScreen.tsx:60`, `27-30`).
  - **Agents**, **Marketplace**, **Routines** → open the corresponding web pages in `WebPageScreen` via `page("/agents" | "/marketplace" | "/cron", …)`, building the path as `/{orgSlug}<path>` (`MoreScreen.tsx:26`, `61-63`).
- **This phone group**:
  - **Appearance** — chips for `system` ("Automatic"), `light`, `dark`, `oled` ("Black") writing `settings.themeMode`. Note `emerald` exists in the `themeMode` type (`settings.ts:31`) and legacy palette but is not offered here (`MoreScreen.tsx:74-83`).
  - **Haptics** toggle — calls `setHapticsEnabled(v)` (live module flag) then persists `hapticsEnabled` (`MoreScreen.tsx:85-94`).
  - **App lock** toggle — enabling requires biometric hardware + enrollment and a successful `authenticateAsync({ promptMessage: "Turn on app lock" })` before `updateSettings({ appLock: true })`; disabling saves directly (`MoreScreen.tsx:32-40`, `95`).
  - **Check for updates** — subtitle "Checking for updates…" / "Update available (v<latest>)" / "Sayabot v<current> (Latest)", tapping `checkForUpdates(true)` (see [Push & updates](push-and-updates.md)).
  - **Phones signed in** → web page `/settings/phones` ("Phones" management screen in the web app).
  - **Advanced** → the `AdvancedSettings` stack screen ("Server address, notifications, diagnostics").
- **Sign out** (destructive) — calls `useAuth().signOut()`, which clears demo mode, forgets the pairing, and signs out of Supabase (`MoreScreen.tsx:113-115`; see [Navigation & auth](navigation-and-auth.md)).

---

## 🎨 Theme systems

### Active design system (`src/ui/theme.ts`)

`Theme` is a 24-token interface (`dark`, `bg`, `surface`, `card`, `raised`, `line`, `lineStrong`, `text`, `muted`, `faint`, `accent`, `accentPressed`, `accentSoft`, `onAccent`, `ok`/`warn`/`danger` + soft variants, `overlay`, `bubbleMine`/`bubbleMineText`/`bubbleTheirs`) with two palettes: `darkTheme` (graphite `#09090b`, iris accent `#9d8cff`) and `lightTheme` (cool paper `#f5f5f7`, accent `#6d5ce8`), matching the web app's palette (`theme.ts:9-88`).

`useTheme()` resolves the palette from `settings.themeMode` and the OS `useColorScheme()`: `"light"` forces light, `"system"` follows the OS, `"oled"` returns dark with pure-black `bg`/`surface`/`card`, and anything else (including `"emerald"`) falls back to dark (`theme.ts:90-98`). Screens never hardcode hex — they read tokens here (`theme.ts:6`). Shared layout tokens: `space` (`xs 4 … xxl 28`) and `radius` (`sm 10 … pill 999`), plus `IDENTITY` — eight pastel hex values reserved for agent identity (never status) and `hashString()` (FNV-1a) for deterministic color selection (`theme.ts:100-113`).

### Legacy static palette (`src/theme/index.ts`)

A fixed dark `colors` object (graphite + iris, same values as the active theme) with the same keys the remaining legacy-screen imports were built against — `AuthScreen` and `TerminalDrawer` (plus `usePalette`) still import `src/theme`, everything else uses `src/ui/theme` — plus `paletteFor(mode)` that derives OLED (pure black) and emerald (deep green) variants and `fonts.mono` / `spacing` / `radius` constants (`index.ts:4-7`, `51-100`). `paletteFor`'s `ThemeMode` type includes `"emerald"`, which `useTheme()` does not implement — emerald only exists in the legacy system.

### Legacy `usePalette` hook (`src/hooks/usePalette.ts`)

Returns `paletteFor(settings.themeMode)` — the static legacy palette — instead of the live `Theme`. A repo-wide search finds no remaining consumers in `src/`; it survives for compatibility and should not be used by new screens.

### Key token values

| Token                                            | Dark (`darkTheme`)                | Light (`lightTheme`)              |
| :----------------------------------------------- | :-------------------------------- | :-------------------------------- |
| `bg` / `surface` / `card`                        | `#09090b` / `#111114` / `#17171b` | `#f5f5f7` / `#ffffff` / `#ffffff` |
| `raised` / `line` / `lineStrong`                 | `#1f1f24` / `#232329` / `#34343c` | `#ededf1` / `#e4e4ea` / `#d2d2db` |
| `text` / `muted` / `faint`                       | `#ededf0` / `#a3a3ad` / `#8b8b96` | `#18181b` / `#5c5c66` / `#7a7a85` |
| `accent` / `onAccent`                            | `#9d8cff` / `#09090b`             | `#6d5ce8` / `#ffffff`             |
| `bubbleMine` / `bubbleMineText` / `bubbleTheirs` | `#9d8cff` / `#0f0b24` / `#1c1c21` | `#6d5ce8` / `#ffffff` / `#ffffff` |
| `ok` / `warn` / `danger`                         | `#6fd39a` / `#e8c06a` / `#f2756e` | `#2e9a59` / `#a06a12` / `#d64545` |
| `overlay`                                        | `rgba(0, 0, 0, 0.6)`              | `rgba(20, 20, 24, 0.35)`          |

The OLED override only darkens three tokens: `bg: "#000000"`, `surface: "#050505"`, `card: "#0d0d0f"`; everything else stays dark-theme (`theme.ts:96`).

---

## 🧰 Shared UI primitives (`src/ui/*`)

### `Mascot` (`src/ui/Mascot.tsx`)

`Mascot({ seed, size, shape?, tone?, color?, mood?, working?, waiting?, lit?, shadow?, live?, rare?, style? })` draws each agent as a Saya from the shared family, matching desktop and web 1:1. It resolves identities via `resolveMascotLook(seed)` against `SAYA_CAST` (so canonical agents like Claude Code, Codex, Hermes, and Cursor receive their iconic faces rather than arbitrary hashes) before falling back to `sayaPick(seed)`. The geometry is rendered with `react-native-svg` (radial gradient turn halo, ambient shadow pool underneath, saaya depth shadow offset, base shell, visor, eyes, and full mood geometry including thinking dots, sleeping ZZ, and waiting approval badge/bang). When `live` or `working`, a smooth native-driver `Animated` vertical floating bob and breathing aura/ring pulse provide desktop-level life. Expo 52's Metro maps the `@sayabot/core/mascot` subpath straight to `packages/core/src/mascot.ts`. `PersonAvatar({ name, size })` renders initials in a raised bordered circle.

### `Sheet` (`src/ui/Sheet.tsx`)

`Sheet({ visible, onClose, title?, height = 0.6, right?, children })` is a transparent slide-up `Modal` with an overlay `Pressable` (tap to close), a grabber bar, optional title + right node, and a fixed-percentage height (`minHeight: 280`) whose content scrolls inside so the sheet never jumps (`Sheet.tsx:45-80`). A `PanResponder` on the header drags the sheet down, dismissing past 110px or velocity 1.2, springing back otherwise (`Sheet.tsx:34-43`). Used for chat actions, workspace switcher, new chat/task, questions, task detail, attachments.

### `Text` (`src/ui/Text.tsx`)

`Text({ variant, tone, weight, center, … })` wraps RN `Text` with an 8-variant type scale (`largeTitle` 32px … `caption` 12px) and tone → theme color mapping (`text`, `muted`, `faint`, `accent`, `danger`, `ok`, `warn`, `onAccent`) (`Text.tsx:8-17`, `19-38`). "All product text goes through this, so sizes and colours stay one system" (`Text.tsx:40`).

### `controls.tsx`

- **`Button`** — pill buttons in `primary` (accent bg) / `secondary` (raised) / `ghost` (transparent, accent text) / `danger` (dangerSoft bg), sizes sm 36 / md 46 / lg 54; fires `haptic.tap()` on press; shows an `ActivityIndicator` while `loading`; proper `accessibilityRole`/`accessibilityState` (`controls.tsx:10-70`).
- **`IconButton`** — round (default 40px) pressable with `hitSlop: 6` and haptic tap (`controls.tsx:73-109`).
- **`Group`** — iOS-style inset grouped list container: optional muted caption title, `theme.card` background with hairline separators (inset 56px for icon alignment), optional footer caption (`controls.tsx:112-139`).
- **`Row`** — a 52px-min list row: optional 30px icon tile with `iconBg`, title (danger tone when `destructive`), subtitle, trailing `value`, custom `right` node, and a chevron that defaults to on when `onPress` exists; press fires `haptic.select()` (`controls.tsx:141-214`).
- **`ToggleRow`** — a `Row` with a right-aligned `Switch` (accent track, `haptic.select()` on change) (`controls.tsx:216-253`).
- **`Badge`** — 20px count pill in accent/warn/muted, caps display at "99+", renders nothing at zero (`controls.tsx:255-267`).
- **`Chip`** — 34px pill toggle (selected = accent bg + onAccent text) with optional leading icon (`controls.tsx:269-296`).
- **`EmptyState`** — centered icon + title + muted body + optional action button (`controls.tsx:298-313`).

### `haptics` (`src/ui/haptics.ts`)

A module-level `enabled` flag (seeded from `loadSettings().hapticsEnabled`, settable via `setHapticsEnabled`) gates five `expo-haptics` wrappers: `tap` (light impact), `press` (medium impact), `select` (selection), `success` / `warn` (notification feedback). Every call is `.catch(() => {})`-guarded so simulators and old devices never throw (`haptics.ts:4-17`).

### `RichText` (`src/ui/RichText.tsx`)

The chat Markdown renderer built on `parseBlocks` — full behavior documented in [Home & chat](home-and-chat.md). It is part of the kit in that it consumes `useTheme()` tokens (`text`, `accent`, `raised`, `bubbleMine` tints) and is reused by both the chat screen and any surface rendering message bodies.

---

Related docs: [Overview](overview.md), [Home & chat](home-and-chat.md), [Computers & share](computers-and-share.md), [Push & updates](push-and-updates.md), [UI shell & kit (web)](../web/pages/ui-shell-and-kit.md), [Settings UI (web)](../web/pages/settings-ui.md)
