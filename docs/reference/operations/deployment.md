# Deployment (Docker Images, Compose Stack, Zero-Downtime Rollouts)

Sayabot ships as a five-service Docker Compose stack (`web`, `orchestrator`, `computerd`, `egress`, `nginx` plus `certbot`) fronted by nginx, deployed by a single health-gated script, `deploy/deploy.sh`. Every deploy builds images tagged with the git short SHA, runs forward-only migrations, rolls containers out, and automatically restores the previous release if health checks fail. Only nginx publishes ports; everything else talks over the internal `sayabot` bridge network.

Source files: `deploy/docker/*.Dockerfile`, `deploy/docker-compose.yml`, `deploy/docker-compose.tunnel.yml`, `deploy/docker-compose.smolvm.yml`, `deploy/docker-compose.supabase.yml`, `deploy/deploy.sh`, `deploy/install.sh`

---

## 🐳 Container Images (`deploy/docker/`)

All four app images share the same recipe shape: `node:24.21.0-bookworm-slim` base, pnpm `10.33.0` activated via corepack, BuildKit cache mounts on `/pnpm/store`, and a `GIT_COMMIT_SHA` build arg baked into an OCI label (`org.opencontainers.image.revision`).

| Image | Dockerfile | Port | Healthcheck endpoint | Runtime command |
| :--- | :--- | :--- | :--- | :--- |
| `web` | `deploy/docker/web.Dockerfile` | 3000 | `GET /api/health` (node fetch, 15s interval, 30s start period, 5 retries) | `node apps/web/server.js` (Next.js standalone output) |
| `orchestrator` | `deploy/docker/orchestrator.Dockerfile` | 4000 | `GET /health` (15s interval, 40s start period) | `node --import tsx src/index.ts` |
| `computerd` | `deploy/docker/computerd.Dockerfile` | 4100 | `GET /health` (15s interval, 10s start period, 3 retries) | `node --import tsx src/index.ts` |
| `egress` | `deploy/docker/egress.Dockerfile` | 8080 (proxy), 8081 (admin) | `GET :8081/health` (15s interval, 3 retries) | `node --import tsx src/index.ts` |

Key differences per image:

- **web** (`deploy/docker/web.Dockerfile`): three stages — `deps` (pnpm fetch from the lockfile only), `build` (full install, then `pnpm exec next build --webpack` in `apps/web` with `NEXT_OUTPUT=standalone`), and `runtime` copying only `.next/standalone`, `.next/static`, and `public/`. All `NEXT_PUBLIC_*` values (Supabase URL/anon key, site URL, collab URL, VAPID key, auth-provider flags, edition) are build args inlined into the browser bundle at build time — changing them requires a rebuild, not a `reload`. Runs as `USER node` with a writable `.next/cache` tmpfs.
- **orchestrator** (`deploy/docker/orchestrator.Dockerfile:20-30`): no compile step — production deps installed with `--filter "@sayabot/orchestrator..." --filter "@sayabot/db"`, `*.test.ts` files deleted from the image, and TypeScript executed through `tsx`. The CMD is a single node process (no wrapper) "so SIGTERM reaches the graceful shutdown handler" (pg-boss jobs and Hocuspocus canvas flushes).
- **computerd** (`deploy/docker/computerd.Dockerfile:22`): additionally runs `pnpm --filter @sayabot/computerd build:agentd` to bundle the agentd daemon that gets uploaded into cloud (E2B) computers on first boot.
- **egress** (`deploy/docker/egress.Dockerfile`): installs `@sayabot/egress...` and `@sayabot/core` only; runs the MITM HTTPS proxy (8080) and admin API (8081).
- **computer** (`deploy/docker/computer.Dockerfile`): the per-agent sandbox image (`saaya/computer:<tag>`) — Debian bookworm-slim with bash, git, python3, Node 24, ripgrep, jq, tini, and a pre-bundled `agentd.mjs` in `/opt/agentd` (esbuild `0.28.2`, with `typescript@5.9.3` kept external for code intelligence). Creates uid-10001 `bot` user, declares `VOLUME ["/home/bot"]`, and its entrypoint refreshes CA certs when egress mounts them and sources `$HOME/.saaya/env` into `.bashrc`. Compose never builds it; `deploy.sh build_computer_image` does.

## 🧩 Compose Services & Networking (`deploy/docker-compose.yml`)

Project name `sayabot`. Every app service inherits an `x-hardening` anchor: `init: true`, `restart: unless-stopped`, `security_opt: no-new-privileges:true`, `cap_drop: ALL`, json-file logging (20 MB x 5), read-only root filesystem with a `/tmp` tmpfs, and memory limits (default 1g for web and orchestrator, overridable via `SAYABOT_WEB_MEMORY` / `SAYABOT_ORCHESTRATOR_MEMORY`).

| Service | Image / build | Internal port | Published | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `web` | `${SAYABOT_IMAGE_PREFIX:-sayabot}/web:${SAYABOT_TAG:-latest}` | 3000 | none (nginx only) | `depends_on: orchestrator (service_healthy)`; `stop_grace_period: 20s` |
| `orchestrator` | same prefix, `orchestrator` | 4000 | none | `EGRESS_URL: http://egress:8081`, `EGRESS_PROXY_URL: http://egress:8080`; `stop_grace_period: 30s` |
| `migrate` | orchestrator image | — | none | `profiles: ["tools"]` — never started by `up`; runs `node --import tsx src/migrate.ts` in `/app/packages/db` |
| `nginx` | `nginx:1.28-alpine` (`NGINX_VERSION`) | 8080 (tunnel mode) | **80, 443** | healthcheck curls `https://127.0.0.1/api/health` with the `Host` header set; reloads every 6h to pick up renewed certs |
| `certbot` | `certbot/certbot:v4.1.1` (`CERTBOT_VERSION`) | — | none | renew loop every 12h against `/var/www/certbot` webroot |
| `computerd` | `computerd` image | 4100 | none | runs as `user: "0:0"`, mounts `/var/run/docker.sock` and the fixed-name `saaya-agentd` volume at `/srv/saaya-agentd` (agentd fast-path control volume, so computerd stays off `botnet`) |
| `egress` | `egress` image | 8080/8081 | none | the only dual-homed service: joins both `sayabot` and the `internal: true` `botnet` network |

Networks: `sayabot` (bridge) and `botnet` (named bridge, `internal: true` — no outbound internet; bot containers attach here and reach the internet only through egress). Volumes: `saaya-agentd` (fixed name — computerd mounts per-computer subpaths of it into bot containers).

Image tags resolve as `${SAYABOT_IMAGE_PREFIX:-${MESH_IMAGE_PREFIX:-sayabot}}/${service}:${SAYABOT_TAG:-${MESH_TAG:-latest}}` — the `MESH_*` names are legacy fallbacks.

### Overlay compose files

`deploy.sh` stacks extra `-f` files based on env:

- `docker-compose.smolvm.yml` — added when `COMPUTER_BACKEND=smolvm`. Gives computerd `/dev/kvm`, mounts `/opt/smolvm` read-only and `${SAAYA_STATE_DIR:-/var/lib/saaya}/computer-image.tar` (the `docker save` export), and points `SMOLVM_IMAGE`/`SMOLVM_DATA_DIR`/`SMOLVM_RUN_DIR` at a `saaya-smolvm` volume.
- `docker-compose.tunnel.yml` — added when `CLOUDFLARE_TUNNEL_TOKEN` is set (requires Docker Compose >= 2.24.4 for `!reset`/`!override`). nginx publishes no ports and serves plain HTTP on :8080; a hardened `cloudflared` (`cloudflare/cloudflared:2026.10.0`) dials out with `TUNNEL_TOKEN` and forwards the domain to `nginx:8080`. certbot is stopped.
- `docker-compose.supabase.yml` — added when `SAYABOT_SUPABASE=bundled`. Adds `supabase-db`, `supabase-auth`, `supabase-rest`, `supabase-realtime`, `supabase-storage` and makes the `migrate` job wait on all of them being healthy (see [supabase-platform.md](supabase-platform.md)).

## 🚀 `deploy/deploy.sh` — Commands

```
./deploy/deploy.sh                  # build current checkout, migrate, roll out
./deploy/deploy.sh --ref v1.4.0     # fetch + check out a tag/branch/commit first
./deploy/deploy.sh --pull           # pull prebuilt images instead of building
./deploy/deploy.sh --skip-migrations
./deploy/deploy.sh rollback [tag]   # re-up the previous release's images
./deploy/deploy.sh migrate | seed | reload | backup | status | logs [svc] | restart [svc] | down | releases
```

A **release** is the 12-char git short SHA (`git rev-parse --short=12 HEAD`), recorded with a UTC timestamp and commit subject in `deploy/.releases`. Concurrency is guarded by an flock on `deploy/.deploy.lock` (`acquire_lock`, deploy.sh:128-131). `APP_SERVICES` defaults to `orchestrator web` and is extended to include `computerd egress` by the setup scripts; `EDGE_SERVICES` is `nginx certbot`, or `nginx cloudflared` in tunnel mode.

## 🛡️ Preflight Checks (`preflight`, deploy.sh:74-126)

Run before every deploy/rollback/migrate. In order:

1. Docker installed, Compose plugin present, daemon reachable (else "run deploy/scripts/setup-vps.sh" hints).
2. `deploy/.env.production` exists; warns if its mode is not `600`/`400`.
3. Required non-empty env values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ORCHESTRATOR_INTERNAL_SECRET`, `SAYABOT_DOMAIN`, `SAYABOT_KEK` (legacy `MESH_KEK` accepted). In bundled mode additionally: `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`.
4. `SAYABOT_DOMAIN` must not be the example placeholder; `DATABASE_URL` must **not** use port 6543 (transaction pooler — "Use the session pooler (5432)"); `ORCHESTRATOR_INTERNAL_SECRET` must be > 16 chars.
5. Warns if `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_COLLAB_URL`, or `ORCHESTRATOR_URL` are set in env — compose derives and overrides them.
6. TLS gate: tunnel mode requires Compose >= 2.24.4; otherwise a cert must already exist at `certbot/conf/live/$DOMAIN/fullchain.pem` (checked via an `alpine:3.20` container), else "Run ./deploy/scripts/init-letsencrypt.sh first".
7. Warns when free disk on the repo volume is under 4 GB.

## 🔁 Rolling Update Stages (`cmd_deploy`, deploy.sh:328-364)

1. **preflight + lock** (above); optional `checkout` of `--ref` (refuses a dirty working tree).
2. **Tag**: `SAYABOT_TAG=<short-12 SHA>`; previous release read from `.releases`.
3. **Images**: `build_images` (`DOCKER_BUILDKIT=1 compose build --pull`, then re-tag each image as `:latest`) or `pull_images`; both finish with `build_computer_image` — builds `saaya/computer:$COMPUTE_IMAGE_TAG` (default `latest`) since compose never builds it ("Without this step every computer fails with 'No such image'", deploy.sh:256), and for smolvm backends exports it via `docker save` to `$SAAYA_STATE_DIR/computer-image.tar`.
4. **Migrate** (unless `--skip-migrations`): `start_supabase` first in bundled mode (Supabase must be up and have created its own schemas before Sayabot migrates), then a one-off `compose --profile tools run` container named `sayabot-migrate-<epoch>`. On failure the container is removed and the deploy aborts — "Nothing was rolled out; the running release is untouched."
5. **Roll out** (`roll_out`, deploy.sh:303-314): `up -d --no-build --remove-orphans` for app services, then `wait_healthy` (polls Docker health status every 3s until `HEALTH_TIMEOUT`, default 180s; dumps the last 60 log lines on failure), then edge services, then stops certbot in tunnel mode, `nginx -t` + `nginx -s reload` to pick up config edits, and finally `public_check`.
6. **`public_check`** (deploy.sh:195-221): curls `https://$DOMAIN/api/health` with `--resolve "$DOMAIN:443:127.0.0.1"` so the check does not depend on DNS/CDN (10 tries, 3s apart). In tunnel mode it instead checks nginx from inside the compose network on :8080 and best-effort through Cloudflare, warning about Public Hostname/Access misconfigurations.
7. **Success**: `record_release` appends to `.releases`, `prune_old_images` keeps the last `SAYABOT_KEEP_RELEASES` (default 3) tags plus `latest`, prunes dangling images/builder cache (>24h, keep 4 GB).
8. **Failure**: automatic `rollback_to $previous` (re-up with the old tag + health-gate again); hard-dies if rollback also fails.

## ⏪ Rollback & Operational Commands

- `rollback [tag]` — needs two recorded releases when no tag is given (picks the second-to-last); verifies images still exist locally (`images_exist`), re-ups app services with the old `SAYABOT_TAG`, waits for health, re-runs `public_check`, and records the target as current.
- `reload` — recreates app containers with `--force-recreate` to apply `.env.production` edits (server-only values like `SAYA_AI_*`, keys, tokens). `NEXT_PUBLIC_*` values need a full deploy because they are baked into the web image.
- `backup` — bundled Supabase only: `pg_dump -U postgres --no-owner --clean --if-exists` piped through gzip into `deploy/backups/sayabot-<UTC>.sql.gz` (mode 600, directory 700).
- `seed` — runs `packages/db/src/seed.ts` through the same tools-profile migrate container.
- `migrate` (standalone) — runs migrations at the currently recorded release tag (or `latest`).

## 🔑 First-Time Setup (`deploy/install.sh`)

Interactive (or `--yes` scripted) generator for `deploy/.env.production`, mode 600. It asks for domain and instance name, chooses HTTPS mode (Let's Encrypt vs Cloudflare Tunnel token), chooses Supabase mode — **bundled** (default; generates `POSTGRES_PASSWORD`, `JWT_SECRET`, 10-year HS256 `ANON_KEY`/`SERVICE_ROLE_KEY` JWTs signed with `JWT_SECRET`, `SECRET_KEY_BASE`, `REALTIME_DB_ENC_KEY`, and `DATABASE_URL=postgresql://postgres:…@supabase-db:5432/postgres`) or **hosted** (pastes a supabase.com project URL/anon key/service key and a port-5432 session-pooler `DATABASE_URL`; port 6543 is rejected). It keeps an existing `SAYABOT_KEK` if present ("losing it makes every saved key unreadable"), generates a 32-byte base64 KEK otherwise, generates `ORCHESTRATOR_INTERNAL_SECRET`, backs up any prior env file, and optionally chains `scripts/init-letsencrypt.sh` + `deploy.sh`.

## 🌐 TLS & Certificates

- `init-letsencrypt.sh` issues the first certificate standalone on port 80 (ECDSA secp384r1), then rewrites the renewal conf to the webroot authenticator so renewals need no downtime (see [scripts.md](scripts.md)).
- The `certbot` compose service renews every 12h into the shared `certbot/conf` + `certbot/www` volumes; nginx reloads every 6h (compose command) so renewed certs are picked up without a restart.
- In tunnel mode no certificate exists at all — Cloudflare terminates TLS.

## ⚙️ Key Environment Variables

| Variable | Meaning |
| :--- | :--- |
| `SAYABOT_DOMAIN` / `MESH_DOMAIN` | Public hostname; drives nginx template rendering, `NEXT_PUBLIC_*` URLs, health checks |
| `SAYABOT_TAG` / `SAYABOT_IMAGE_PREFIX` | Release tag (git SHA) and image registry prefix |
| `SAYABOT_APP_SERVICES` | App services to build/roll out (default `orchestrator web`; scripts extend it) |
| `SAYABOT_SUPABASE=bundled` | Adds the bundled Supabase compose overlay |
| `CLOUDFLARE_TUNNEL_TOKEN` | Switches to tunnel mode (cloudflared, no open ports) |
| `COMPUTER_BACKEND` | `auto`/`smolvm`/`docker`/`e2b`; `smolvm` adds the KVM overlay |
| `SAYABOT_HEALTH_TIMEOUT` | Health-gate deadline in seconds (default 180) |
| `SAYABOT_KEEP_RELEASES` | Tag retention for image pruning (default 3) |
| `SAYABOT_ALLOW_PRIVATE_WEBHOOKS` | Dev-only escape hatch allowing webhook delivery to private networks |

---

## Related docs

- [nginx-and-cloudflare.md](nginx-and-cloudflare.md) — reverse proxy routes, TLS, Cloudflare Tunnel
- [supabase-platform.md](supabase-platform.md) — bundled Supabase services and SQL bootstrap
- [scripts.md](scripts.md) — VPS setup and computer backend setup scripts
- [troubleshooting.md](troubleshooting.md) — deploy and runtime failure modes
- [../../deployment.md](../../deployment.md) — top-level deployment guide
- [../../self-hosting.md](../../self-hosting.md) — self-hosting overview
