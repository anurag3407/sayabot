# API Guard & Authentication

Every route in the web app authenticates with one of a few credential classes: a Supabase **session cookie** (browser), a Supabase **bearer token** (phone and desktop apps), a **host/device token** pair (Sayabot for Mac, paired phones), or the **internal secret** (web → orchestrator/computerd only, never accepted from outside). A Next.js edge middleware (`src/proxy.ts`) forces sign-in for pages while leaving the self-guarding API prefixes open; each guarded route then re-checks authorization itself. There is no in-app rate limiting — quotas come from plan gates, Row Level Security, and Supabase's own auth limits.

Source files: `apps/web/src/lib/route-auth.ts`, `apps/web/src/lib/route-bearer.ts`, `apps/web/src/lib/orchestrator.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/supabase/proxy.ts`, `apps/web/src/lib/supabase/server.ts`, `apps/web/src/lib/supabase/admin.ts`, `apps/web/src/lib/safe-next.ts`, `apps/web/src/lib/env.ts`

---

## 🛂 The credential classes

### 1. Session cookie (browser)

`createSupabaseServerClient()` (`lib/supabase/server.ts:6`) builds an `@supabase/ssr` server client from the request cookies — reads work everywhere; writes are attempted but silently skipped in server components ("the proxy refreshes them", `server.ts:18`). The client carries the caller's RLS, so queries through it can only see what that user can see. Server actions and pages resolve the user with `getCurrentUser()` / `requireUser()` on top of it (`lib/auth.ts:7`).

### 2. Bearer token (phone & desktop clients)

`userFromRequest(request)` (`lib/route-bearer.ts:11`) is the shared API-route resolver:

1. If `authorization: Bearer <token>` is present, it creates a fresh Supabase client (anon key + the token in the auth header, no session persistence) and calls `auth.getUser(token)` — success returns `{ user, client }` where `client` is **RLS-scoped to that user**.
2. Otherwise it falls back to the session cookie client.

Return value is `null` when neither credential is valid; routes answer `401 { error: "unauthorized" }`. Used by `/api/mobile/*` (except `/pair` and `/device`), `/api/messages`, `/api/files/...`, `/api/remote/sessions*`, `/api/account/merge`, and `/api/desktop/register`.

### 3. Host and device tokens (Sayabot for Mac, paired phones)

- `hostFromRequest(request)` (`lib/desktop-hosts.ts:35`) — headers `x-host-id` (UUID) + `x-host-token`; the SHA-256-style digest (`hashAgentApiKey`) is compared against `desktop_hosts.token_hash` character-by-character in constant time, and revoked hosts are refused. Guards every `/api/desktop/*` route except `register`, `refresh` and `guest`.
- Device tokens — `GET /api/mobile/device` compares `x-device-token` against `device_pairings.device_token_hash` the same way (`mobile/device/route.ts:20`).

### 4. Internal secret (server-to-server)

`getInternalSecret()` returns `ORCHESTRATOR_INTERNAL_SECRET` (`lib/env.ts:43`). The web app **sends** it (`x-internal-secret`) when calling the orchestrator and computerd (`lib/orchestrator.ts:13`, the `/api/v1` proxy's computer forwards at `v1/[...path]/route.ts:341`, computer start/stop). No web route validates an incoming internal secret — trust for server-to-server calls is established on the orchestrator side. `getOrchestratorUrl()` and `getComputerdUrl()` default to `http://localhost:4000` and `:4100` with trailing slashes stripped (`lib/env.ts:35`).

### 5. Capability secrets in URLs and headers

Several endpoints authenticate with single-purpose secrets compared in constant time against a stored hash (`hashAgentApiKey` + byte-wise compare):

- Connector inbound webhooks: `?k=<inboundSecret>` on `/api/messaging/...` (`messaging/.../route.ts:35`).
- Bot poll tokens: `authorization: Bearer <poll_token>` on `/bot/[code]/status` (`lib/bot-invites.ts:80`).
- Agent API keys: the `<token>` path segment of `/mcp/<token>` is validated by the orchestrator after the transparent forward.
- WhatsApp verify tokens (`hub.verify_token` = the chat secret).

---

## 🧱 Edge middleware (`src/proxy.ts`)

`src/proxy.ts` exports `proxy(request)` (`proxy.ts:53`) — the Next.js middleware. It first refreshes the Supabase session through `updateSession(request)` (`lib/supabase/proxy.ts:4`, which also hard-fails when Supabase env vars are missing), then applies two rules:

- **Signed-out visitors** to anything not in `PUBLIC_PATHS` are redirected to `/login?next=<path>` with the Supabase cookies carried over (`proxy.ts:62`). `next` values are validated by `safeNextPath` (`lib/safe-next.ts:5` — same-origin relative paths only; protocol-relative `//`, backslash tricks like `/\evil.com`, and control characters all fall back to `/`).
- **Signed-in users** on `/login` or `/signup` are bounced to their safe `next` (or `/`), unless `?force=true`, `?reauth=true`, or `?switch=true` explicitly re-opens the login page (`proxy.ts:68`).

### `PUBLIC_PATHS` (`proxy.ts:5`)

Everything a page-redirect must not intercept — each entry is either self-guarding or public by design:

| Prefix | Why it is open |
| :--- | :--- |
| `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password` | The auth pages themselves. |
| `/terms`, `/privacy`, `/security`, `/help`, `/download`, `/offline` | Public content. |
| `/auth` | Callback/merge/complete pages (token-validated). |
| `/api/v1` | The proxy — every guarded branch checks bearer/session itself; `/api/health` is excluded entirely by the matcher. |
| `/api/connectors` | Session-gated inside (`requireRouteUser`); model lists are member-only. |
| `/api/mobile` | Bearer/session inside; `/pair` is code-authenticated, `/device` uses device tokens. |
| `/api/version`, `/api/instance` | Public server identity and update checks (CORS `*`). |
| `/api/billing/webhook` | Verified by the Stripe signature instead of a session (`proxy.ts:24`). |
| `/api/download` | Public redirects. |
| `/mcp` | The MCP proxy — authenticated by the agent key in the path (`proxy.ts:27`). |
| `/bot` | Bot join links — the code is the credential; humans approve in the Inbox. |
| `/api/desktop`, `/api/remote` | Host-token auth and WebRTC signaling (session or bearer inside). |
| `/api/files` | The route checks room access itself, cookie or bearer (`proxy.ts:34`). |
| `/api/account/merge` | The desktop calls it with its bearer token; the route checks auth. |
| `/.well-known`, `/oauth/register`, `/oauth/token`, `/oauth/callback` | OAuth 2.1 public endpoints (discovery, dynamic client registration, token exchange, vendor callbacks). |

The matcher (`proxy.ts:83`) skips `/api/health` and static assets (`_next/*`, icons, manifest, service worker files), so health probes never touch Supabase.

Note the consequences: `/api/messages`, `/api/push`, `/api/usage/*`, `/api/providers/*`, `/api/workspaces/*`, and `/api/auth/send-email` are **not** public — signed-out requests to them are redirected by middleware (a `GET` would receive the login HTML), which is why they are session-first routes; the bearer-capable endpoints listed above are exempted precisely because native clients cannot use cookies.

---

## 🧰 Route-guard helpers

- `requireRouteUser()` (`lib/route-auth.ts:10`) — session-only guard used by connector/model/provider routes. Returns `{ user }` or `{ response: NextResponse 401 { error: "Sign in required" } }`, so handlers can `return auth.response` directly. Its docstring sets the policy: "Connector routes spend server credentials and proxy third-party auth, so none are anonymous" (`route-auth.ts:6`).
- `userFromRequest()` (`lib/route-bearer.ts:11`) — bearer-or-session resolver returning `{ user, client }` or `null` (see above). The returned `client` always carries the caller's RLS; anything privileged goes through `createAdminClient()` after an explicit authorization check.
- `createAdminClient()` (`lib/supabase/admin.ts:7`) — the cached service-role client (`SUPABASE_SERVICE_ROLE_KEY`). It bypasses RLS, which is why every route/action that uses it re-scopes queries by org id, user id, host id or token hash first — the in-route checks described in each API reference are the actual security boundary.

---

## 🌉 `lib/orchestrator.ts` — the internal proxy client

Server actions and routes reach the engine through `lib/orchestrator.ts` (full endpoint table in the server-actions overview). Both wrappers — `callOrchestrator(path, body, timeoutMs)` (`orchestrator.ts:4`) and `callOrchestratorJson<T>(...)` (`orchestrator.ts:196`) — POST JSON to `getOrchestratorUrl()` + path with `x-internal-secret: getInternalSecret()`, `cache: "no-store"`, and an `AbortSignal.timeout`. Neither throws: transport failures come back as `{ ok: false, status: 0, error }`, so UI flows can degrade (for example, a message is saved even when the engine is unreachable and the UI shows a warning). The `/api/v1` catch-all proxy is the streaming variant of the same trust relationship — it forwards the caller's `authorization` and adds the internal secret only for computer routes (`v1/[...path]/route.ts:341`).

---

## 🔒 What the guards do not do

- **Rate limiting**: there is none in the web app — no limiter middleware, no per-route throttles. Volume is bounded by the plan gates (`planGate`, see the billing reference), by Supabase's own auth and API limits, by computerd's capacity controls, and by explicit caps inside handlers (row limits like the 20,000-row usage scan, size caps like the 15 MB upload and 100,000-char webhook bodies).
- **Origin/CSRF**: server actions are protected by Next.js's built-in action origin checks; API routes rely on credential possession rather than CSRF tokens. Cookie-authenticated mutating routes (e.g. `/api/messages`, `/api/push`) are same-origin by default in browsers, and bearer-authenticated ones ignore cookies when an `authorization` header is present (`route-bearer.ts:13` — the header wins).
- **Timing safety**: every secret comparison — host tokens, device tokens, poll tokens, webhook `k` secrets, PKCE challenges, Stripe signatures — uses length-checked constant-time compares (`desktop-hosts.ts:27`, `bot-invites.ts:80`, `messaging/.../route.ts:35`, `oauth/token/route.ts:10`, `ee/billing/stripe.ts:66`).
- **Secrets in URLs**: `/mcp/<token>` and `/bot/<code>` put credentials in the path; the routes answer with `cache-control: no-store`, `referrer-policy: no-referrer` and `x-robots-tag: noindex` to keep them out of caches and logs where the code controls it.

---

## 🧭 Guard per surface (summary)

| Surface | Credential | Guard helper |
| :--- | :--- | :--- |
| Pages & server actions | Session cookie | `requireUser` / `getOrgAccess` / `adminOrgAccess` (`lib/auth.ts`, `lib/actions/shared.ts`) |
| `/api/mobile/*` | Bearer or session (`/pair`: pairing code; `/device`: device token) | `userFromRequest`, code guards |
| `/api/desktop/*` | Host token (`register`/`refresh`/`guest`: bearer or open) | `hostFromRequest` |
| `/api/v1/tools/:id/approve`, `/api/v1/computers/*` | Bearer or session + room/org role | in-route (`v1/[...path]/route.ts`) |
| `/api/messages`, `/api/files`, `/api/remote/*`, `/api/account/merge` | Bearer or session + resource check (RLS room, `canOpenHost`, guest identity) | `userFromRequest` |
| `/api/connectors/*`, `/api/providers/*` | Session only | `requireRouteUser` (+ org role for admin branches) |
| `/api/usage/local` | No login — machine check | `isOwnMachine` (loopback host or `SAYABOT_LOCAL_USAGE_SCAN` env; reads the server machine's own logs) |
| `/api/workspaces/*` | Session + `getOrgAccess` (RLS) | in-route |
| `/api/messaging/*` | Connector inbound secret (`?k=`) | constant-time compare |
| `/api/billing/webhook` | Stripe signature | `verifyStripeSignature` |
| `/bot/[code]/*` | Invite code + poll token | `pollTokenMatches` |
| `/mcp/[token]` | Agent API key | orchestrator (post-forward) |
| `/oauth/token`, `/oauth/register`, `/.well-known/...` | Public (OAuth 2.1 + PKCE) | client/secret-less flows in-route |
| `/api/instance`, `/api/version`, `/api/health`, `/api/download` | Public | none (public data only) |
| `/api/auth/send-email` | Trusted webhook (Supabase Auth hook) | payload-shape validation |

---

## ⚙️ Environment variables behind the guards

| Variable | Role | Default |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Session and bearer clients; missing values hard-fail the middleware (`lib/supabase/proxy.ts:9`) | required |
| `SUPABASE_SERVICE_ROLE_KEY` | The admin client that bypasses RLS | required |
| `ORCHESTRATOR_INTERNAL_SECRET` | The `x-internal-secret` the web sends to the orchestrator/computerd | required (`getInternalSecret` throws) |
| `ORCHESTRATOR_URL` / `COMPUTERD_URL` | Upstream bases for `lib/orchestrator.ts` and the `/api/v1` proxy | `http://localhost:4000` / `:4100` |
| `DESKTOP_GUEST_MODE` | Guest-mode opt-out (`false`/`0`/`off` disable) | enabled |
| `SAYABOT_LOCAL_USAGE_SCAN` | Force on/off the local-usage machine check | auto (loopback detection) |

## 🚫 Error shapes

Every guard fails closed with a small JSON body — there is no HTML error page on the API surface:

- `userFromRequest` guards → `401 { error: "unauthorized" }`.
- `requireRouteUser` → `401 { error: "Sign in required" }`.
- Org-scoped reads → `404 { error: "workspace not found" }` / `{ error: "Not found" }` (never "not a member" — tenant membership is indistinguishable from a missing resource).
- Desktop host routes → `401 { error: "unauthorized" }`; ownership conflicts → `404 { error: "not found" }`; stale states → `409`.
- The Stripe webhook → `400 { error: "invalid signature" }`; messaging webhooks → plain text `401 "unauthorized"` / `403 "forbidden"` (matching what Meta's verifier expects).

### Redirect, not 403

Because unauthenticated page and API requests are redirected (`302` to `/login?next=…`) rather than answered with `403`, a caller that skips the middleware exemptions — for example POSTing `/api/messages` with no credentials — receives the login HTML, not JSON. Native clients therefore always use the bearer-capable prefixes (`/api/mobile`, `/api/desktop`, `/api/remote`, `/api/files`, `/api/account/merge`, `/api/messages` is reachable by bearer but not exempted), while browser flows rely on the cookie and never see the redirect after sign-in.
---

Related docs: [Auth & authorization](../../architecture/auth-and-authorization.md), [Security model](../../architecture/security-model.md), [Auth flows](../pages/auth-flows.md), [Realtime & events](../../architecture/realtime-and-events.md)
