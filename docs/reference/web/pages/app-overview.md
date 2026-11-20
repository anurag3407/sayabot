# Web App Overview (`apps/web`)

`apps/web` is the Next.js 16 (App Router) front end of Sayabot: the marketing landing page, the authentication surface, the multiplayer workspace shell, and every workspace screen (rooms, agents, settings, routines, tasks, inbox, meetings). It is a React 19 server-first app that talks to PostgreSQL directly through `@sayabot/db` for reads and to the orchestrator through server actions and `/api/v1/*` proxying for mutations, and it ships as an installable PWA with a Serwist service worker.

This page maps the app's skeleton: middleware, layouts, the workspace shell, PWA plumbing, and build configuration. Feature screens are covered in their own pages under `docs/reference/web/pages/`.

Source files: `apps/web/src/proxy.ts`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/(workspace)/[org]/layout.tsx`, `apps/web/src/components/workspace-shell.tsx`, `apps/web/src/sw.ts`, `apps/web/src/app/manifest.ts`, `apps/web/src/app/offline/page.tsx`, `apps/web/src/components/pwa-update-prompt.tsx`, `apps/web/src/components/update-notification.tsx`, `apps/web/next.config.ts`

---

## 🛂 Middleware (`src/proxy.ts`)

The app uses Next.js **proxy mode** (middleware renamed): the exported entry point is `proxy(request)` rather than `middleware(request)`. Every non-static request passes through it.

The middleware does two things:

1. **Session refresh** — calls `updateSession(request)` from `src/lib/supabase/proxy.ts`, which builds a Supabase server client bound to the request/response cookie jars and calls `supabase.auth.getUser()`. If the auth token is expired, Supabase rotates it and the new cookies are written onto the response. Missing `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` throws.
2. **Routing gate** — a path allowlist decides who sees what.

```typescript
// apps/web/src/proxy.ts:62
if (!user && !isPublic) {
  const url = request.nextUrl.clone()
  url.pathname = "/login"
  url.searchParams.set("next", pathname)
  return redirectWithCookies(url, response)
}
```

Rules, in order:

| Condition                                                                  | Behaviour                                                                                                                               |
| :------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| No session, private path                                                   | Redirect to `/login?next=<path>`, carrying any cookies `updateSession` set.                                                             |
| Session, path is `/login` or `/signup`, no `force`/`reauth`/`switch` param | Redirect to the sanitized `next` param (via `safeNextPath`) or to `/`. This lets an already-signed-in user bounce off the auth screens. |
| `?force=true`, `?reauth=true`, or `?switch=true`                           | Bypass the bounce so a signed-in user can re-authenticate or switch accounts.                                                           |
| Otherwise                                                                  | Pass the (possibly cookie-refreshed) response through.                                                                                  |

`PUBLIC_PATHS` (matched as exact path or `path/...` prefix) covers the landing page, all auth screens (`/auth`, `/login`, `/signup`, `/forgot-password`, `/reset-password`), legal pages, `/download`, `/offline`, machine-to-machine surfaces authenticated by other means (`/api/v1`, `/api/mobile`, `/api/desktop`, `/api/remote`, `/api/files`, `/api/instance`, `/api/billing/webhook`, `/mcp`, `/bot`, `/api/account/merge`) and the OAuth 2.1 endpoints (`/.well-known`, `/oauth/register`, `/oauth/token`, `/oauth/callback`).

The matcher excludes static assets and health checks:

```typescript
// apps/web/src/proxy.ts:83
export const config = {
  matcher: [
    "/((?!api/health|_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|maskable-512.png|manifest.webmanifest|sw.js|swe-worker|workbox).*)",
  ],
}
```

---

## 🌳 Route Tree at a Glance

```
src/app/
├── layout.tsx                  # Root layout: fonts, Toaster, PwaUpdatePrompt
├── page.tsx                    # Landing page (redirects signed-in users)
├── manifest.ts                 # PWA manifest → /manifest.webmanifest
├── not-found.tsx, offline/page.tsx
├── login/ signup/ forgot-password/ reset-password/
├── auth/                       # callback (route), complete, save-account, merge, desktop, mobile
├── onboarding/ new-workspace/
├── (workspace)/[org]/          # Authenticated workspace, layout loads org + chats + bots
│   ├── page.tsx                # Chat list (org root)
│   ├── r/[roomId]/             # Room (chat, settings), loading.tsx
│   ├── agents/ cron/ tasks/ inbox/ meetings/ files/ search/ marketplace/
│   ├── chats/new/ analytics/ admin/ account/ remote/[hostId]/
│   └── settings/               # Settings layout + 14 sub-pages
└── api/                        # Route handlers (see API reference), plus /api/v1/[...path] proxy
```

For a signed-in user without a workspace, `/` redirects to `/onboarding`; with one, to the first org (`src/app/page.tsx:42`).

---

## 🧱 Root Layout (`src/app/layout.tsx`)

The root layout is minimal and deliberately dark-only:

- Metadata: title template `%s · Sayabot`, manifest link `/manifest.webmanifest`, SVG + favicon icons, `appleWebApp` capable with black-translucent status bar.
- Viewport: `themeColor: "#070907"`, `viewportFit: "cover"` for notched devices.
- Loads Geist and Geist Mono variable fonts via `@fontsource-variable`, then `globals.css`.
- Renders a skip-to-content link, `{children}`, the global `<Toaster />` (`src/components/ui/toast.tsx`), and `<PwaUpdatePrompt />`.

There is no theme provider or auth provider at the root — dark is the only theme (`className="dark"` on `<html>`), and auth state is resolved per-request on the server.

---

## 🏢 Workspace Layout (`(workspace)/[org]/layout.tsx`)

The `(workspace)` route group has no layout of its own; its `[org]` dynamic segment layout is the real authenticated shell. It is a server component that:

1. Awaits the `params` promise to get the org slug.
2. Calls `requireOrgAccess(orgSlug)` (`src/lib/auth.ts`) — this both resolves the current user and verifies membership, returning `{ user, org, role }` and redirecting on failure.
3. Loads, in parallel: `loadChatList(access)` (sidebar chats + `inboxCount`), `listOrgAgents(org.id)` (bot list), `listUserOrgs(user.id)` (org switcher), and `planUsageNotice(...)`.

`planUsageNotice` (`src/app/(workspace)/[org]/layout.tsx:11`) is Sayabot Cloud-only: for org admins it fetches `workspacePlan` + `workspaceUsage` and, once the month's `serverTurnsPerMonth` usage crosses 80% of the plan limit, returns `{ used, limit, planName }` to render a usage banner.

Everything is handed to the client `<WorkspaceShell>`:

```typescript
// apps/web/src/app/(workspace)/[org]/layout.tsx:35
<WorkspaceShell
  org={{ slug: access.org.slug, name: access.org.name }}
  orgs={orgs}
  chats={chatData.items}
  bots={orgAgents.map((agent) => ({ id, handle, displayName, kind }))}
  inboxCount={chatData.inboxCount}
  user={{ id, notifications, sound, displayName, avatarUrl, email, isGuest }}
  role={access.role}
  planUsage={planUsage}
>
```

Note `isGuest: access.user.isGuest === true` — guest accounts (see the auth page) get a persistent banner.

---

## 🖥️ Workspace Shell (`src/components/workspace-shell.tsx`)

`WorkspaceShell` is the client-side chrome around every workspace page. Responsibilities:

- **Update context** — wraps everything in `<UpdateProvider>` from `src/components/update-notification.tsx`.
- **Live activity** — `useWorkspaceActivity({...})` (`src/components/use-workspace-activity.ts`) receives the initial chat list, inbox count, current room id (parsed from the pathname with `/\/r\/([^/]+)/`), and the user's notification/sound preferences; it subscribes to workspace changes and returns the live `chats` and `inboxCount`. The room currently on screen is force-zeroed to `unreadCount: 0, mentionCount: 0` so the sidebar never shows unread for what you are reading (`workspace-shell.tsx:128`).
- **Command palette** — global `Cmd/Ctrl+K` opens `<CommandPalette>` seeded with `ALL_PAGES` (Chats, Inbox, To-dos, Routines, Files, Meetings, Agents, Find more agents, Search), chats, and bots. The sidebar itself shows only the everyday few (decided inside `src/components/workspace/sidebar.tsx`).
- **Unread badge** — `attentionUnread(chats)` sums `unreadCount` while skipping muted (`mutedUntil` in the future) and archived chats; shown in the mobile top bar as `99+`-capped.
- **Responsive layout** — desktop renders a fixed `284px` `<AppSidebar>` beside a rounded main pane. Mobile renders a hamburger top bar and puts `<AppSidebar>` inside a native `<dialog>` that is opened with `showModal()` and closed on navigation.
- **Desktop app integration** — `useDesktopApp()` detects the Electron wrapper via `window.sayabotDesktop`. In the Mac app the sidebar drag region is enabled (`[-webkit-app-region:drag]`) and the main pane is excluded from dragging, because the app hides its title bar.
- **Top bar and banners** — a desktop top bar with a back button and the plan-limit rings (see [UI shell](./ui-shell-and-kit.md)); `<PlanUsageBanner>` for cloud plan usage sits above the flex row. Guests save their account from a sidebar row, not a banner.

---

## 📡 Service Worker (`src/sw.ts`)

The service worker is built from `src/sw.ts` by **Serwist** (`@serwist/next`) and emitted to `public/sw.js`.

```typescript
// apps/web/src/sw.ts:28
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [noPageCache, ...defaultCache],
  fallbacks: {
    entries: [{ url: "/offline", matcher: ({ request }) => request.destination === "document" }],
  },
})
```

Key behaviours:

- **Never cache authenticated pages.** The `noPageCache` runtime route forces `NetworkOnly` for same-origin navigations and RSC requests (`request.headers.get("RSC") === "1"`) outside `/api/` — session-scoped HTML and RSC payloads must not sit in a shared browser cache (`sw.ts:20`).
- **Offline fallback** — failed document loads serve the precached `/offline` page.
- **Push notifications** — a `push` handler parses `{ title, body, url, tag, kind, toolCallId }`. Approval requests (`kind: "approval"` with a `toolCallId`) render **Allow / Don't allow** notification actions and `requireInteraction: true` (`sw.ts:70`).
- **Notification actions** — `notificationclick` with action `allow`/`deny` POSTs to `/api/v1/tools/<toolCallId>/approve` with the same-origin session cookie (`sw.ts:101`), then re-notifies "Allowed" / "Not allowed". If the decision fails (expired, already decided, signed out) it falls back to `openOrFocus`, which navigates an existing window to the payload URL or opens a new one.

## 📱 PWA Manifest (`src/app/manifest.ts`)

A standard `MetadataRoute.Manifest`: name "Sayabot", `display: "standalone"`, `start_url: "/"`, `background_color`/`theme_color` `#070907`, `orientation: "any"`, and four icons (`icon.svg` any, `icon-192.png`, `icon-512.png`, and `maskable-512.png` with purpose `maskable`).

## 📴 Offline Page (`src/app/offline/page.tsx`)

A static, precached page that explains the model: "The workspace is cached, messages are not" — reconnect to load rooms, and messages composed offline wait in the browser and send when the connection returns (the outbox lives in `src/lib/message-send.ts`, not here). It is listed in `additionalPrecacheEntries` so it is available even before any navigation has happened.

## 🔄 Update Prompts

Two components cooperate so exactly one update toast appears per deploy. The shared bus is `src/lib/web-update.ts`: `onWebUpdate(listener)` registers the workspace's own UI, and `reportWebUpdate()` notifies it and returns `false` when nobody is listening — telling the caller (the PWA prompt) to show the toast itself.

**`PwaUpdatePrompt`** (`src/components/pwa-update-prompt.tsx`) mounts once in the root layout and:

- Skips itself in development, when no service worker is supported, or inside the Mac app (`window.sayabotDesktop`).
- Registers `/sw.js` with scope `/`, listens for `updatefound` → new worker `installed` while a controller exists, and guards with `hasPrompted` so it fires once.
- Polls `reg.update()` every 30 minutes and on tab/app refocus (`visibilitychange`).
- When an update is found and no in-workspace listener claimed it (`reportWebUpdate()` returned false), shows a toast with a "Refresh to Update" action that posts `{ type: "SKIP_WAITING" }` to the waiting worker and reloads.
- Also listens for `controllerchange` (skipWaiting took effect) to notify.

**`UpdateProvider` / `useAppUpdate`** (`src/components/update-notification.tsx`) handles the other two update sources and renders the actual cards:

| Source                            | Detection                                                                                                                                                                                           | Card                                                                                                                                                                                  |
| :-------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Newer website (browser + Mac app) | Polls `/api/version?t=<now>` (no-store) every 5 minutes and on visibility; compares the `gitCommit` against the commit the page loaded from. Also hears `onWebUpdate` from the service-worker path. | "Sayabot was updated" with a Reload button that SKIP_WAITINGs then reloads.                                                                                                           |
| Mac app update available          | Talks to the `window.sayabotDesktop` bridge (`getVersion`, `checkForUpdates`, `getUpdateState`, `installUpdate`, `onUpdateState`; mirrors `UpdateState` in `apps/desktop/src/updater.ts`).          | Progress card for `downloading`/`installing` (percent bar), install prompt for `available`, retry card for `error`. `applyUpdate()` installs the Mac update when ready, else reloads. |

`useAppUpdate()` returns a no-op-safe default outside the provider, and any screen can call `checkForUpdates()` — inside the Mac app the native app answers in its own dialog; in a browser a toast reports "newest" or "reload".

---

## ⚙️ Build Configuration (`next.config.ts`)

| Setting           | Value / purpose                                                                                                                                                                                                                                                                                                                         |
| :---------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serwist           | `withSerwistInit({ swSrc: "src/sw.ts", swDest: "public/sw.js", disable: NODE_ENV === "development", cacheOnNavigation: false, reloadOnOnline: true })`. `additionalPrecacheEntries` pins `/offline`, `/icon.svg`, `/icon-192.png`, `/manifest.webmanifest` with a revision from `VERCEL_GIT_COMMIT_SHA` / `GIT_COMMIT_SHA` / timestamp. |
| Standalone output | `NEXT_OUTPUT=standalone` (Docker builds) enables `output: "standalone"` with `outputFileTracingRoot` at the monorepo root so `packages/*` imported as source are traced.                                                                                                                                                                |
| Packages          | `transpilePackages: ["@sayabot/core", "@sayabot/db", "@sayabot/llm"]` (consumed as source), `serverExternalPackages: ["pg", "pg-boss", "@e2b/code-interpreter"]`.                                                                                                                                                                       |
| Client fallbacks  | Webpack sets `fs: false`, `child_process: false` for the browser bundle (node-only modules leak through shared package imports).                                                                                                                                                                                                        |
| TypeScript        | `ignoreBuildErrors: true` — the monorepo mixes React 19 (web) and React 18 (mobile), so the web app typechecks separately via `pnpm --filter @sayabot/web typecheck`.                                                                                                                                                                   |
| Hardening headers | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()` on every route; `poweredByHeader: false`.                                                                                                    |
| Bundler           | Empty `turbopack: {}` config (Turbopack enabled for dev).                                                                                                                                                                                                                                                                               |

---

## Related docs

- [Auth flows](./auth-flows.md) — login/signup screens behind the middleware gate
- [Onboarding](./onboarding.md) — the `/onboarding` and `/new-workspace` screens
- [Room chat UI](./room-chat-ui.md) — the `r/[roomId]` screen the shell wraps
- [Model system](./model-system.md) — providers view and model pickers
- [Settings UI](./settings-ui.md) — the settings layout and pages
- ../../architecture/system-overview.md — the server side this front end talks to
- ../../architecture/auth-and-authorization.md — Supabase session model behind `updateSession`
- ../../architecture/realtime-and-events.md — the realtime feed `useWorkspaceActivity` consumes
- ../../architecture/monorepo-and-build.md — how `apps/web` builds in the Turborepo
- Server actions that power these screens are catalogued under `docs/reference/web/actions/`; route handlers under `docs/reference/web/api/`.
