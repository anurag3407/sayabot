# Workspace Shell & UI Kit

The authenticated chrome of the app — `WorkspaceShell` (mobile top bar, desktop sidebar, command palette, banners), `AppSidebar` (workspace switcher, chats, bots, tools, account), the `ChatList` component, the ⌘K `CommandPalette`, and the `PlanUsageBanner` — plus the small design-system kit under `components/ui/` (Button, Avatar, Field, Icons, Mascot, Status, Empty, Skeleton, Toast, DetailsMenu, ActionForm, ConfirmButton, CopyButton) and the formatting/identity helpers in `lib/` those components lean on.

Source files: `apps/web/src/app/globals.css`, `apps/web/src/lib/sidebar-usage.ts`, `apps/web/src/components/ui/live-mascot.tsx`, `apps/web/src/components/ui/mascot-loader.tsx`, `apps/web/src/components/workspace-shell.tsx`, `apps/web/src/components/workspace/sidebar.tsx`, `apps/web/src/components/workspace/chat-list.tsx`, `apps/web/src/components/command-palette.tsx`, `apps/web/src/components/plan-usage-banner.tsx`, `apps/web/src/components/ui/*`, `apps/web/src/components/copy-button.tsx`, `apps/web/src/lib/format.ts`, `apps/web/src/lib/datetime.ts`, `apps/web/src/lib/human-handle.ts`, `apps/web/src/lib/agent-handle.ts`, `apps/web/src/lib/image-avatar.ts`, `apps/web/src/lib/brand-logos.ts`

---

## 🖼️ Workspace Shell (`components/workspace-shell.tsx`)

The client-side wrapper every `/[org]/*` page renders inside (fed by the `[org]` layout — see [App overview](./app-overview.md)). Behaviour:

- **Live activity** — `useWorkspaceActivity({...})` receives the initial chat list, inbox count, notification/sound prefs and the current room id (regex `/\/r\/([^/]+)/` over the pathname). The chat on screen is force-zeroed to `unreadCount: 0, mentionCount: 0` so the sidebar never shows unread for what you are reading (`workspace-shell.tsx:128-134`).
- **`attentionUnread`** sums `unreadCount` skipping archived chats and chats muted until a future time (`workspace-shell.tsx:43-53`).
- **Command palette** — global `Cmd/Ctrl+K` toggles `<CommandPalette>`; `ALL_PAGES` (`workspace-shell.tsx:31-41`) feeds it: Chats, Inbox, To-dos, Routines, Files, Meetings, Agents, Find more agents, Search.
- **Responsive layout** — desktop: fixed sidebar, `272px` at `md` and `288px` at `lg` (`border-r border-line/70 bg-void`) beside a full-bleed `main` pane on `bg-ink`. Mobile: a hamburger top bar (with `SayabotMark`, org name and a combined `inbox + unread` badge capped at `99+`) opens the same `AppSidebar` inside a native `<dialog>` via `showModal()`, closed automatically on navigation.
- **Navigation feedback & prefetching** — all primary links in the sidebar (`ThreadRow`, `SayaRow`, `UsageRow`, `ToolsGrid`, Settings) use `prefetch={true}` for near-instant route opening from client cache. `<NavigationProgress>` (`components/ui/navigation-progress.tsx`) sits at the root layout, intercepting link clicks for instant 0ms visual acknowledgment with an accent gradient progress line.
- **Mac app integration** — `useDesktopApp()` detects `window.sayabotDesktop`; when present the flex row gets `[-webkit-app-region:drag]` and the main pane `no-drag`, because the Mac app hides its title bar and the dark gutters become the drag region.
- **Navigation & BackButton** — `BackButton` sits directly in the sidebar header (`headerExtra`, right before `WorkspaceSwitcher`) on desktop and in the mobile top bar. It counts in-window navigations and calls `router.back()` when there is history, otherwise pushes the workspace home; it is hidden on the home itself. `⌘[` goes back too (ignored while typing in a field).
- **Main pane** — full-width, full-height (`min-h-0 min-w-0 flex-1 overflow-hidden bg-ink`) extending flush to all viewport edges without rounded corners or outer margins.
- **Usage** — the org layout also passes `usage` from `loadSidebarUsage(orgId)` (`lib/sidebar-usage.ts`): this calendar month's replies (`kind = "llm"` requests), tokens and spend from the `usage_rollup` RPC, plus on Sayabot Cloud the plan's `serverTurnsPerMonth` allowance and how much is used. It never throws; `null` hides the numbers.
- **Banners** — only `<PlanUsageBanner>` when the layout's `planUsageNotice` returned data. Guests get a quiet "Save your account" row in the sidebar instead of a banner.

## 🧭 App Sidebar (`components/workspace/sidebar.tsx`)

One column with a clear order of importance, top to bottom. Every tint uses theme tokens (`bg-text/[…]`, `ring-text/[…]`), so light and dark mode both hold.

- **Header** (`h-14`): `headerExtra` (BackButton), then **WorkspaceSwitcher**, a quiet `rounded-xl` row with the org's mascot in a tile, its name and a chevron. Its popover lists the user's orgs (`/<slug>` links, slug shown when two share a name) plus "New workspace". The menu is positioned against the header (`left-2.5 right-2.5 top-full`), so in the desktop app it spans the sidebar under the traffic-light inset. Last is the **compose "+"** (a filled tile that turns accent on hover) with New bot (`${base}/agents/new`, ⌘N hint), New group chat (`${base}/chats/new`) and, when the orchestrator chat exists, **Ask Saya to set it up** (crown icon). A global keydown binds plain `⌘/Ctrl+N` to new-bot; only the _visible_ sidebar instance answers (`searchInput.current?.offsetParent`). The plan rings no longer sit in the header.
- **Search** (`h-9`) — filters chats (`/` focuses it, Escape clears) and falls through to full-message search on Enter (`${base}/search?q=…`). A ⌘K chip opens the palette. The no-match state shows a thinking Hoot and "Nothing matches. Press Enter to search every message."
- **Workspace nav** — two compact rows with 28px icon tiles:
  - **Inbox**, with a `99+`-capped accent badge.
  - **Usage** (`UsageRow`, links to `${base}/analytics`). Usage used to live only in the account menu and Settings; it is a first-class row now. When the Mac app reports plan limits (`usePlanLimits`), the row shows a small `PlanRing` per provider (the rings that used to sit in the header). Otherwise it shows this month's tokens and spend from `usage`. On Cloud a thin bar under the label shows the share of the plan's server replies used (accent, then warn at 75% and danger at 90%). The `title` tooltip lists every reading.
- **Orchestrator card** (`OrchestratorCard`) — the workspace orchestrator's chat (`item.orchestrator`, Saya) is lifted out of the lists into a featured card: a gradient tile with a soft glow, her live mascot wearing the **crown**, a "Lead" chip in the theme's `warn` colour, the last message (or "Ask me to set up bots, rooms and routines"), and mention or unread badges. Additional orchestrator chats, if any, fall into Pinned.
- **Lists** (scrolling) — `Section` headers are small uppercase labels with a fold chevron and a count pill (fold state persisted in `localStorage` under `sayabot:sidebar:<id>`), plus a "+" that is hover-revealed on desktop and always visible on touch.
  - **Pinned** chats.
  - **Bots**: bot DMs then `NewBotRow` for bots without a DM yet (tapping calls `openBotDmAction(orgSlug, bot.id)` and pushes `data.path`). Empty state: a dashed "Make your first bot" row with a happy Pip.
  - **Group chats**: non-DM chats with `#` or initial tiles (plus a mini mascot when an agent is in the chat). Empty state: "Start a group chat and invite bots".
  - **Archived** chats behind a count toggle.
- **ThreadRow** — a 32px face (bot DMs get their mascot; the orchestrator's gets the crown), name, pin icon, relative `shortTime` (`suppressHydrationWarning`, since the server and the browser can be in different time zones), last message preview ("Say hello" for untouched bot DMs), and badges: accent mention count, unread dot (not when muted), or a muted BellOff. The active row gets a tinted background and a 3px accent bar at the left edge. Its `DetailsMenu` (vertically centred on the row) offers Edit bot or Chat settings, Copy link, Pin/Unpin, Mark as unread, Mute for 8 hours / Mute until I unmute (or Unmute), Archive/Move back.
- **Row actions** go through `setChatPreferenceAction({ orgSlug, roomId, action, duration })` in a transition; failure toasts, success `router.refresh()`s, and archiving shows a toast with an **Undo** action.
- **Tools** (`ToolsGrid`, a foldable section above the account row) — a 3 × 2 grid of compact tiles instead of six full-height rows: Routines, To-dos, Files, Team (`/agents`), Connectors (`/connectors`), Bot store (`/bot-store`). The active tile's icon turns accent.
- **Save your account** — for `user.isGuest`, a tinted accent card with a pulsing dot linking to `/auth/save-account?next=/<org>`.
- **AccountRow** — avatar (green "update ready" dot when `useAppUpdate().updateReady`) with the name and the role (or "Guest") under it, plus a Settings icon button. The popover shows name/email, the update install button ("Install Sayabot <version>" or "Reload for the new version"), Settings, Meetings, Usage, Get the apps (with `appVersion`), Check for updates, Help, the theme toggle and `signOutAction`.
- The top of the sidebar has a soft iris radial colour wash. In the desktop app the header is drag-enabled with `pl-[84px]` clear of the traffic lights, and the footer respects `env(safe-area-inset-bottom)`.

### `ChatList` (`components/workspace/chat-list.tsx`)

A second, roomier list component (used by mobile/home surfaces) with two modes: `newChatHref` selects the **flat desktop column** (search always visible with a new-chat button, one flat list, filter chips only while focused/searching); otherwise **grouped mode** with `Group` headers (Pinned / Your agents with "See all" / Group chats). It has richer filters than the sidebar — All / Unread / Mentions / Agents / Archived with live counts — the same per-row action menu (pin, mark unread, mute 8h/1w/always, archive) implemented with its own button+overlay instead of `DetailsMenu`, the same `setChatPreferenceAction` flow with archive-Undo toast, and `BotRow` ("Tap to say hi") like the sidebar's `NewBotRow`. Both this file and `sidebar.tsx` export a `BotLink` interface (`id, handle, displayName, kind: "llm" | "external"`); `command-palette.tsx` imports it from `chat-list`.

## ⌘K Command Palette (`components/command-palette.tsx`)

A native `<dialog>` (`mt-[12vh]`, `max-w 640px`) with a combobox input and a grouped `role="listbox"`. Commands are built from five groups (`GROUP_ORDER`):

| Group    | Contents                                                                                                              |
| :------- | :-------------------------------------------------------------------------------------------------------------------- |
| Actions  | New chat, Create an agent, Search messages and files                                                                  |
| Chats    | every non-archived chat (`#name` or DM name), hint = unread count or first two agent names, keywords from agent names |
| Agents   | every bot, hint `@handle`, keyword `external` for MCP bots                                                            |
| Go to    | the passed `pages` (ALL_PAGES) plus a hard-coded Usage entry                                                          |
| Settings | every link from `visibleSettingsGroups(isAdmin)` (`lib/settings-nav.ts`), keywords from their descriptions            |

Scoring (`score()`, `command-palette.tsx:35-51`): prefix match 100, substring 80 minus position (with a +15 word-boundary bonus), subsequence 20 — "so 'gen' finds '#general' before 'agents'"; keyword/hint matches are weighted 0.6/0.7. Empty query limits each of Chats/Agents to 5 and hides Settings; a query caps results at 30. Keyboard: ↑/↓ wrap, Enter runs, mouse hover moves the selection; scrolling keeps the active item in view. Zero results offers "Search messages for it instead" → `${base}/search?q=<query>`.

## 📣 Plan Usage Banner (`components/plan-usage-banner.tsx`)

Sayabot Cloud only (fed by `planUsageNotice` in the org layout — admins only, shown at ≥80% of the month's `serverTurnsPerMonth`). Dismissible for the session with a ✕ button. Copy: "N of M server replies used this month." or, at/over limit, "This month's M server replies are used up." plus "Agents on your Mac keep working on <planName>." — with a red dot when out, amber otherwise, and a "Upgrade" / "See plans" button to `/${orgSlug}/settings/billing`.

## 🧰 UI Kit (`components/ui/`)

### `button.tsx` — `Button`

CVA variants: `primary` (accent bg), `secondary` (raised + border, the default), `outline`, `ghost`, `danger`, `quiet`; sizes `sm`/`md`/`lg`/`icon`/`icon-sm` (mobile-first heights, smaller at `md:`). Defaults `type="button"`. Also exports `buttonVariants` for non-button elements.

### Theme System (`theme-provider.tsx`, `theme-toggle.tsx`)

Sayabot supports seamless switching between dark mode, light mode, and system preference:

- **`ThemeProvider` & `ThemeScript`** (`components/theme-provider.tsx`): React context exposing `{ theme, resolvedTheme, setTheme, toggleTheme }`. Persists selection in `localStorage` under `sayabot-theme` (`"system" | "dark" | "light"`). An inlined `<ThemeScript />` executes synchronously in `<head>` to prevent Flash of Unstyled Theme (FOUT) before hydration.
- **`ThemeToggle`** (`components/theme-toggle.tsx`): Tri-mode component with variants:
  - `icon`: Compact toggle button cycling between themes (used in public headers).
  - `menu-item`: Interactive segmented item embedded in the workspace sidebar account menu.
  - `segmented`: Full 3-tab segmented control for system, light, and dark modes (used in `settings/profile`).
- **Color tokens & Tailwind CSS v4 variables** (`app/globals.css`): Light mode adapts `--color-void` (#f5f5f7), `--color-ink` (#ffffff), `--color-panel` (#ffffff), `--color-raised` (#ededf1), `--color-line` (#e4e4ea), `--color-text` (#18181b), and high-contrast `--color-accent` (#6d5ce8), with dynamic Monaco editor (`mesh-light` vs `mesh-dark`) and Mermaid diagram themes.

### `avatar.tsx` — `Avatar`, `AvatarStack`, `PresenceLine`

`Avatar({ name, kind, size, src, crown })`: `kind="system"` renders a bordered `*` glyph; `kind="agent"` renders the seeded `Mascot` (with the orchestrator crown when `crown`); humans render initials (`initials()` from `lib/format.ts`) or the uploaded `src` image in a circle. Sizes sm/md/lg (24/28/40px). `AvatarStack` shows up to `max` (default 5) overlapping avatars with typing-highlight rings and a `+N` overflow. `PresenceLine` renders "X is typing" / "N people are typing" / "just you" / "N others here".

### `field.tsx` — `Label`, `Input`, `Textarea`, `Select`, `Field`, `HelpText`

Shared `controlClass` (panel bg, control border, accent focus). `Label` is mono with an optional right-aligned `hint`. `Field({ label, htmlFor, hint, error })` wraps a control with label + `role="alert"` error paragraph.

### `icons.tsx`

~18 hand-drawn 20×20 stroke icons at 18px default: Send, Plus, Close, ChevronDown/Up, Check, Stop, Reply, History, Canvas, Rooms, Agents, Analytics, Shield, Sliders, Menu, Copy, Key, Bot, Tools, Logout, Search, Trace — all `aria-hidden` with currentColor stroke.

### `mascot.tsx` — the Saya family

The brand identity renderer: `Mascot({ seed, shape, color, mood, lit, figure, shadow, blink, live, rare, crown, label, svgRef, children })`. It draws from the shared geometry in `@sayabot/core` ([core/mascot](../../core/mascot.md)), so web, landing, mobile and the exported brand files are identical.

- A seed string goes through `resolveMascotLook`. Names in the art-directed cast (Saya, Nova, Claude Code, Codex, Hermes, Cursor, and the character names) keep that shape and colour. Every other name goes through `sayaPick` (FNV-1a) for a **shape** (ghost, peak, ledger, bubble, hoot, bloom, sprout, block) and a **tone** (eight palettes, each a base, a darker shade and a pale eye tint), so an agent keeps the same look everywhere. `shape` overrides the shape. A cast name still keeps its colour unless `color` is set; otherwise the shape's default tone is used. `color` takes any CSS colour and mixes the shade and eye tint from it with `color-mix(in oklab, …)`.
- A **named cast** overrides generation: Saya (ghost, lilac), Nova, Claude Code, Codex, Hermes, Cursor, Pip, Moss, Juno, Tofu, Nori, Bean, Olive, Miso, plus the shape names Peak, Ledger, Bubble, Hoot, Bloom, Sprout and Block, each with an art-directed shape and tone (`CAST` in `mascot.tsx`).
- Anatomy, back to front: the **saaya** (the shell's silhouette 6 units lower in the shade tone — "saaya" means shadow), the flat **shell**, an optional shade **detail** (Ledger's folded corner), an ink **visor**, and two **eyes**. `mood` is `idle | happy | sleep | busy | alert | thinking`, mapped onto the family's moods (`happy`→done ^^ arcs, `sleep`→closed arcs plus "zz", `busy`→working dash eyes, `alert`→waiting wide eyes plus an amber "!" badge, `thinking`→eyes up plus thought dots). Only the eyes and the top-right extras change. `lit` glows a soft halo behind the mascot (`.saya-halo`, pulsing) — across the brand it means exactly one thing: it is this agent's turn. Eyes steer via `--lx`/`--ly` CSS vars (set by `LiveMascot`). `blink` wraps eyes in a `mascot-eyes` animation class. `figure` uses a 100×146 viewBox and stands the mascot (scaled 1.2) on a floor with headroom for mood extras; `shadow` draws the hover pool.
- Gradients/IDs are namespaced by `useId`; without a label the SVG is `aria-hidden`.
- **`live`** makes a Saya alive: the svg gets `saya-live` and `data-mood`, so it hovers (`saya-bob`), pulses its shadow and blinks; `busy` tilts its head and `happy` hops. **`lit`** halos also pulse.
- **The crown** — `crown` draws a small gold crown (gradient fill, three jewel tips, a pink and two blue gems, a highlight stroke) tilted −9° on top of the head inside `.saya-head`, so it bobs with a live mascot. It marks the workspace orchestrator (Saya) everywhere she appears: the sidebar card and rows, the room header, chat message avatars, and the bot panel. Callers decide with `isSayaHandle(handle)` or the `orchestrator` capability.
- **The rare Saya** — `RARE_MASCOT = "Nova"`, reserved for the orchestrator: a ghost with `rare: true` (or any Saya with `rare`) gets an iridescent pink→lilac→blue→mint shell that slowly shifts hue (`saya-prism`) and four twinkling sparkles (`saya-spark`).
- All Saya CSS (halo, motion) lives in `app/globals.css`, so the workspace and the old in-app landing share it; every animation stops under `prefers-reduced-motion`.

### Brand files (`apps/web/scripts/export-mascots.ts`)

`pnpm --filter @sayabot/web brand:mascots` renders the real `Mascot` into standalone SVGs in `apps/web/public/brand/mascots/` (served at `/brand/mascots/*`): `<name>.svg` (static, halo lit) and `<name>-live.svg` (embedded CSS animation: hover, blink; Nova also shimmers and sparkles) for Saya, Nova, Pip, Moss, Juno, Tofu, Nori, Bean, Olive and Miso; standing `saya-figure` / `nova-figure` (+ `-live`); Saya's moods (`saya-happy|busy|sleep|alert|thinking.svg`); a `cast.svg` contact sheet; and a README naming each character. The script resolves CSS variables and `color-mix(in oklab, …)` to hex (its `TOKENS` map mirrors `globals.css`), namespaces ids, pads the viewBox so halos, extras and shadows are not clipped, and copies the live Pip/Nova/Moss into the Mac app's renderer. Third-party tool names from the in-app cast are left out. Regenerate after changing the component.

### App icons (`apps/web/scripts/export-icons.ts`)

`pnpm --filter @sayabot/web brand:icons` draws the Saya app icon (Saya the ghost on an ink tile with a lilac glow) from the shared geometry with `sharp` and writes every platform's files in one run: `assets/branding/saya-icon/*.svg` (rounded, square, mac, maskable, notification glyph, plus a README); web `public/icon.svg`, `favicon.ico` (16/32/48 PNG-in-ICO), `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `maskable-512.png`; landing `public/icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og.png` (1200×630 cast card); desktop `assets/icon.png` (padded macOS squircle), `build/icon.ico`, `src/renderer/mark.svg`; mobile `assets/icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png`, `mark.png`, `notification-icon.png` (alpha-only white glyph). Re-run after changing the mark. The in-app `SayabotMark` (`landing/mesh-mark.tsx`) draws the same tile inline.

### `live-mascot.tsx` — `LiveMascot`, `useInView`

`LiveMascot` wraps `Mascot` so its eyes follow the pointer (one rAF-throttled `pointermove` listener shared by every instance, only with a fine pointer) and it smiles on hover; pass `live` for the idle motion, while the landing page uses `float`. `useInView` is an `IntersectionObserver` boolean. The home empty state (`ia/chats-view.tsx`) shows your first two bots flanking Nova as live mascots.

### `mascot-loader.tsx` — `MascotLoader`

The Sayabot loader (`role="status"`, `aria-live="polite"`): Pip, Nova and Moss stand on glow pools and pass the lit lamp down the line every 720 ms (the one holding it hops), while a step line ("Waking up your bots…") rotates every 2.2 s above a sweeping accent bar (`loader-sweep`). `compact` shrinks it. Static under reduced motion. Opening a workspace uses `WorkspaceSkeleton` instead.

### `status.tsx` — `StatusBadge`, `Kbd`

`StatusBadge({ status, label })` is a mono chip whose color comes from `statusTone()` (`lib/format.ts`): ok for `complete/done/approved`, warn for `streaming/running/pending_approval`, danger for `error/rejected`, accent for `halted`, muted otherwise; underscores become spaces. `Kbd` is a small styled `<kbd>`.

### `empty.tsx` — `EmptyState`, `InlineAlert`

`EmptyState({ title, body, action })` is a left-bordered text block (used by search, files, inbox). `InlineAlert({ tone })` renders neutral/success/warning/danger notices (`danger` gets `role="alert"`).

### `skeleton.tsx` — `Skeleton`, `PageSkeleton`, `RoomSkeleton`, `WorkspaceSkeleton`, `SetupSkeleton`

Pulsing placeholders. `RoomSkeleton` (`role="status"`) backs the room `loading.tsx`. `PageSkeleton` backs `(workspace)/[org]/loading.tsx` and the list routes (tasks, inbox, files, agents, meetings, routines, marketplace, search, analytics, account, new chat, new agent). `WorkspaceSkeleton` is the full shell (sidebar plus a room) shown while a workspace is created or opened: onboarding submit, resuming onboarding, `/new-workspace` submit, and `/auth/complete`. `SetupSkeleton` backs `onboarding/loading.tsx` and `new-workspace/loading.tsx`.

### `toast.tsx` — `showToast`, `Toaster`

A custom-event bus (`mesh:toast`): any code can `showToast({ message, tone?, action?, durationMs? })` without context. `Toaster` (mounted once in the root layout) listens, keeps at most 4 visible, auto-dismisses after 5 s (or per `durationMs`), renders top-right cards with tone borders and an optional action link/button, and is `aria-live="polite"`. Actions carry `{ label, href? , onClick? }` — used for the archive **Undo**.

### `details-menu.tsx` — `DetailsMenu`

A `<details>` dropdown that closes on outside pointerdown and Escape (returning focus to the summary) and when a menu item, link or button inside is chosen (typing in a field does not close it). Its document listeners exist only while it is open, and its children render only while open: the sidebar has one per chat, and permanently attached listeners made every click and key press fan out across the list. Keyboard: ArrowDown on the summary opens it and focuses the first item; ArrowUp/ArrowDown/Home/End move between items; the summary carries `aria-haspopup="menu"`. Powers the sidebar popovers, workspace switcher, account menu, per-row menus and the composer's "+" and execution-mode menus.

### `summary-focus-guard.tsx` — `SummaryFocusGuard`

Mounted once in the root layout. Chromium paints the keyboard focus ring on a `<summary>` even after a mouse click, which left a thick accent ring around every dropdown and disclosure. The guard marks a summary pressed with a pointer (`data-pointer`, capture-phase `pointerdown`) and clears the mark on any key press or when the summary loses focus; `globals.css` hides the ring for `summary[data-pointer]:focus-visible`, so keyboard users still see it.

### Surfaces and palette (`app/globals.css`)

The app runs on a cool graphite scale (`--color-void #09090b` → `--color-hover #27272d`) with an **iris** accent (`--color-accent #9d8cff`, `-strong #b6a9ff`, `-soft #1d1a33`), chosen for contrast (faint text stays ≥ 4.5:1 on panels). The marketing page (`.l-page` in `landing.css`) keeps its ember accent. `.surface-pop` is the one look for popovers and menus (translucent panel, strong hairline, deep shadow, backdrop blur) and `.pop-in` / `.fade-in` are their entrance animations.

### `action-form.tsx` — `ActionForm`

Standard wrapper for form-action server actions with the `(_prev, formData) => ActionResult` signature: `useActionState` wiring, error/warning `InlineAlert`s, success toast (`state.message`) with optional `resetOnSuccess`, an optional `confirmLabel`/`confirmWarning` that swaps the submit button for a `ConfirmButton`, plus `footer` and `submitVariant` props.

### `confirm-button.tsx` — `ConfirmButton`

Two-step destructive button: first click swaps to warning text + danger confirm ("autoFocus") + Cancel; the confirm state auto-resets after `RESET_AFTER_MS = 8_000` unless pending. With `submit: true` it renders a form submit button instead of calling `onConfirm` (used inside forms).

### `copy-button.tsx` — `CopyButton`

Clipboard write with `idle/copied/failed` states ("copied" for 1.5 s, "copy failed" for 2 s), mono styling, `aria-live="polite"`.

## 🪛 Formatting & Identity Helpers

### `lib/format.ts`

- `cn()` — clsx + tailwind-merge.
- `initials(name)` — first+last initial letters (or first two chars), uppercase; "?" when empty.
- `relativeTime(iso)` — "now" → "Nm ago" → "Nh ago" → "Nd ago" → short date.
- `clockTime(iso)` / `fullTime(iso)` — localized time / date-time strings.
- `formatUsd` ($0.00 / 6-decimals under a cent / 2 decimals), `formatNumber`, `formatTokens` (K/M/B/T with adaptive precision), `formatPercent` ("<0.1%"-aware), `formatMs` ("820 ms" / "1.3 s"), `formatBytes` ("1.5 KB", "1.4 GB").
- `pretty(value)` — safe 2-space JSON; `truncate(value, max)` with ellipsis.
- Label maps: `PROVIDER_LABELS` (incl. `copilot` → "GitHub Copilot", `openai-compatible`), `ROOM_KIND_LABELS`, `TURN_MODE_LABELS` / `TURN_MODE_SHORT` (mentions / debate / moderated).
- `statusTone(status)` — the color mapping used by `StatusBadge`.
- `effectiveProvider(provider, baseUrl)` — recovers the real provider behind "openai-compatible" keys (OpenRouter, Copilot) via `providerForBaseUrl` from `lib/ai-accounts.ts`.

### `lib/datetime.ts`

`toDateTimeLocalValue(date)` and `dateTimeLocalToIso(value)` — round-tripping for `datetime-local` inputs (schedule forms) in the browser's own time zone.

### `lib/human-handle.ts`

`humanHandle(name)` — NFKD-normalized, diacritic-stripped, slugified (max 38 chars) mention handle for people; `humanMention(name)` prefixes `@`.

### `lib/agent-handle.ts`

`handleFromName(name)` — agent-handle suggestion: slugify, strip leading non-letters, cap at 39 chars ("Suggests a valid agent @handle from its display name"). Unit-tested in `tests/unit/handles.test.ts`.

### `lib/image-avatar.ts`

`readAvatarFile(file)` — client-side avatar upload pipeline: accept PNG/JPEG/WebP only, decode via `createImageBitmap` (falling back to `Image`), center-crop to 256×256 on a canvas, encode WebP at 0.82 quality, and reject data URLs above `MAX_DATA_URL = 300_000` chars. Returns the data URL for the profile form.

### `lib/brand-logos.ts`

`BrandLogoSpec` map (`name`, `color`, SVG `path`) of official Simple Icons glyphs — GitHub, Slack, Google Drive (alias `google_drive`), Notion, Linear, Atlassian, Stripe, Sentry, Discord, Cloudflare, Canva, Telegram, WhatsApp — with `brandLogo(id)` lookup. Consumed by `components/connectors/brand-logo.tsx` (marketplace tiles) and connector settings.

## Related docs

- [App overview](./app-overview.md) — the server layout that feeds `WorkspaceShell` its props, and update plumbing
- [Room chat UI](./room-chat-ui.md) — the room view the shell wraps
- [Settings UI](./settings-ui.md) — the settings nav entries surfaced in the palette's Settings group
- [Analytics / Usage UI](./analytics-usage-ui.md) — `PlanRing`, plan limits and the Usage page the sidebar's Usage row links to
- [Marketplace & Connectors](./marketplace.md) — the "Connectors" and "Bot store" tool links and brand logos in action
- [Landing page](./landing-page.md) — the `SayabotMark` and `Mascot` components shared with marketing
- [lib-reference](./lib-reference.md) — `format.ts` consumers and the rest of `lib/`
- ../../architecture/realtime-and-events.md — the feed `useWorkspaceActivity` consumes
