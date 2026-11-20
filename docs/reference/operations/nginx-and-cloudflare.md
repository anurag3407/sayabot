# Nginx Reverse Proxy & Cloudflare

nginx is the only component with published ports in the Sayabot stack. It terminates TLS (Let's Encrypt via certbot, or nothing at all in Cloudflare Tunnel mode), routes `/collab` WebSockets to the orchestrator and everything else to the Next.js web app, applies per-IP rate limits, and — in bundled-Supabase mode — also stands in for Supabase's API gateway on `/auth/v1`, `/rest/v1`, `/realtime/v1`, and `/storage/v1`. In tunnel mode `cloudflared` dials out to Cloudflare and nginx serves plain HTTP on an internal port.

Source files: `deploy/nginx/nginx.conf`, `deploy/nginx/templates/sayabot.conf.template`, `deploy/nginx/templates-tunnel/sayabot.conf.template`, `deploy/nginx/snippets/proxy.conf`, `deploy/nginx/snippets/security-headers.conf`, `deploy/nginx/snippets/sayabot-locations.conf`, `deploy/nginx/supabase-locations.conf`, `deploy/docker-compose.tunnel.yml`, `deploy/cloudflare/wrangler.jsonc`

---

## 🗂️ Config Layout & Rendering

```
deploy/nginx/
├── nginx.conf                      # main config (mounted at /etc/nginx/nginx.conf)
├── templates/sayabot.conf.template # TLS mode; ${SAYABOT_DOMAIN} envsubst-rendered
│                                   # to /etc/nginx/conf.d by the nginx image entrypoint
├── templates-tunnel/sayabot.conf.template
│                                   # tunnel mode; same paths, listens on :8080, no TLS
└── snippets/
    ├── proxy.conf                  # shared proxy_set_header/timeout block
    ├── security-headers.conf       # HSTS, nosniff, COOP
    └── sayabot-locations.conf      # every Sayabot route (shared by both templates)
supabase-locations.conf             # mounted at /etc/nginx/supabase/locations.conf
                                    # only when docker-compose.supabase.yml is active
```

The compose command for nginx runs the official image's `20-envsubst-on-templates.sh`, deletes `conf.d/default.conf`, starts a background loop that runs `nginx -s reload` every 6h (so renewed certificates are picked up without downtime), and then execs `nginx -g 'daemon off;'` (`deploy/docker-compose.yml:142`). Plain nginx variables (`$host`, `$remote_addr`) are left untouched by envsubst; only `${SAYABOT_DOMAIN}` is substituted.

## ⚙️ Global Settings (`deploy/nginx/nginx.conf`)

- **Workers/limits**: `worker_processes auto`, `worker_rlimit_nofile 65535`, 8192 `worker_connections`, `multi_accept on`.
- **Body/headers**: `client_max_body_size 4m` (storage uploads get their own 50m override, see below), 30s body timeout, 15s header timeout, `large_client_header_buffers 4 32k`.
- **Proxy defaults**: connect 5s, read/send 60s, `proxy_buffer_size 128k` + `proxy_buffers 4 256k` + `proxy_busy_buffers_size 256k` — sized "for OAuth callbacks with multiple large Set-Cookie headers" (`snippets/proxy.conf:16-19`).
- **Gzip**: level 5, min length 1024, for text/JSON/JS/XML/SVG/woff2.
- **TLS**: Mozilla "intermediate" profile — TLSv1.2/1.3 only, the 6 AEAD/CHACHA20 cipher suites, `ssl_prefer_server_ciphers off`, shared session cache 10m, session tickets off, and **no OCSP stapling** ("Let's Encrypt no longer serves OCSP", nginx.conf:62-68).
- **Resolver**: `127.0.0.11` (Docker's embedded DNS) with `valid=10s`, so upstreams re-resolve after container restarts.
- **Rate-limit zones** (per client IP): `sayabot_general` 30 r/s, `sayabot_api` 20 r/s, `sayabot_auth` 10 r/m, plus `sayabot_conn` connection zone; both `limit_req_status` and `limit_conn_status` are 429.
- **Log redaction**: a `map` on `$request_uri` masks MCP/API keys that travel in the path (`/mcp/<key>`, `/api/v1/mcp/<key>` with the `mesh_ak_`/`sayabot_ak_` prefixes) to `<prefix>[redacted]` before the JSON access log is written to stdout (nginx.conf:21-29).
- **Supabase apikey fallback**: a `map` on `$http_authorization|$http_apikey` turns a bare `apikey` header into `Authorization: Bearer <key>` — matching what Supabase's own gateway does (nginx.conf:80-84).
- **WebSocket upgrade map**: `$http_upgrade`/`$connection_upgrade` so proxied connections upgrade only when the client asks.

## 🔀 Route Table (`snippets/sayabot-locations.conf`)

Shared verbatim by the TLS server (port 443) and the tunnel listener (port 8080) "so both serve exactly the same paths, limits and timeouts" (sayabot-locations.conf:1-2).

| Route                                                              | Upstream                                     | Rate limit                          | Timeouts / notes                                                                                                                             |
| :----------------------------------------------------------------- | :------------------------------------------- | :---------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `location = /collab`                                               | `sayabot_orchestrator` (`orchestrator:4000`) | —                                   | WebSocket (Hocuspocus canvas sync); read/send timeout **1h**, buffering off. The only orchestrator path exposed; `/internal/*` stays private |
| `~ ^/(api/v1\|mcp)/`                                               | `sayabot_web` (`web:7431`)                   | `sayabot_api` burst 60 nodelay      | NDJSON/SSE streaming: `proxy_buffering off`, `proxy_request_buffering off`, `proxy_cache off`, read/send **330s**, `X-Accel-Buffering: no`   |
| `location = /api/health`                                           | `sayabot_web`                                | none                                | Liveness for uptime monitors; `access_log off`                                                                                               |
| `~ ^/(login\|signup\|forgot-password\|reset-password\|auth)(/\|$)` | `sayabot_web`                                | `sayabot_auth` burst 20 nodelay     | Slows password guessing and code brute force                                                                                                 |
| `location /_next/static/`                                          | `sayabot_web`                                | —                                   | `expires 1y` + `Cache-Control: public, max-age=31536000, immutable` (content-hashed assets)                                                  |
| `~ ^/(sw\.js\|swe-worker.*\.js\|manifest\.webmanifest)$`           | `sayabot_web`                                | —                                   | `Cache-Control: no-cache` so service workers revalidate and new deploys take effect                                                          |
| `location /`                                                       | `sayabot_web`                                | `sayabot_general` burst 100 nodelay | Pages, server actions, RSC payloads; buffering off (server actions can stream), read timeout 120s                                            |

`snippets/proxy.conf` sets `proxy_http_version 1.1`, an empty `Connection` (upstream keepalive, switched to `upgrade` for WebSockets via the map), `Host`, `X-Real-IP`, `X-Forwarded-For/Proto/Host/Port 443`, `proxy_next_upstream error timeout` with 2 tries, and the large proxy buffers. `snippets/security-headers.conf` adds `Strict-Transport-Security "max-age=63072000; includeSubDomains"`, `X-Content-Type-Options: nosniff`, and `Cross-Origin-Opener-Policy: same-origin`, all with `always` so they land on error responses too.

## 🖥️ Virtual Servers

### TLS mode (`templates/sayabot.conf.template`)

- **Upstreams**: `sayabot_web` (`web:7431`, keepalive 32) and `sayabot_orchestrator` (`orchestrator:4000`, keepalive 8), each with a 64k shared zone.
- **`:80` default server**: serves `/.well-known/acme-challenge/` from `/var/www/certbot` (the certbot webroot) and 301-redirects everything else to `https://${SAYABOT_DOMAIN}$request_uri`.
- **`:443` default server**: `http2 on`, the domain's certificate, and `return 444` — "reject unknown Host headers (IP scans, spoofed hosts)".
- **`:443` Sayabot server**: certificate, security headers, `limit_conn sayabot_conn 100`, then `include /etc/nginx/supabase/*.conf` (empty unless bundled Supabase is active) and `include /etc/nginx/snippets/sayabot-locations.conf`.

Certificates live in the `deploy/certbot/conf` volume; issuance/renewal is covered in [deployment.md](deployment.md) and [scripts.md](scripts.md).

### Tunnel mode (`templates-tunnel/sayabot.conf.template`)

One server on **:8080** (never published — reachable only on the compose network). Traffic path: `browser ─▶ Cloudflare edge (TLS, WAF, Access) ─▶ cloudflared ─▶ nginx :8080 ─▶ web / orchestrator`. Because every request arrives from the cloudflared container, the template trusts only private peers to set the client address:

```nginx
set_real_ip_from 10.0.0.0/8;
set_real_ip_from 172.16.0.0/12;
set_real_ip_from 192.168.0.0/16;
real_ip_header CF-Connecting-IP;
```

so rate limits stay per visitor instead of one shared bucket. `docker-compose.tunnel.yml` resets nginx's `ports` to `[]`, swaps the template volume to `templates-tunnel/`, changes the healthcheck to plain HTTP on :8080, and adds the hardened `cloudflared` service (`cloudflare/cloudflared:2026.10.0`, `tunnel --no-autoupdate run`, `TUNNEL_TOKEN` required, read-only, all caps dropped). In the Cloudflare dashboard the tunnel's Public Hostname maps `SAYABOT_DOMAIN → HTTP → nginx:8080`; WebSockets on `/collab` work through the tunnel with no extra settings (docker-compose.tunnel.yml:7-9).

## 🧱 Bundled Supabase Gateway (`supabase-locations.conf`)

Mounted only with `docker-compose.supabase.yml` at `/etc/nginx/supabase/locations.conf`. These use `^~` prefix matching, which wins over the regex locations in `sayabot-locations.conf` — e.g. `/auth/v1/...` escapes the `/auth` auth rate limit on purpose (supabase-locations.conf:4-5).

| Path                                                         | Upstream                         | Behavior                                                                                                                              |
| :----------------------------------------------------------- | :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------ |
| `^~ /auth/v1/`                                               | `supabase-auth:9999`             | `sayabot_general` burst 60; `Authorization` set from the apikey map                                                                   |
| `= /rest/v1/`                                                | —                                | `403` — PostgREST's root endpoint lists the whole API; Supabase's gateway only shows it to admins                                     |
| `^~ /rest/v1/`                                               | `supabase-rest:3000`             | `sayabot_api` burst 120; apikey→Authorization fallback                                                                                |
| `^~ /realtime/v1/api/tenants`, `^~ /realtime/v1/api/openapi` | —                                | `403` — realtime's tenant admin API and OpenAPI page stay private                                                                     |
| `^~ /realtime/v1/api/`                                       | `supabase-realtime:4000/api/`    | Broadcasts from the orchestrator (REST); sets `Host: realtime-dev.supabase-realtime` (realtime picks its tenant from the Host header) |
| `^~ /realtime/v1/`                                           | `supabase-realtime:4000/socket/` | Client WebSocket; 1h read/send timeouts, buffering off                                                                                |
| `^~ /storage/v1/`                                            | `supabase-storage:5000`          | `client_max_body_size 50m`, `proxy_request_buffering off`, `X-Forwarded-Prefix /storage/v1`                                           |

Every proxied Supabase service still validates the JWT itself; nginx only performs the apikey→Authorization normalization.

## 🔌 Compose Wiring & Verification

The `nginx` service in `deploy/docker-compose.yml:117-148` mounts the tree read-only — `nginx.conf` at `/etc/nginx/nginx.conf`, `templates/` at `/etc/nginx/templates` (the envsubst entrypoint renders them into `/etc/nginx/conf.d`), `snippets/` at `/etc/nginx/snippets` (with `sayabot-locations.conf` mounted a second time explicitly), and the `certbot/conf` + `certbot/www` volumes for certificates. `SAYABOT_DOMAIN`/`MESH_DOMAIN` are its only env, feeding the envsubst render. It `depends_on: web (service_healthy)` — the edge never starts before the app it fronts. Its healthcheck curls `https://127.0.0.1/api/health` with the domain as the `Host` header, exercising the full TLS + routing path from inside the container; `start_period: 10s`, retries 3.

In bundled-Supabase mode, `docker-compose.supabase.yml:233-235` adds one more volume: `supabase-locations.conf` → `/etc/nginx/supabase/locations.conf`, which the `include /etc/nginx/supabase/*.conf` glob in both templates picks up.

Quick verification from the host (the same trick `deploy.sh public_check` uses):

```bash
curl -fsSk --resolve "$SAYABOT_DOMAIN:443:127.0.0.1" "https://$SAYABOT_DOMAIN/api/health"
docker compose -f deploy/docker-compose.yml exec nginx nginx -t        # config dry-run
docker compose -f deploy/docker-compose.yml exec nginx nginx -s reload # pick up template edits
```

`deploy.sh roll_out` runs exactly the last two commands after every deploy so config edits apply even when the nginx container itself was not recreated (deploy.sh:312).

## ☁️ Cloudflare Workers Edge (`deploy/cloudflare/wrangler.jsonc`)

A separate, optional deployment mode: a Wrangler config named `sayabot-edge` that runs the orchestrator's Hono app (`main: "../../apps/orchestrator/src/http.ts"`) as a Cloudflare Worker with `nodejs_compat` and `SAYABOT_EDGE_ENABLED=true`. It binds:

- **Workers AI** (`ai.binding: AI`) — edge inference on Meta Llama 3.3, DeepSeek R1, and embedding models.
- **Browser Rendering** (`browser.binding: MYBROWSER`) — headless Chromium DevTools Protocol without local Docker.
- **R2** (`ARTIFACTS_BUCKET` → `sayabot-artifacts`) — artifact/screenshot/canvas document storage with zero egress cost.
- **Vectorize** (`VECTORIZE_INDEX` → `sayabot-memory`) — edge vector index for room memory and semantic recall.
- **KV** (`ROOM_CACHE` → `sayabot_room_cache`) — ephemeral session caching and distributed rate limiting.

`compatibility_date` is `2025-04-01`. This is distinct from the Cloudflare **Tunnel** mode described above (which keeps all services on your VPS and only uses Cloudflare as the ingress).

---

## Related docs

- [deployment.md](deployment.md) — compose stack, images, certbot and rollout mechanics
- [supabase-platform.md](supabase-platform.md) — the Supabase services behind these gateway routes
- [troubleshooting.md](troubleshooting.md) — SSE buffering, WebSocket, and tunnel failure modes
- [../../cloudflare-integration.md](../../cloudflare-integration.md) — top-level Cloudflare integration guide
- [../../deployment.md](../../deployment.md) — top-level deployment guide
