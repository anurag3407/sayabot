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
   - Sizing: Allocate at least 15 connections per web container and 15 per orchestrator
     process (`DATABASE_POOL_MAX=15`). Ensure `(web_instances + orch_instances) * 15 < max_connections - 5`.
3. Run `pnpm db:migrate`. It applies the Drizzle ORM base schema (`packages/db/migrations/`),
   followed by idempotent SQL migrations (`packages/db/sql/`) applied in numerical order:
   - `0001_functions.sql`: Core `set_updated_at()` trigger across all primary tables, plus `handle_new_user()` auth profile synchronization.
   - `0002_rls.sql`: Multi-tenant Row Level Security (RLS) policies across rooms, orgs, agents, messages, tool calls; security definers `is_org_member()` and `is_room_member()`.
   - `0003_realtime.sql`: Registers tables in `supabase_realtime` publication and authorizes private `room:<uuid>` channel subscriptions.
   - `0004_rpc.sql`: Security definer RPC `notify_tool_resolution` broadcasting `pg_notify('tool_call_resolved', ...)` for asynchronous agent tool approval.
   - `0005_ia.sql`: Information architecture layer (`meetings`, `room_schedules`, `tasks`, `task_comments`, `room_reads`) with update triggers and RLS.
   - `0006_push.sql`: Web Push VAPID subscriptions schema (`push_subscriptions`) with strict per-user RLS (`user_id = auth.uid()`).
   - `0007_agent_reads.sql`: High-frequency agent read cursors table (`agent_reads`), accessible exclusively to backend `service_role`.
   - `0008_task_integrity.sql`: Board of Record task integrity (`due_at`, `unblock_needs`, fold keys, `task_events` audit table with realtime CDC).
   - `0009_bot_platform.sql`: External bot platform schemas (`agent_templates`, `org_quotas` rate tiers, `agent_computers` sandbox records, `webhook_deliveries`).
   - `0010_engine.sql`: Sayabot Engine v2 durable state (`waiting` status, run heartbeats, step counters, `usage_events` cached token tracking).
   - `0011_memory.sql`: Multi-tier cognitive memory architecture (`memories` table with pgvector `vector(1536)` embeddings and scoped retrieval).
   - `0012_permissions_fix.sql`: Permission alignment granting explicit table privileges on v2 tables to `authenticated` and `service_role`.
   - `0013_auth_oauth_profiles.sql`: Production OAuth profile metadata synchronization for Google, GitHub, and corporate SAML logins.
   - `0014_routines.sql`: Hermes-class autonomous agent cron routines (`routines`, `routine_runs`, visual workflow `routine_nodes`).
   - `0018_workspace_connectors.sql`: Two-tier workspace integrations architecture:
     - `workspace_connectors`: AES-256-GCM encrypted credentials vault (`ciphertext`, `iv`, `tag`, `last4`) for Slack, Google Drive, GitHub, Jira.
     - `workspace_connectors_public`: Safe read-only view exposing non-sensitive metadata (name, source, status, last4) to workspace members.
     - `agent_connector_grants`: Fine-grained agent scoping table enforcing least-privilege resource access (`allowedFolders`, `allowedChannels`, `allowedRepos`, `readOnly`).
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
openssl rand -base64 32   # SAYABOT_KEK (alias MESH_KEK)
openssl rand -hex 32      # ORCHESTRATOR_INTERNAL_SECRET
```

Core Platform Variables:

| Variable                        | Used by               | Notes                                                                                                                             |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | web, orchestrator     | Supabase project URL                                                                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web                   | browser and SSR client                                                                                                            |
| `SUPABASE_SERVICE_ROLE_KEY`     | web, orchestrator     | server only, never expose to client                                                                                               |
| `DATABASE_URL`                  | web, orchestrator, db | PostgreSQL connection string (**Port 5432 Session Pooler**)                                                                       |
| `DATABASE_POOL_MAX`             | web, orchestrator     | optional, connection pool limit per process (default: `15`–`30`)                                                                  |
| `SAYABOT_KEK`                   | web, orchestrator     | 32-byte Base64 key for AES-256-GCM envelope encryption (`workspace_connectors`, `vaults`, bot credentials). Legacy alias: `MESH_KEK`. |
| `SAYABOT_DOMAIN`                | deploy, nginx         | Public hostname for self-hosted deployments (e.g. `sayabot.example.com`). Legacy alias: `MESH_DOMAIN`.                             |
| `ORCHESTRATOR_INTERNAL_SECRET`  | web, orchestrator     | 32-byte Hex secret authenticating internal `/internal/*` routes                                                                   |
| `ORCHESTRATOR_URL`              | web                   | e.g. `https://sayabot-orch.fly.dev` or `http://orchestrator:4000`                                                                 |
| `NEXT_PUBLIC_COLLAB_URL`        | web                   | e.g. `wss://sayabot-orch.fly.dev/collab`                                                                                          |
| `NEXT_PUBLIC_SITE_URL`          | web                   | public app URL for auth callbacks and invite links                                                                                |

Workspace Connector Variables:

| Variable                     | Used by           | Notes                                                                                                                                |
| ---------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `SLACK_CLIENT_ID`            | web, orchestrator | Slack App OAuth Client ID for workspace Slack integration                                                                            |
| `SLACK_CLIENT_SECRET`        | web, orchestrator | Slack App OAuth Client Secret for token exchange                                                                                     |
| `SLACK_SIGNING_SECRET`       | web, orchestrator | HMAC-SHA256 secret for validating inbound Slack Events API webhooks                                                                  |
| `GITHUB_APP_ID`              | web, orchestrator | Numerical GitHub App ID for workspace GitHub connector installation                                                                  |
| `GITHUB_APP_PRIVATE_KEY`     | web, orchestrator | PEM-formatted RSA private key used to sign JWTs for installation access tokens                                                       |
| `GITHUB_APP_CLIENT_ID`       | web, orchestrator | GitHub App OAuth Client ID for user authorization flows                                                                              |
| `GITHUB_APP_CLIENT_SECRET`   | web, orchestrator | GitHub App OAuth Client Secret                                                                                                       |
| `GITHUB_APP_WEBHOOK_SECRET`  | web, orchestrator | Secret for HMAC-SHA256 signature verification of incoming GitHub webhooks                                                            |
| `GOOGLE_CLIENT_ID`           | web, orchestrator | Google Cloud OAuth 2.0 Client ID for Google Workspace / Drive connector                                                              |
| `GOOGLE_CLIENT_SECRET`       | web, orchestrator | Google Cloud OAuth 2.0 Client Secret                                                                                                 |
| `GOOGLE_CLIENT_REDIRECT_URI` | web               | Optional explicit OAuth redirect URI (defaults to `https://${NEXT_PUBLIC_SITE_URL}/api/connectors/google/oauth` or `/auth/callback`) |

Optional: `DEV_OPENAI_COMPAT_*` (fallback model), `E2B_API_KEY`,
`BRAVE_SEARCH_API_KEY`, `SAYABOT_ALLOW_PRIVATE_WEBHOOKS` (alias `MESH_ALLOW_PRIVATE_WEBHOOKS`),
`NEXT_PUBLIC_SSO_ENABLED`, `NEXT_PUBLIC_GITHUB_AUTH_ENABLED`, `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`.

Because `NEXT_PUBLIC_*` values are inlined at build time, rebuild the web app after
changing them.

## 3. Web on Vercel

- Import the monorepo. Set the root directory to `apps/web` and enable "include files
  outside the root" so `packages/*` resolves. Build command:
  `pnpm --filter @sayabot/web build`. Output: `.next`.
- Add the environment variables above. Do not add `SAYABOT_KEK` (or `MESH_KEK`) to any `NEXT_PUBLIC_*` name.
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
app = "sayabot-orch"
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

Set secrets with `fly secrets set SAYABOT_KEK=... DATABASE_URL=...` and the rest.

## 5. Reverse Proxy & Networking for Connectors

Workspace connectors (Slack, Google Drive, GitHub) require dedicated ingress handling for real-time webhooks and OAuth handshakes.

### Inbound Webhook Endpoints

| Endpoint                           | Source              | Verification                                                                                | Routing Requirements                                                                                                                                |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/v1/connectors/slack/events`  | Slack Events API    | HMAC-SHA256 (`X-Slack-Signature`, `X-Slack-Request-Timestamp`) using `SLACK_SIGNING_SECRET` | Disable request buffering (`proxy_request_buffering off;`). Return `200 OK` challenge response within 3s. Asynchronously queue events into pg-boss. |
| `/api/v1/connectors/github/events` | GitHub App Webhooks | HMAC-SHA256 (`X-Hub-Signature-256`) using `GITHUB_APP_WEBHOOK_SECRET`                       | Disable request buffering. Forward raw unmodified payload bytes.                                                                                    |

### OAuth Callback Routing & State Preservation

- Provider callbacks land on `/auth/callback`, `/auth/complete`, or `/api/connectors/[provider]/oauth`.
- Reverse proxies must:
  - Preserve query strings (`?code=...&state=...`) without sanitization or truncation.
  - Forward `#access_token` fragments to `/auth/complete`.
  - Pass `X-Forwarded-Proto https`, `Host $host`, and `Cookie` headers intact so PKCE verification succeeds and redirect URIs match.

#### Nginx Configuration Snippet

Production deployments define upstreams in `deploy/nginx/templates/sayabot.conf.template` and include modular route locations from `deploy/nginx/snippets/sayabot-locations.conf`:

```nginx
# Upstream definitions (deploy/nginx/templates/sayabot.conf.template)
upstream sayabot_web {
    zone sayabot_web 64k;
    server web:3000;
    keepalive 32;
}

upstream sayabot_orchestrator {
    zone sayabot_orchestrator 64k;
    server orchestrator:4000;
    keepalive 8;
}

# Included route rules (deploy/nginx/snippets/sayabot-locations.conf)

# Canvas sync (Hocuspocus WebSocket) straight to orchestrator
location = /collab {
    include /etc/nginx/snippets/proxy.conf;
    proxy_pass http://sayabot_orchestrator;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
    proxy_buffering off;
}

# Webhooks: raw unbuffered ingress for HMAC validation
location ~ ^/api/v1/connectors/(slack|github)/events$ {
    proxy_pass http://sayabot_web;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Slack-Signature $http_x_slack_signature;
    proxy_set_header X-Slack-Request-Timestamp $http_x_slack_request_timestamp;
    proxy_set_header X-Hub-Signature-256 $http_x_hub_signature_256;
}

# OAuth handshakes: preserve query string and PKCE cookies
location ~ ^/(auth|api/connectors)(/|$) {
    proxy_pass http://sayabot_web;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
}

# Pages, server actions, RSC payloads with rate limiting
location / {
    limit_req zone=sayabot_general burst=100 nodelay;
    include /etc/nginx/snippets/proxy.conf;
    proxy_pass http://sayabot_web;
    proxy_buffering off;
    proxy_read_timeout 120s;
}
```

#### Caddy Configuration Snippet

```caddy
# Webhooks
@webhooks path /api/v1/connectors/*
handle @webhooks {
    reverse_proxy web:3000 {
        flush_interval -1
        header_up Host {host}
        header_up X-Forwarded-Proto https
    }
}

# OAuth Handshakes
@oauth path /auth/* /api/connectors/*
handle @oauth {
    reverse_proxy web:3000 {
        header_up Host {host}
        header_up X-Forwarded-Proto https
    }
}
```

## 6. External bots

1. Create an external agent, copy the webhook secret shown once.
2. Add the agent to a room.
3. Issue an agent API key on Settings, Bots. It is shown once.
4. Point the bot at `https://<orchestrator-or-web>/v1/...` or register the webhook.
   Any public HTTPS host works; localhost requires `SAYABOT_ALLOW_PRIVATE_WEBHOOKS=true` (or legacy `MESH_ALLOW_PRIVATE_WEBHOOKS=true`).
5. Every delivery attempt is logged. Failures retry five times with exponential backoff.
6. Rotate a lost secret from Settings, Bots. Rotation invalidates the old secret immediately.

The reference bot in `examples/python-bot` verifies signatures and streams NDJSON.

## 7. Verification

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

## 8. Meetings and check-ins

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

## 9. Alerts when no tab is open (optional)

Sayabot shows in-app alerts without any setup. To also alert people when the app is closed, for
approvals and agent requests, add VAPID keys:

```bash
npx web-push generate-vapid-keys
```

Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY` on the web app and the orchestrator, and `VAPID_PRIVATE_KEY`
and `VAPID_SUBJECT` (a `mailto:` or `https:` address) on the orchestrator. Each person turns
alerts on with "Enable alerts". Push needs HTTPS and the production build, because the service
worker is disabled in development.

## 10. Operations & Troubleshooting

- **KEK stability & Connector Decryption:** do not rotate `SAYABOT_KEK` (or legacy `MESH_KEK`) without
  re-encrypting provider keys, workspace connector credentials (`workspace_connectors`),
  agent webhook secrets, and MCP headers. If `SAYABOT_KEK` is altered or lost, AES-256-GCM
  decryption throws `Unsupported state or unable to authenticate data`, causing connector tools
  to fail. To recover, restore the original KEK or delete and re-link the integration in
  **Workspace Settings → Connectors**.
- **Connector Rate Limiting (HTTP 429 Backoff):** built-in `fetchWithRetry` in
  `apps/orchestrator/src/connectors/rate-limiter.ts` automatically intercepts HTTP 429 and 5xx
  transient errors, parsing `Retry-After` headers and applying exponential backoff with 0–250ms
  jitter. To prevent repeated rate exhaustion across external APIs (Slack Tier 3, GitHub 5k/hr),
  restrict agent scope via `agent_connector_grants` (`allowedFolders`, `allowedChannels`, `allowedRepos`).
- **Connector Invalid OAuth Scope:** if an agent fails with `missing_scope` or `403 Forbidden`,
  the OAuth token was granted with insufficient permissions. Re-authenticate the connector with
  all required scopes (Slack: `channels:history`, `chat:write`; Google Drive: `drive.readonly`;
  GitHub: `Contents: read`, `Issues: read`).
- **Connector Webhook Signatures:** incoming webhooks on `/api/v1/connectors/slack/events` and
  `/api/v1/connectors/github/events` require valid HMAC signatures (`X-Slack-Signature`,
  `X-Hub-Signature-256`). Ensure reverse proxies pass raw unbuffered payloads (`proxy_request_buffering off;`)
  and host clocks are NTP-synchronized.
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
