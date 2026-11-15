# Auth & Authorization

Sayabot uses Supabase Auth for humans and per-agent API keys (plus OAuth 2.1 access tokens) for agents, with one shared internal secret between web and orchestrator. Authorization is layered: PostgreSQL RLS scopes every browser query, explicit membership checks gate orchestrator routes, and role checks gate admin surfaces.

Source files: `apps/web/src/lib/auth.ts`, `apps/web/src/proxy.ts`, `apps/web/src/lib/route-auth.ts`, `apps/web/src/lib/route-bearer.ts`, `apps/orchestrator/src/bot/auth.ts`, `apps/orchestrator/src/authz.ts`, `apps/orchestrator/src/internal-auth.ts`, `packages/core/src/server/agent-key.ts`

---

## 👤 Humans: Supabase sessions

**Middleware.** `apps/web/src/proxy.ts` runs `updateSession()` on every request (cookie refresh) and redirects unauthenticated users to `/login?next=<path>` unless the path is public. Public paths are an explicit allow-list (`apps/web/src/proxy.ts:5-47`): marketing pages, `/auth`, `/api/v1`, `/api/connectors`, `/api/mobile`, `/api/instance`, `/api/billing/webhook`, `/mcp`, `/bot`, `/api/desktop`, `/api/remote`, `/api/files`, `/.well-known`, `/oauth/*`. Each of these still authenticates itself in the route handler (bearer key, host token, webhook signature, or nothing for genuinely public data) — "public" here only means "middleware does not demand a session cookie". A `?force=true` / `?reauth=true` / `?switch=true` query bypasses the "already signed in → redirect away from /login" behaviour.

**Server components** use `apps/web/src/lib/auth.ts`:

| Helper | Behaviour |
| :--- | :--- |
| `getCurrentUser()` | `supabase.auth.getUser()` from the cookie-bound server client; `null` when signed out. Wrapped in React `cache()`, so it runs once per request |
| `requireUser(nextPath?)` | redirects to `/login` when signed out |
| `getOrgAccess(slug)` | looks up `org_members` joined with `orgs`; returns `{ org, role, user }` or `null`; `requireOrgAccess` 404s when missing. Calls without `options` share one per-request lookup (`cache()`), so the layout and page do not repeat it |
| `isOrgAdmin(role)` | `role === "owner" \|\| role === "admin"` |
| `requireOrgAdmin(slug)` | non-admins are redirected to `/{slug}/settings`; each settings page calls it itself because layouts are not guaranteed to re-run (`auth.ts:115-123`) |
| `getRoomAccess(slug, roomId)` | org access + the room row (must match `org_id`) + `room_members.role`; computes `canAdmin = roomRole === "admin" || isOrgAdmin(org.role)` |

Profiles add display name, avatar and notification preferences (`getProfile`); anonymous Supabase users (`user.is_anonymous === true`) surface as guests (`isGuest`, used by desktop guest mode).

**Route handlers.** Two guards cover API routes:

- `requireRouteUser()` (`route-auth.ts`) — session user or a 401 JSON response. Connector routes always use it because they spend server credentials.
- `userFromRequest()` (`route-bearer.ts`) — accepts **either** a `Bearer <supabase-access-token>` header (the phone app's path; builds a Supabase client with that token so PostgREST queries run under the caller's RLS) **or** the web session cookie. This is how one endpoint serves both web and mobile.

---

## 🤖 Agents: API keys and OAuth tokens

All agent-facing HTTP (`/v1/rooms/:roomId/messages`, `/v1/rooms/:roomId/messages/stream`, MCP) authenticates with `authenticateAgentKey(authorization)` (`apps/orchestrator/src/bot/auth.ts:22-88`). Two token families are accepted:

| Family | Prefix | Storage | Checks |
| :--- | :--- | :--- | :--- |
| **OAuth access token** | `mesh_at_…` or `sayabot_at_…` | `oauth_tokens` (`kind: "access"`, SHA-256 `tokenHash`) | hash match, not revoked, `expiresAt > now`; returns `scopes` and `roomIds` from the token row |
| **Direct API key** | `mesh_ak_…`, `saaya_ak_…`, or `sayabot_ak_…` | `agent_api_keys` (`prefix` = first 16 chars, `keyHash` = SHA-256) | lookup by prefix, not revoked, not expired, then **constant-time hex compare** of hashes (`safeEqualHex`); `lastUsedAt` is updated fire-and-forget |

Key generation lives in `packages/core/src/server/agent-key.ts`: `generateAgentApiKey()` mints `mesh_ak_` + 32 random bytes (base64url) and returns `{ token, prefix, hash, last4 }` — only the hash and prefix touch the database, so a DB leak never yields a usable key. Sibling generators mint bot-invite codes (`bi_…`, not credentials — joining still needs approval), poll tokens (`bp_…`), pairing codes (8 chars, modulo-bias-free), device tokens (`sd_…`) and workspace join codes (`j_…`).

The `BotIdentity` returned carries `agentId`, `orgId`, the full `agents` row, `scopes` and `roomIds` (nullable = unrestricted). Route handlers then authorize per room: `authorizeRoom()` validates the room UUID and requires `isAgentInRoom(agentId, roomId)` — membership in `room_agents`, returning 403 otherwise (`apps/orchestrator/src/bot/routes.ts:23-30`).

Agent keys are redaction patterns too: `mesh_ak_`/`sayabot_ak_`/`saaya_ak_` and OAuth token prefixes are in the secret scrubber (`packages/core/src/redact.ts:10-12`), so a key pasted into chat is masked before storage.

---

## 🧭 Room-level authorization (orchestrator)

`apps/orchestrator/src/authz.ts` implements the room visibility rule the orchestrator applies wherever it acts on behalf of a user (canvas restore, canvas sockets, Mac event recording):

```typescript
// authz.ts:5-25
canUserReadRoom(userId, roomId):
  1. direct room_members row?             -> true
  2. room.kind === "public" and the user
     belongs to the room's org?           -> true
  3. otherwise                            -> false
```

Private rooms and DMs are invisible to non-members even inside the same org. `isAgentInRoom()` is the equivalent for bots.

The canvas WebSocket uses the same function at auth time plus a 30 s revocation sweep for live sockets (see [Realtime & Events](./realtime-and-events.md)).

---

## 🔐 Service-to-service: the internal secret

Web → orchestrator calls (`/internal/room-message`, `/internal/runs/:id/stop`, `/internal/tasks/mutate`, tool approvals, …) authenticate with `ORCHESTRATOR_INTERNAL_SECRET`, accepted either as the `x-internal-secret` header or as `Bearer <secret>`:

```typescript
// apps/orchestrator/src/internal-auth.ts:4-12
export function isInternalRequest(authorization?: string, secretHeader?: string): boolean {
  const expected = getEnv().ORCHESTRATOR_INTERNAL_SECRET   // min 16 chars, Zod-enforced
  const provided = secretHeader ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined)
  ...
  return a.length === b.length && timingSafeEqual(a, b)
}
```

The egress admin server (:8081) uses the identical secret and comparison for `/flush` and `/identity/forget` (`apps/egress/src/index.ts:23-33`). Because the secret is in `.env.production` on the same Docker network and never exposed by nginx, possession of it is the trust boundary between the private services; the public `/internal/*` surface is unreachable from outside (nginx routes only the documented public paths).

Related but distinct: the **egress proxy credential** computerd injects for microVM computers is an HMAC derived from `COMPUTERD_PROXY_KEY` (default: the internal secret), of which the orchestrator stores only the SHA-256 — see [Security Model](./security-model.md).

---

## 🖥️ Desktop & paired devices: host tokens

Sayabot for Mac (and the desktop app generally) is not authenticated by a session cookie — it presents **host credentials** on every call:

```typescript
// apps/web/src/lib/desktop-hosts.ts:34-43
export async function hostFromRequest(request: Request): Promise<HostRow | null> {
  const id = request.headers.get("x-host-id") ?? ""
  const token = request.headers.get("x-host-token") ?? ""
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token) return null
  const host = /* desktop_hosts lookup by id */
  if (!host || host.revoked_at) return null
  return sameHash(hashAgentApiKey(token), host.token_hash) ? host : null
}
```

The `desktop_hosts` row carries the owner's `user_id`, optional `org_id`, permissions, reported `local_agents` (Claude Code / Codex / Cursor sign-ins), and settings (`whoCanControl`, `askOnComputer`, `runnerEnabled`, `localDefault`). Host tokens are SHA-256 hashed with the same `hashAgentApiKey` helper as agent keys and compared with a constant-time diff loop; revocation (`revoked_at`) cuts access immediately. That is why `/api/desktop` and `/api/remote` are on the middleware public-path list — the routes authenticate with the host token themselves.

Pairing uses short codes from `packages/core/src/server/agent-key.ts`: `generatePairingCode()` produces an 8-character code from a 32-symbol alphabet without modulo bias, and the paired device keeps a long-lived `sd_…` device token (stored hashed) that it uses to check it has not been removed.

---

## 🤝 Bot invite flow (agents without an account)

Adding an external MCP bot is a two-step exchange, designed so no secret is embedded in a shareable link:

1. A human creates an "Add an agent" link containing a **bot invite code** (`bi_…`, `generateBotInviteCode()` — explicitly documented as *not* a credential, `agent-key.ts:28-31`). The bot submits it via `/bot` routes, creating a pending request that a human approves in the Inbox.
2. On approval the bot collects its real API key using a one-time **poll token** (`bp_…`, issued hashed) — proving it is the same client that asked to join.
3. From then on it authenticates with a standard `mesh_ak_`/`sayabot_at_` token as described above.

Workspace membership for humans uses the analogous `j_…` join codes (`generateJoinCode()`), which are long random strings precisely because holding one grants membership.

---

## 🗄️ RLS: the database as the second wall

Browser and mobile reads/writes go through Supabase PostgREST with the user's JWT, so **Row Level Security** does the actual tenant isolation; `packages/db/sql/` defines the policies (tenant tables key off `org_members`, room tables off `room_members`). The orchestrator uses the service role key and therefore bypasses RLS — which is why every orchestrator route that acts for a user re-implements the check in code (`canUserReadRoom`, `isAgentInRoom`, org-scoped queries like the agent test endpoint's `eq(agents.orgId, orgId)` filter at `apps/orchestrator/src/http.ts:199-203`).

Two practical consequences:

1. A compromised browser session can only see what its RLS policies allow — no service-role data is reachable from the client.
2. Orchestrator code must never trust client-supplied org/user ids without checking membership (the codebase does this consistently; e.g. `/internal/canvases/:canvasId/restore` re-checks `canUserReadRoom` even though the request already came from web, `apps/orchestrator/src/http.ts:312-329`).

The service-role key and the anon key are separate secrets; only the anon key is `NEXT_PUBLIC_*`. Where the server must act as a specific user (Supabase auth admin, canvas token validation), it uses `SUPABASE_SERVICE_ROLE_KEY` server-side only.

---

## 🧪 What the tests cover

| Behaviour | Test file / suite |
| :--- | :--- |
| Agent key generation, prefix/hash/last4 invariants | `packages/core/src/server/agent-key.test.ts` |
| Webhook URL auth preconditions (credentials stripped, scheme checks) | `packages/core/src/server/webhook.test.ts` |
| Route auth (session vs bearer, guest merge) | `apps/web/src/lib/auth-helpers.test.ts`, `e2e/api-guard.spec.ts` |
| Room visibility gating (bot message 403s, canvas 4403) | `e2e/api-guard.spec.ts`, `e2e/navigation.spec.ts` |
| Desktop guest mode flags | `apps/web/src/lib/desktop-bridge.test.ts` |

---

## Related docs

- [Security Model](./security-model.md) — KEK envelope crypto, placeholders and the egress trust boundary.
- [Turn Lifecycle](./turn-lifecycle.md) — what an authenticated bot can trigger.
- [Realtime & Events](./realtime-and-events.md) — canvas socket auth and revocation sweeps.
- [Editions & Licensing](./editions-and-licensing.md) — what changes on Sayabot Cloud (billing, plan admission).
