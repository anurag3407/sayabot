# Deploying Sayabot to a VPS

One VPS runs everything except the database. Supabase stays hosted (Postgres, Auth, Realtime).

```
internet ──▶ nginx :80/:443 (TLS, rate limits, HSTS, gzip)
               ├─ /collab            ──▶ orchestrator :4000   (canvas WebSocket)
               ├─ /api/v1/*, /mcp/*  ──▶ web :3000 ──▶ orchestrator   (bots + MCP, unbuffered)
               └─ everything else    ──▶ web :3000            (Next.js standalone)
certbot ── renews Let's Encrypt every 12h; nginx reloads every 6h
```

Only nginx publishes ports. The orchestrator's `/internal/*` API is not reachable from outside.
Containers run as non-root with read-only filesystems, all capabilities dropped,
`no-new-privileges`, memory limits, health checks and rotated logs.

## Files

| Path | Purpose |
|---|---|
| `deploy/docker/web.Dockerfile` | Multi-stage Next.js build → standalone server image |
| `deploy/docker/orchestrator.Dockerfile` | Orchestrator image (also runs migrations and seeds) |
| `deploy/docker-compose.yml` | web, orchestrator, nginx, certbot, and a one-off `migrate` |
| `deploy/docker-compose.tunnel.yml` | Cloudflare Tunnel overlay (added when `CLOUDFLARE_TUNNEL_TOKEN` is set) |
| `deploy/nginx/` | `nginx.conf`, the site template, shared proxy and header snippets |
| `deploy/.env.production.example` | Every setting, documented |
| `deploy/scripts/setup-vps.sh` | One-time server hardening + Docker install (run as root) |
| `deploy/scripts/init-letsencrypt.sh` | First TLS certificate |
| `deploy/deploy.sh` | Build, migrate, health-gated rollout, auto-rollback, ops commands |

## Requirements

- Ubuntu 22.04/24.04 or Debian 12, **2 vCPU / 4 GB RAM** minimum (the Next.js build peaks
  near 3 GB; the setup script adds 4 GB swap). 40 GB disk.
- A domain with an **A record** (and AAAA if the server has IPv6) pointing at the VPS.
- A Supabase project (see `docs/deployment.md` §1 for the Supabase settings).

## First deploy

**1. Harden the server** (from your laptop):

```bash
scp deploy/scripts/setup-vps.sh root@YOUR_IP:/root/
ssh root@YOUR_IP 'bash /root/setup-vps.sh --user deploy --ssh-key "$(cat ~/.ssh/id_ed25519.pub)"'
```

This turns off password SSH login. Make sure `ssh deploy@YOUR_IP` works in a second
terminal before you close the root session.

**2. Get the code and configure it** (as `deploy`):

```bash
ssh deploy@YOUR_IP
git clone git@github.com:YOU/mesh.git ~/mesh && cd ~/mesh
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
nano deploy/.env.production        # MESH_DOMAIN, LETSENCRYPT_EMAIL, Supabase, secrets
```

For a private repo, add a read-only deploy key to GitHub (`ssh-keygen -t ed25519` on the
server, then repo → Settings → Deploy keys).

**3. Supabase Auth URLs.** Set Site URL to `https://YOUR_DOMAIN` and add
`https://YOUR_DOMAIN/auth/callback` and `https://YOUR_DOMAIN/auth/complete` to the redirect list.

**4. TLS certificate:**

```bash
./deploy/scripts/init-letsencrypt.sh --staging   # optional dry run
./deploy/scripts/init-letsencrypt.sh --force     # real certificate
```

**5. Deploy:**

```bash
./deploy/deploy.sh
./deploy/deploy.sh seed     # first time only: starter model prices
```

Open `https://YOUR_DOMAIN`.

## Cloudflare Tunnel instead of open ports

Set `CLOUDFLARE_TUNNEL_TOKEN` in `.env.production`, point the tunnel's Public Hostname at
`http://nginx:8080`, and skip `init-letsencrypt.sh`. `deploy.sh` then adds
`docker-compose.tunnel.yml`: nginx publishes no ports, cloudflared dials out, and certbot isn't
used. Needs Docker Compose 2.24.4+. Full steps, including Cloudflare Access bypass paths, are in
[`docs/self-hosted-flow.md`](../docs/self-hosted-flow.md).

## Everyday operations

```bash
./deploy/deploy.sh                    # deploy what is checked out
./deploy/deploy.sh --ref main         # fetch + deploy a branch, tag or commit
./deploy/deploy.sh rollback           # back to the previous release (or: rollback <sha>)
./deploy/deploy.sh releases           # release history
./deploy/deploy.sh status             # containers + health
./deploy/deploy.sh logs web           # follow logs (web | orchestrator | nginx | certbot)
./deploy/deploy.sh restart orchestrator
./deploy/deploy.sh migrate            # migrations only
```

What a deploy does:

1. Preflight: Docker access, required env values, session pooler (not 6543), certificate
   present, disk space. Only one deploy can run at a time.
2. Builds both images tagged with the git SHA (`--pull` pulls them from a registry instead).
3. Runs migrations. If they fail, it stops; the running release is untouched.
4. Recreates orchestrator then web, waits for their health checks, then reloads nginx and checks
   `https://DOMAIN/api/health` through it.
5. If any check fails, it restores the previous release's images automatically.
6. Records the release and prunes images older than `MESH_KEEP_RELEASES` releases.

**Rollbacks don't undo migrations.** Keep migrations backward compatible with the previous
release: add tables and columns, and drop them in a later release.

Expect a few seconds of downtime while the containers restart. That's normal for one server.
Zero-downtime would need two web replicas behind nginx. The orchestrator has to stay single
because Hocuspocus canvas state lives in one process (see Known limits in the root README).

## Building in CI instead of on the server

Builds on a small VPS are slow. To build elsewhere, set `MESH_IMAGE_PREFIX=ghcr.io/you/mesh`,
then build and push both images from CI or your laptop with the same `NEXT_PUBLIC_*` build args:

```bash
export MESH_TAG=$(git rev-parse --short=12 HEAD)
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml build web orchestrator
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml push web orchestrator
```

Then run `./deploy/deploy.sh --ref <same commit> --pull` on the server, after `docker login ghcr.io`.

## Changing settings

- Runtime secrets (`SUPABASE_SERVICE_ROLE_KEY`, `E2B_API_KEY`, …): edit `.env.production`, then
  `./deploy/deploy.sh` (or `docker compose ... up -d` to recreate without a rebuild).
- **`NEXT_PUBLIC_*` values and `MESH_DOMAIN` are compiled into the browser bundle.** Changing them
  needs a rebuild: `./deploy/deploy.sh`.
- **Never change `MESH_KEK`.** It encrypts every stored provider key and secret. Back up
  `.env.production` somewhere safe, such as a password manager.

## Security checklist

- [ ] `ssh deploy@host` works with a key; password login is refused
- [ ] `sudo ufw status` shows only your SSH port, 80 and 443
- [ ] `chmod 600 deploy/.env.production`, backed up off the server
- [ ] `https://www.ssllabs.com/ssltest/` grades the domain A or A+
- [ ] Supabase: RLS migrations applied (`./deploy/deploy.sh migrate`), service role key only on the server
- [ ] An uptime monitor (Better Stack, UptimeRobot, …) watches `https://DOMAIN/api/health`
- [ ] Supabase backups/PITR enabled for the project

## Troubleshooting

| Symptom | Check |
|---|---|
| `init-letsencrypt` fails | DNS A record points here; port 80 open (`ufw status`); no other web server running |
| Deploy stuck on "web is not healthy" | `./deploy/deploy.sh logs web`: usually a missing env value |
| Orchestrator restarts | `logs orchestrator`: `DATABASE_URL` must be the session pooler on 5432 |
| Canvas never connects | Browser console: `wss://DOMAIN/collab` must return 101. Rebuild after changing the domain |
| MCP client says unauthorized | Key revoked, or the URL lost its `/mcp/<key>` suffix |
| 429 responses | nginx rate limits in `deploy/nginx/nginx.conf` (`mesh_api`, `mesh_auth`, `mesh_general`) |
| Build killed (exit 137) | Out of memory: check that swap is on (`swapon --show`), or build in CI |
