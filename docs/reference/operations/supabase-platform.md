# Supabase Platform Setup (Bundled Self-Hosting)

Sayabot uses Supabase for Postgres, sign-in (GoTrue), realtime (chat, canvas, approvals), and storage. On a fully self-hosted server, `docker-compose.supabase.yml` runs the official Supabase images on the same VPS, and the SQL files in `deploy/supabase/db/` — taken unchanged from Supabase's own self-hosting setup — initialize the bundled Postgres the same way supabase.com's Docker setup does: role passwords, JWT settings, and the schemas the realtime and pooler services expect. nginx stands in for Supabase's API gateway on the same domain.

Source files: `deploy/docker-compose.supabase.yml`, `deploy/supabase/db/_supabase.sql`, `deploy/supabase/db/roles.sql`, `deploy/supabase/db/webhooks.sql`, `deploy/supabase/db/realtime.sql`, `deploy/supabase/db/pooler.sql`, `deploy/supabase/db/logs.sql`, `deploy/supabase/db/jwt.sql`, `deploy/supabase/NOTICE`

---

## 🧩 Services (`deploy/docker-compose.supabase.yml`)

Enabled by `deploy.sh` when `SAYABOT_SUPABASE=bundled` (the default chosen by `deploy/install.sh`). All services join the internal `sayabot` network only; public access is exclusively through the nginx gateway routes (see [nginx-and-cloudflare.md](nginx-and-cloudflare.md)).

| Service             | Image (pinned)                  | Port                              | Healthcheck                                                                |
| :------------------ | :------------------------------ | :-------------------------------- | :------------------------------------------------------------------------- |
| `supabase-db`       | `supabase/postgres:17.6.1.136`  | 5432                              | `pg_isready -U postgres -h localhost` (5s interval, 20 retries)            |
| `supabase-auth`     | `supabase/gotrue:v2.197.0`      | 9999                              | `wget --spider http://localhost:9999/health`                               |
| `supabase-rest`     | `postgrest/postgrest:v14.18`    | 3000 (admin 3001, localhost-only) | `postgrest --ready`                                                        |
| `supabase-realtime` | `supabase/realtime:v2.148.3`    | 4000                              | authenticated HEAD to `/api/tenants/realtime-dev/health` with the anon key |
| `supabase-storage`  | `supabase/storage-api:v1.89.12` | 5000                              | `wget --spider http://127.0.0.1:5000/status`                               |

`supabase-db` persists data in the `supabase-db-data` volume plus a `supabase-db-config` volume for the custom Postgres config; it runs with `log_min_messages=fatal`. `supabase-storage` uses the **file** backend (`STORAGE_BACKEND: file`) writing to the `supabase-storage` volume at `/var/lib/storage`, with `FILE_SIZE_LIMIT: 52428800` (50 MB).

Traffic map (from the compose header comment):

```
nginx ──/auth/v1/     ──▶ supabase-auth     (GoTrue: sign-in, guests, OAuth)
      ──/rest/v1/     ──▶ supabase-rest     (PostgREST)
      ──/realtime/v1/ ──▶ supabase-realtime (live chat, canvas, approvals)
      ──/storage/v1/  ──▶ supabase-storage  (file uploads, on local disk)
web, orchestrator, migrate ──▶ supabase-db (Postgres 17 with pgvector)
```

### Ordering & startup dependencies

The `migrate` job, `web`, and `orchestrator` get extra `depends_on` entries in this overlay: `migrate` waits for `supabase-db`, `supabase-auth`, `supabase-storage`, and `supabase-realtime` to all be **healthy**; `web` waits for `supabase-auth` and `supabase-rest`; `orchestrator` waits for `supabase-db` (docker-compose.supabase.yml:210-232). This encodes the invariant that Sayabot's Drizzle migrations need Supabase's own schemas (`auth`, `storage`, `realtime`) in place first — `deploy.sh` also calls `start_supabase` explicitly before running migrations.

## 📜 SQL Bootstrap Files (`deploy/supabase/db/`)

These are mounted into the Postgres image's init directories. The `migrations/` prefix runs via the official postgres image's migration mechanism and the `init-scripts/` prefix runs after; numbering fixes the order (docker-compose.supabase.yml:28-34):

| Mount point                           | File            | What it does                                                                          |
| :------------------------------------ | :-------------- | :------------------------------------------------------------------------------------ |
| `initdb/migrations/97-_supabase.sql`  | `_supabase.sql` | Creates the `_supabase` maintenance database owned by `$POSTGRES_USER`                |
| `initdb/migrations/99-realtime.sql`   | `realtime.sql`  | Creates the `_realtime` schema in the `postgres` DB, owned by `$POSTGRES_USER`        |
| `initdb/migrations/99-logs.sql`       | `logs.sql`      | Connects to `_supabase` and creates the `_analytics` schema (log pipeline target)     |
| `initdb/migrations/99-pooler.sql`     | `pooler.sql`    | Connects to `_supabase` and creates the `_supavisor` schema (connection pooler state) |
| `initdb/init-scripts/98-webhooks.sql` | `webhooks.sql`  | The largest file — see below                                                          |
| `initdb/init-scripts/99-roles.sql`    | `roles.sql`     | Sets passwords for the five Supabase service roles                                    |
| `initdb/init-scripts/99-jwt.sql`      | `jwt.sql`       | `ALTER DATABASE postgres SET "app.settings.jwt_exp"` to `$JWT_EXP` (3600 s)           |

The files read `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `JWT_EXP` through psql `\set` backtick interpolation from the container environment. `deploy/supabase/NOTICE` records provenance: the SQL comes from the Supabase project's self-hosting setup (`github.com/supabase/supabase/tree/master/docker/volumes/db`), Apache License 2.0, used unchanged.

### `roles.sql` — role passwords

Sets the same `$POSTGRES_PASSWORD` (generated by `install.sh`) on five roles: `authenticator`, `pgbouncer`, `supabase_auth_admin`, `supabase_functions_admin`, and `supabase_storage_admin`. These match the connection strings used by the services — e.g. PostgREST connects as `authenticator` and GoTrue as `supabase_auth_admin` (docker-compose.supabase.yml:72,123).

### `webhooks.sql` — pg_net + database function hooks

Wrapped in a single transaction. Installs the machinery Supabase uses for database webhooks:

1. Creates the `pg_net` extension in `extensions` and the `supabase_functions` schema (owned by `supabase_admin`) with usage/default privileges for `postgres, anon, authenticated, service_role`.
2. Creates `supabase_functions.migrations` (seeded with `initial` and `20210809183423_update_grants`) and `supabase_functions.hooks` (the audit trail for triggered hooks).
3. Defines `supabase_functions.http_request()` — a trigger function that issues `net.http_get`/`net.http_post` with a JSON payload of `{old_record, record, type, table, schema}`, default timeout 1000 ms, recording the `request_id` in `hooks`.
4. Creates the `supabase_functions_admin` role if missing (NOINHERIT CREATEROLE LOGIN NOREPLICATION), owns the schema objects, is granted to `postgres`, and gets `USAGE` on `extensions` (the comment explains: serializing `NEW`/`OLD` can touch `extensions.spatial_ref_sys` for PostGIS geometry reads — webhooks.sql:125-128).
5. Drops the unused `supabase_pg_net_admin` role if present, hardens `net.http_get`/`net.http_post` (`SECURITY DEFINER`, pinned `search_path`, revoked from `PUBLIC`, granted to the four roles), and installs an `issue_pg_net_access` event trigger on `CREATE EXTENSION` so the grants reapply if `pg_net` is (re)enabled later.

### `realtime.sql`, `pooler.sql`, `logs.sql`, `_supabase.sql`

Small schema bootstraps: `realtime.sql` creates `_realtime` in `postgres` (where the realtime service stores tenant/channel state; its container sets `DB_AFTER_CONNECT_QUERY: "SET search_path TO _realtime"`); `pooler.sql` creates `_supavisor` inside the `_supabase` database for the pooler service's metadata; `logs.sql` creates `_analytics` there for the log pipeline; `_supabase.sql` creates the `_supabase` database itself.

### `jwt.sql` — JWT expiry

`ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp'` — read from the `JWT_EXP: 3600` compose env, matching `GOTRUE_JWT_EXP: 3600` and `PGRST_APP_SETTINGS_JWT_EXP: 3600`.

## 🔑 Secrets & Keys

`deploy/install.sh` generates all of these in bundled mode and refuses to overwrite existing values on re-run:

| Secret                          | Used by                                                                                                                                                                                    |
| :------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`             | DB superuser + the five service roles (`roles.sql`)                                                                                                                                        |
| `JWT_SECRET`                    | HS256 signing shared by GoTrue (`GOTRUE_JWT_SECRET`), PostgREST (`PGRST_JWT_SECRET`), realtime (`API_JWT_SECRET`, `METRICS_JWT_SECRET`), and storage (`AUTH_JWT_SECRET`)                   |
| `ANON_KEY` / `SERVICE_ROLE_KEY` | 10-year HS256 JWTs for the `anon` and `service_role` roles minted by `install.sh`'s `supabase_jwt()` helper (install.sh:75-82); realtime and storage need the anon key/service key at boot |
| `SECRET_KEY_BASE`               | realtime (Elixir) secret                                                                                                                                                                   |
| `REALTIME_DB_ENC_KEY`           | realtime's encryption key for DB-stored tenant secrets                                                                                                                                     |

Because every service signs and verifies with the same `JWT_SECRET`, tokens issued by GoTrue are accepted by PostgREST, realtime, and storage without any JWKS distribution. On hosted Supabase these are the project's API keys instead, and none of this SQL runs — the files only matter for the bundled mode.

## 🔐 GoTrue (Sign-In) Configuration

Notable `GOTRUE_*` settings on `supabase-auth` (docker-compose.supabase.yml:67-107):

- `API_EXTERNAL_URL` / `GOTRUE_SITE_URL` / `GOTRUE_JWT_ISSUER` are all derived from `https://${SAYABOT_DOMAIN}`.
- `GOTRUE_URI_ALLOW_LIST: https://${SAYABOT_DOMAIN}/**,sayabot://**` — web callbacks plus the Mac/phone apps' deep links.
- `GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED` (default true) backs the Mac app's "no account needed" guest start; on hosted Supabase the equivalent toggle is "Allow anonymous sign-ins".
- `GOTRUE_MAILER_AUTOCONFIRM` (default true) — without an SMTP server, accounts are confirmed immediately; SMTP vars configure real email when provided.
- Google/GitHub OAuth are disabled unless client id/secret are supplied; the redirect URI is `https://${SAYABOT_DOMAIN}/auth/v1/callback`.
- `SUPABASE_DISABLE_SIGNUP` can close registration.

## 🧮 PostgREST (PGRest) Configuration

`supabase-rest` exposes `PGRST_DB_SCHEMAS: public,storage,graphql_public` with `PGRST_DB_ANON_ROLE: anon`, `PGRST_DB_MAX_ROWS: 1000`, `PGRST_DB_USE_LEGACY_GUCS: false`, and a localhost-only admin server on 3001. It connects as the `authenticator` role, which switches to `anon`/`authenticated`/`service_role` based on the JWT — the standard Supabase role model, driven by the `roles.sql` password and the shared `JWT_SECRET`.

## 📡 Realtime Publication & Tenant

Realtime runs with `SEED_SELF_HOST: "true"`, which creates the single `realtime-dev` tenant; nginx sends that tenant's `Host` header (`realtime-dev.supabase-realtime`) on every `/realtime/v1/` request (supabase-locations.conf:37,52). Other settings: `DB_ENC_KEY` for tenant secrets, `RUN_JANITOR`, `RLIMIT_NOFILE 10000`, and `ERL_AFLAGS -proto_dist inet_tcp`.

Sayabot's own realtime payloads (messages, canvas, approvals) are published by the orchestrator through the REST broadcast endpoint (`/realtime/v1/api/` route). Which tables/channels feed live updates, and how RLS governs them, is defined by Sayabot's migrations in `packages/db/sql/` — the files here only create the `_realtime` schema the service needs to exist.

## 🔌 Connection Pooler

The bundled stack ships no separate Supavisor container; `pooler.sql` merely prepares the `_supavisor` schema inside the `_supabase` database. What matters operationally: `DATABASE_URL` for the orchestrator/migrate must be the **session** path — `deploy.sh` preflight rejects port `6543` with "Use the session pooler (5432)" (deploy.sh:106), and on hosted Supabase `install.sh` asks for the Session pooler string for the same reason. Direct bundled connections use `postgresql://postgres:${POSTGRES_PASSWORD}@supabase-db:5432/postgres` (no pooler at all).

## 📊 Log Pipelines

`logs.sql` creates the `_analytics` schema in `_supabase`, which the (not bundled here) log-worker services use as their storage. The bundled stack keeps logging simple: all Supabase containers use json-file logging (10 MB x 3) like the rest of the stack, and the `_analytics` schema exists so the database layout matches upstream Supabase.

## 🧬 Interaction with `packages/db` Migrations

- Bundled mode: the `migrate` one-off runs only after all five Supabase services are healthy, guaranteeing `auth`, `storage`, `_realtime`, and `extensions` exist before Drizzle migrations and `packages/db/sql/*.sql` scripts run (`packages/db/src/migrate.ts` applies the Drizzle folder first, then every sorted `.sql` file in `packages/db/sql/`).
- Hosted mode: Supabase provides the schemas on supabase.com; the same migration job runs against the project's session-pooler URL.
- Sayabot's SQL migrations never touch the Supabase-owned schemas' passwords or JWT settings — that is exclusively this bootstrap's job, which is why it runs at Postgres init time rather than as part of the app migration stream.

---

## Related docs

- [deployment.md](deployment.md) — how deploy.sh sequences Supabase startup, migrations, and rollout
- [nginx-and-cloudflare.md](nginx-and-cloudflare.md) — the gateway routes in front of these services
- [troubleshooting.md](troubleshooting.md) — pooler limits, JWT/realtime auth failures
- [../../self-hosting.md](../../self-hosting.md) — self-hosting overview
- [../database/](../database/) — Drizzle schemas and migration engine reference
