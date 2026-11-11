# Deployment

> 💡 **Looking for the definitive self-hosting manual?**
> See the **[Complete Self-Hosting Guide](self-hosting.md)** for exhaustive production instructions across Single VPS (`deploy/`), Cloudflare Zero Trust Tunnels, Tailscale meshes, split cloud, homelab setups, and troubleshooting.
>
> **Self-hosting on a VPS?** Use the Docker + nginx stack in [`deploy/`](../deploy/README.md):
> one script hardens the server, one issues TLS, and `deploy/deploy.sh` builds, migrates and
> rolls out with health checks and automatic rollback. The sections below still apply for
> Supabase setup and for split hosting (Vercel + Fly.io).

## Topology

```
browser ── HTTPS ──> web (Next.js)
   │                   │ server actions ── HTTP ──> orchestrator :4000
   │                   └ bot API proxy /api/v1/* ──> orchestrator
   │
   ├── WSS ──> orchestrator /collab (Hocuspocus)
   └── Supabase Realtime (private room:<id> channels + postgres_changes)
                       │
orchestrator ── session pooler DB (pg-boss, advisory locks, LISTEN/NOTIFY)
             └─ E2B, MCP servers, model providers, external bot webhooks
```

The web app is stateless and can run on Vercel. The orchestrator holds long-lived
streams, LISTEN connections and the canvas WebSocket, so it needs a long-running host
(Fly.io, Railway, Render, or a VPS). It is not a serverless workload.

## 1. Supabase

1. Create a project and enable Realtime.
2. Copy the project URL, publishable/anon key, secret/service role key, and the **session
   pooler** connection string on port 5432 into `.env`.
   - Do not use the transaction pooler (6543) for `DATABASE_URL`: pg-boss, advisory locks
     and LISTEN/NOTIFY need session-pinned connections.
3. Run `pnpm db:migrate`. It applies the Drizzle tables, then five idempotent SQL files:
   - functions and auth profile trigger
   - RLS policies, safe views, grants
   - realtime publication entries and private channel authorization
   - the tool approval notification RPC
   - meeting, schedule, task and per-user room-read policies
4. Run `pnpm db:seed` and edit prices in the app.
5. Auth settings:
   - Site URL: `https://<web-host>`
   - Redirect allow list: `https://<web-host>/auth/callback`,
     `https://<web-host>/auth/complete`, `http://localhost:3000/auth/callback`,
     `http://localhost:3000/auth/complete`
   - Configure SMTP and include `{{ .Token }}` in the Confirm signup email template
     alongside the link. The sign-up and code screens read the six-digit token; a
     template with only `{{ .ConfirmationURL }}` cannot complete them.
   - Email links land on `/auth/complete`, which handles both `?code=` and the
     `#access_token` fragment used by invites and admin-generated links. Custom templates
     can instead use `token_hash={{ .TokenHash }}&type=invite` (or `signup`, `recovery`)
     on `/auth/callback`; both forms are verified server-side.
   - Email/password is enabled by default. Optional Google OAuth, then set
     `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true`. Optional GitHub OAuth, then set
     `NEXT_PUBLIC_GITHUB_AUTH_ENABLED=true`.
   - SAML SSO requires Supabase Pro; configure it in Supabase and set
     `NEXT_PUBLIC_SSO_ENABLED=true`.

The RLS migration creates policies on `realtime.messages` for topics named
`room:<uuid>`. Without them private broadcast and presence will be rejected.

## 2. Environment

Generate secrets once and keep them stable:

```bash
openssl rand -base64 32   # MESH_KEK
openssl rand -hex 32      # ORCHESTRATOR_INTERNAL_SECRET
```

Required:

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web, orchestrator | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | browser and SSR |
| `SUPABASE_SERVICE_ROLE_KEY` | web, orchestrator | server only, never expose |
| `DATABASE_URL` | web, orchestrator, db | session pooler |
| `MESH_KEK` | web, orchestrator | encrypts BYOK keys and sealed config |
| `ORCHESTRATOR_INTERNAL_SECRET` | web, orchestrator | internal HTTP auth |
| `ORCHESTRATOR_URL` | web | e.g. `https://mesh-orch.fly.dev` |
| `NEXT_PUBLIC_COLLAB_URL` | web | e.g. `wss://mesh-orch.fly.dev/collab` |
| `NEXT_PUBLIC_SITE_URL` | web | auth redirects and invite links |

Optional: `DEV_OPENAI_COMPAT_*` (fallback model), `E2B_API_KEY`,
`BRAVE_SEARCH_API_KEY`, `MESH_ALLOW_PRIVATE_WEBHOOKS`, `NEXT_PUBLIC_SSO_ENABLED`,
`NEXT_PUBLIC_GITHUB_AUTH_ENABLED`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`.

Because `NEXT_PUBLIC_*` values are inlined at build time, rebuild the web app after
changing them.

## 3. Web on Vercel

- Import the monorepo. Set the root directory to `apps/web` and enable "include files
  outside the root" so `packages/*` resolves. Build command:
  `pnpm --filter @sayabot/web build`. Output: `.next`.
- Add the environment variables above. Do not add `MESH_KEK` to any `NEXT_PUBLIC_*` name.
- The build uses webpack because Serwist injects the service worker; the `build` script
  already passes `--webpack`.
- The bot API proxy lives at `/api/v1/*` and forwards to `ORCHESTRATOR_URL`. External
  bots can use the web host instead of the orchestrator host.

## 4. Orchestrator on Fly.io / Railway / VPS

- Build/run with Node 24 and pnpm. The process runs TypeScript through `tsx`:
  `pnpm --filter @sayabot/orchestrator start` (no compile step).
- Expose port 4000. Health: `GET /health`.
- Expose WebSocket upgrades for `/collab`. On Fly.io, a plain `http_service` with an
  internal port works; ensure the proxy does not buffer or strip the upgrade.
- Set `NEXT_PUBLIC_COLLAB_URL` on the web app to the public `wss://.../collab` URL.
- Keep exactly one canvas process per deployment unless you add the Hocuspocus Redis
  extension. Turn coordination is safe across multiple orchestrator instances (advisory
  lock plus LISTEN/NOTIFY), but canvas documents are not yet shared across processes.
- Mount no persistent disk; all state is in Supabase Postgres.
- Graceful shutdown is handled for SIGINT/SIGTERM: stops pg-boss, flushes canvas stores,
  closes listeners.

Fly.io sketch:

```toml
app = "mesh-orch"
primary_region = "fra"

[build]
  image = "node:24-slim"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false
  min_machines_running = 1

[[vm]]
  memory = "1gb"
  cpu_kind = "shared"
  cpus = 1
```

Set secrets with `fly secrets set MESH_KEK=... DATABASE_URL=...` and the rest.

## 5. External bots

1. Create an external agent, copy the webhook secret shown once.
2. Add the agent to a room.
3. Issue an agent API key on Settings, Bots. It is shown once.
4. Point the bot at `https://<orchestrator-or-web>/v1/...` or register the webhook.
   Any public HTTPS host works; localhost requires `MESH_ALLOW_PRIVATE_WEBHOOKS=true`.
5. Every delivery attempt is logged. Failures retry five times with exponential backoff.
6. Rotate a lost secret from Settings, Bots. Rotation invalidates the old secret immediately.

The reference bot in `examples/python-bot` verifies signatures and streams NDJSON.

## 6. Verification

Automated:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Local database and orchestrator check (no Supabase needed for this part):

- A Postgres 15/16 instance with an `auth` schema stub can run `pnpm db:migrate` to
  validate SQL. RLS can be exercised by setting `request.jwt.claim.sub` and `SET ROLE
  authenticated`.
- The orchestrator starts against that database. The external bot flow can be tested by
  running `examples/python-bot` or a small webhook server.

Live checks with a real Supabase project:

1. Two browser profiles see each other's messages, presence and typing.
2. `@AgentA @AgentB` against the configured model streams one after the other.
3. A canvas edit syncs between tabs and an agent patch does not overwrite a concurrent
   human edit.
4. Debate mode with three agents produces producer, critic, summarizer and stops.
5. Setting the budget to a value below the already-spent amount posts a halt message and
   no new `agent_runs` row is created.
6. The Python bot receives a signed webhook and streams a reply.

Playwright:

- Fill `E2E_USER_A_EMAIL` and `E2E_USER_B_EMAIL` with two accounts in the same project,
  plus `E2E_ORG_SLUG` and `E2E_BASE_URL`.
- The global setup creates the org, two private rooms, two agents (dev fallback model) and
  two pending tool approvals. It deletes prior e2e rooms and agents first.
- The orchestrator must have `DEV_OPENAI_COMPAT_*` set so the seeded agents can answer.
- Sign-in uses admin-generated magic links for the seeded e2e accounts, routed through
  `/auth/complete`. The product UI also supports password, six-digit email code and
  Google. Add both app callback URLs to Supabase's redirect allow list.
- Run `pnpm exec playwright install chromium` once, then `pnpm e2e`.

If a direct `/auth/callback` link arrives with an implicit-flow fragment instead of a `code`,
route it through `/auth/complete`, which handles the fragment. The callback route itself expects
`code` or `token_hash` and the SSR client expects PKCE.

## 7. Meetings and check-ins

The orchestrator scans room schedules once a minute under a Postgres advisory lock. It
starts scheduled meetings whose start time has passed and whose end time is still in the
future, ends meetings past `ends_at`, and starts the morning/evening slots and check-ins
on weekdays. A started meeting posts one host message that mentions `@all_bots`; normal
turn planning, turn caps and breakers apply after that.

- Run a single orchestrator process, or keep the advisory lock and accept that only one
  scanner is active at a time.
- Meeting times are stored in the room's time zone. Changing the time zone changes future
  slots, not existing meeting rows.
- `room_schedules.last_checkin_at` prevents a check-in from firing twice within one
  interval. Ending a meeting cancels its current run but does not reopen it.
- The web scheduler and the web server actions write only through the admin client; the
  `authenticated` role has read access to meetings, schedules, tasks and comments.

## Alerts when no tab is open (optional)

Mesh shows in-app alerts without any setup. To also alert people when the app is closed, for
approvals and agent requests, add VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on the web app and the orchestrator, and `VAPID_PRIVATE_KEY`
and `VAPID_SUBJECT` (a `mailto:` or `https:` address) on the orchestrator. Each person turns
alerts on with "Enable alerts". Push needs HTTPS and the production build, because the service
worker is disabled in development.

## 8. Operations

- **KEK stability:** do not rotate `MESH_KEK` without re-encrypting provider keys, agent
  webhook secrets, MCP headers and org tool configs. Losing it makes those secrets
  unrecoverable.
- **Backups:** Supabase handles Postgres backups. `canvases.ydoc_state` and
  `snapshot_text` live in the same database; restore them together.
- **Realtime limits:** the orchestrator batches deltas every 40 ms and persists partial
  content every second. Clients also recover from the database when realtime is degraded.
- **pg-boss:** creates its own schema. Queue retention is set to one day for room
  messages and seven days for webhook deliveries. Inspect failures in the pg-boss tables
  or the webhook delivery log.
- **Logs:** the orchestrator logs broadcast failures without throwing; monitor them. A
  missing Realtime policy shows up as failed private channel joins in the browser
  console.
- **Pricing:** usage cost is read from `model_pricing`. Unknown models cost $0, so budgets
  only work for rows you have filled in.
- **SSO flag:** the org flag is only a record of intent. Enforcement is Supabase Auth's
  SAML configuration.
