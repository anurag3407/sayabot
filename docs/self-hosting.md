# Self-Hosting Sayabot: The Definitive Production Guide

Sayabot is an open-source, full-stack autonomous remote agent platform and multiplayer collaboration workspace where human teams and AI agents share persistent rooms, execute deterministic turns, edit live collaborative canvases, and operate persistent Linux computers.

This guide provides an end-to-end operational manual for self-hosting Sayabot in production environments—from single-node VPS installations and Zero-Trust Cloudflare Tunnels to private Tailscale meshes, split-cloud topologies, and homelabs.

---

## Table of Contents

1. [Architecture & System Topology](#1-architecture--system-topology)
2. [Prerequisites & System Sizing](#2-prerequisites--system-sizing)
3. [Ingress & Hosting Pathways](#3-ingress--hosting-pathways)
   - [Pathway A: Single VPS Stack (Docker Compose + Nginx + Certbot)](#pathway-a-single-vps-stack-deploy)
   - [Pathway B: Cloudflare Zero Trust Tunnels (No Open Inbound Ports)](#pathway-b-cloudflare-zero-trust-tunnels)
   - [Pathway C: Tailscale Private Mesh Network](#pathway-c-tailscale-private-mesh-network)
   - [Pathway D: Split Cloud Hosting (Vercel + Fly.io / Railway + Supabase)](#pathway-d-split-cloud-hosting)
   - [Pathway E: Local Homelab & On-Premises](#pathway-e-local-homelab--on-premises)
4. [Database & Supabase Engine Setup](#4-database--supabase-engine-setup)
   - [The Pooler Dilemma: Session Pooler (5432) vs. Transaction Pooler (6543)](#the-pooler-dilemma-session-pooler-5432-vs-transaction-pooler-6543)
   - [Applying Migrations & SQL Architecture](#applying-migrations--sql-architecture)
   - [Row Level Security (RLS) & Realtime Publication](#row-level-security-rls--realtime-publication)
   - [Authentication & OAuth Configuration](#authentication--oauth-configuration)
5. [Environment Variables & Secret Vaults](#5-environment-variables--secret-vaults)
   - [Key Encryption Key (`MESH_KEK`) & In-Flight Token Swapping](#key-encryption-key-mesh_kek--in-flight-token-swapping)
   - [Build-Time Inlining (`NEXT_PUBLIC_*`) vs. Runtime Variables](#build-time-inlining-next_public_-vs-runtime-variables)
   - [Complete Environment Variable Dictionary](#complete-environment-variable-dictionary)
6. [Reverse Proxy, Networking & WebSocket Tuning](#6-reverse-proxy-networking--websocket-tuning)
   - [Nginx Configuration Deep Dive](#nginx-configuration-deep-dive)
   - [Hocuspocus WebSocket Upgrade (`/collab`)](#hocuspocus-websocket-upgrade-collab)
   - [Unbuffered Streaming for SSE & NDJSON (`/api/v1/*`, `/mcp/*`)](#unbuffered-streaming-for-sse--ndjson-apiv1-mcp)
   - [Alternative: Caddyfile Configuration](#alternative-caddyfile-configuration)
7. [Sandboxes, Computer Use (`computerd`) & Browser CDP](#7-sandboxes-computer-use-computerd--browser-cdp)
   - [Persistent `/home/bot` Linux Sandboxes](#persistent-homebot-linux-sandboxes)
   - [Docker Socket Security Hardening](#docker-socket-security-hardening)
   - [Headless Chromium CDP vs. Cloudflare Browser Rendering](#headless-chromium-cdp-vs-cloudflare-browser-rendering)
   - [Egress Secret Broker & SSRF Firewall](#egress-secret-broker--ssrf-firewall)
8. [Universal MCP Gateway & External Client Connectors](#8-universal-mcp-gateway--external-client-connectors)
   - [Connecting Claude Desktop](#connecting-claude-desktop)
   - [Connecting Claude Code CLI](#connecting-claude-code-cli)
   - [Connecting Cursor & Windsurf](#connecting-cursor--windsurf)
   - [Connecting OpenAI ChatGPT (Custom GPT Actions)](#connecting-openai-chatgpt-custom-gpt-actions)
   - [Connecting Hermes Agent CLI](#connecting-hermes-agent-cli)
9. [Day-2 Operations, Backups & Maintenance](#9-day-2-operations-backups--maintenance)
   - [Zero-Downtime Rolling Deploys with `deploy.sh`](#zero-downtime-rolling-deploys-with-deploysh)
   - [Automated Rollback Safeguards](#automated-rollback-safeguards)
   - [Disaster Recovery & Database Backups](#disaster-recovery--database-backups)
   - [Log Aggregation & Health Monitoring](#log-aggregation--health-monitoring)
10. [Comprehensive Troubleshooting Matrix](#10-comprehensive-troubleshooting-matrix)
11. [Production Hardening Checklist](#11-production-hardening-checklist)

---

## 1. Architecture & System Topology

Sayabot is architected as a set of decoupled, purpose-built microservices coordinated over PostgreSQL primitives and high-throughput real-time protocols:

```
                                  ┌────────────────────────┐
                                  │   Clients & Browsers   │
                                  └───────────┬────────────┘
                                              │
                      HTTPS / WSS / SSE       │
                                              ▼
                             ┌─────────────────────────────────┐
                             │    Reverse Proxy / Ingress      │
                             │  (Nginx / Cloudflare / Caddy)   │
                             └───────┬─────────────────┬───────┘
                                     │                 │
              /collab (WebSocket)    │                 │  HTTP / HTTPS
                                     ▼                 ▼
 ┌──────────────────────────────────────┐     ┌─────────────────────────────────┐
 │       apps/orchestrator (:4000)      │     │         apps/web (:3000)        │
 │ • Turn Engine & Advisory Locking     │     │ • Next.js 16 App Router (SSR)   │
 │ • Hocuspocus Yjs WebSocket Server    │◄────┤ • Server Actions (Admin Client) │
 │ • pg-boss Distributed Queue Worker   │     │ • Proxy: /api/v1/*, /mcp/*      │
 │ • Universal MCP Gateway Engine       │     │ • n8n Visual Automation Canvas  │
 │ • Hermes Cron Routine Scheduler      │     └────────────────┬────────────────┘
 └───────┬──────────────────────┬───────┘                      │
         │                      │                              │
         │                      │ Supabase SDK                 │
         │                      ▼                              │
         │         ┌────────────────────────┐                  │
         │         │   Supabase Postgres    │◄─────────────────┘
         │         │ • Session Pooler :5432 │
         │         │ • Multi-Tenant RLS     │
         │         │ • Realtime CDC PubSub  │
         │         └────────────────────────┘
         │
         ├─────────────────────────────────────────┐
         │ Docker Socket                           │ Internal HTTP
         ▼                                         ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│       apps/computerd (:4100)    │       │        apps/egress (:8080)      │
│ • Per-Agent Docker Sandboxes    │       │ • Outbound Secret Broker Vault  │
│ • Persistent /home/bot Storage  │──────►│ • In-flight Token Swapper       │
│ • Chromium CDP Remote Browser   │       │ • SSRF Private CIDR Firewall    │
└─────────────────────────────────┘       └────────────────┬────────────────┘
                                                           │ External Traffic
                                                           ▼
                                                  ┌─────────────────┐
                                                  │ External APIs   │
                                                  │ GitHub / Models │
                                                  └─────────────────┘
```

### Component Breakdown

| Service | Internal Port | Description & Runtime Requirements |
| :--- | :--- | :--- |
| **`apps/web`** | `3000` | Next.js 16 standalone server running React 19. Renders the interactive UI, Monaco canvas editors, n8n visual cron builder, and proxies external bot & MCP traffic to the orchestrator. Stateless; horizontally scalable. |
| **`apps/orchestrator`** | `4000` | Node.js 24 + Hono runtime. Manages turn turns, acquires Postgres advisory locks (`mesh:room:<id>`), runs Hocuspocus CRDT sync on `/collab`, and schedules cron routines. Must run as a persistent singleton unless distributed Redis canvas clustering is attached. |
| **`apps/computerd`** | `4100` | Privileged agent sandbox coordinator. Communicates directly with the host `/var/run/docker.sock` to instantiate isolated Linux containers with persistent storage and Chromium instances over Chrome DevTools Protocol (CDP). |
| **`apps/egress`** | `8080` (proxy)<br>`8081` (admin) | Secret-brokering proxy. Traps outbound traffic from containers, substitutes opaque placeholders (`saaya_ph_...`) with real decrypted credentials in flight, and drops requests destined for RFC-1918 subnets or cloud metadata endpoints. |
| **Supabase Postgres** | `5432` (session) | Managed or self-hosted PostgreSQL 15/16 database with Supabase Realtime CDC logical replication. **Must use session pooling (port 5432)** for advisory locks and `LISTEN/NOTIFY`. |

---

## 2. Prerequisites & System Sizing

### Hardware Sizing Guidelines

| Deployment Tier | Workload Profile | CPU | RAM | Swap | Storage |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Starter / Homelab** | 1–5 users, 2–3 active bots, no local Docker sandboxes | 2 vCPU | 4 GB | 4 GB | 40 GB SSD |
| **Team Production** | 5–25 users, 10+ bots, persistent Linux sandboxes (`computerd`) | 4 vCPU | 8 GB | 4 GB | 80 GB NVMe |
| **Enterprise Fleet** | 25+ users, intensive browser automation, multi-room parallel turns | 8 vCPU | 16 GB | 8 GB | 200 GB NVMe |

> [!IMPORTANT]
> **Next.js Standalone Build Peak Memory**: Next.js webpack production compilation peaks between **2.8 GB and 3.2 GB of RAM**. If building directly on your VPS, configuring a **minimum of 4 GB swap space is strictly mandatory** to prevent the Linux Out-Of-Memory (OOM) killer from terminating the build process (`Exit 137`).

### Software & Operating System Requirements

- **Supported OS**: Ubuntu 22.04 LTS / 24.04 LTS, Debian 12 (Bookworm), macOS 14+ (development/homelab).
- **Docker Engine**: Version `24.0+` or `26.0+` with the Docker Compose v2 plugin (`docker compose version`).
- **Node.js & Package Manager** (for host tasks): Node.js `v24.0.0+` and `pnpm v10.3.0+`.
- **OpenSSL**: Version `3.0+` for generating high-entropy base64 encryption keys and hex tokens.
- **Network Ports**:
  - `80/tcp`: HTTP (Certbot ACME challenge & redirect).
  - `443/tcp`: HTTPS (Public application entry, WebSocket `/collab`, and MCP gateway).
  - `22/tcp`: SSH administration (key-only authentication recommended).

---

## 3. Ingress & Hosting Pathways

Choose the ingress pattern that matches your security model and networking architecture:

| Pathway | Ideal Use Case | Public Ports Open | Custom Domain | Complexity |
| :--- | :--- | :--- | :--- | :--- |
| **[Pathway A: VPS All-In-One](#pathway-a-single-vps-stack-deploy)** | Production deployments on Hetzner, DigitalOcean, AWS EC2, Linode | `80`, `443` | Required | Low (Scripted) |
| **[Pathway B: Cloudflare Zero Trust](#pathway-b-cloudflare-zero-trust-tunnels)** | Behind NAT/firewalls, residential IPs, enterprise DDoS protection | None (`0`) | Required | Medium |
| **[Pathway C: Tailscale Private Mesh](#pathway-c-tailscale-private-mesh-network)** | Internal enterprise networks, personal homelabs, zero open internet | None (`0`) | MagicDNS / Tailscale | Low |
| **[Pathway D: Split Cloud Hosting](#pathway-d-split-cloud-hosting)** | Serverless frontend (Vercel) + persistent backend (Fly.io/Railway) | Fly.io Managed | Required | Medium |
| **[Pathway E: Local Homelab](#pathway-e-local-homelab--on-premises)** | Offline test rigs, local developer machines, internal LAN | LAN IP | Optional (`.local`) | Very Low |

---

### Pathway A: Single VPS Stack (`deploy/`)

The turnkey production configuration packaged in `deploy/` runs the entire stack on a hardened single Linux instance.

```
Internet ──▶ Nginx (:80/:443) ──┬──▶ apps/web (:3000) ──▶ apps/orchestrator (:4000)
                                 └──▶ apps/orchestrator:4000 (/collab WebSocket)
```

#### Step 1: Automated VPS Server Hardening
Run the automated provisioning script from your local machine to harden SSH, configure UFW, create a dedicated non-root `deploy` user, enable fail2ban, and allocate 4 GB swap:

```bash
# 1. Copy hardening script to the remote host
scp deploy/scripts/setup-vps.sh root@YOUR_SERVER_IP:/root/

# 2. Execute hardening script (replace with your personal SSH public key)
ssh root@YOUR_SERVER_IP 'bash /root/setup-vps.sh \
  --user deploy \
  --ssh-key "$(cat ~/.ssh/id_ed25519.pub)" \
  --swap 4G'
```

Verify you can log in as `deploy` before closing the root session:
```bash
ssh deploy@YOUR_SERVER_IP
```

#### Step 2: Clone Repository & Configure Environment
Log in as the `deploy` user, clone your repository, and initialize the production environment file:

```bash
# Clone repository
git clone https://github.com/monid-ai/sayabot.git ~/sayabot
cd ~/sayabot

# Create locked production environment file
cp deploy/.env.production.example deploy/.env.production
chmod 600 deploy/.env.production
```

Generate your immutable master cryptographic secrets:
```bash
# Generate 32-byte Base64 Key Encryption Key (MESH_KEK)
openssl rand -base64 32

# Generate 32-byte Hex Internal Orchestrator Secret
openssl rand -hex 32
```

Edit `deploy/.env.production` and configure your settings:
```env
MESH_DOMAIN=sayabot.yourcompany.com
LETSENCRYPT_EMAIL=admin@yourcompany.com

# Supabase Credentials (Session Pooler on Port 5432)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
DATABASE_URL=postgresql://postgres.xxxxxxxxxxxx:[PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres

# Master Cryptographic Secrets
MESH_KEK=your_generated_base64_kek_here
ORCHESTRATOR_INTERNAL_SECRET=your_generated_hex_secret_here

# Services to build (web + orchestrator standard; computerd + egress if running Docker sandboxes)
MESH_APP_SERVICES="orchestrator web"
```

#### Step 3: Issue Let's Encrypt TLS Certificate
Make sure your DNS `A` (and optional `AAAA`) records point to the server's public IP address, then request a certificate:

```bash
# Dry-run against Let's Encrypt staging environment
./deploy/scripts/init-letsencrypt.sh --staging

# Issue genuine production certificate
./deploy/scripts/init-letsencrypt.sh --force
```

#### Step 4: Health-Gated Deployment
Run the automated deployment script:
```bash
./deploy/deploy.sh
```

Seed the default database model pricing and starter templates:
```bash
./deploy/deploy.sh seed
```

Your Sayabot instance is now live at `https://sayabot.yourcompany.com`!

---

### Pathway B: Cloudflare Zero Trust Tunnels

Cloudflare Tunnels (`cloudflared`) eliminate open inbound firewall ports. The daemon maintains an outbound connection to Cloudflare edge nodes, routing HTTPS and WebSockets securely while enabling Cloudflare Access (SSO), DDoS protection, and edge caching.

```
Browser ──▶ Cloudflare Edge (WAF, SSL, Access) ──▶ cloudflared daemon ──▶ Sayabot (Local)
```

#### 1. Configure the Cloudflare Tunnel
Install `cloudflared` on your server and authenticate:
```bash
cloudflared tunnel login
cloudflared tunnel create sayabot-tunnel
```

#### 2. Configure Tunnel Ingress Routing
Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_UUID
credentials-file: /etc/cloudflared/YOUR_TUNNEL_UUID.json

ingress:
  # 1. Real-time Collaborative Canvas WebSocket (Hocuspocus)
  - path: ^/collab
    service: ws://127.0.0.1:4000
    originRequest:
      noTLSVerify: true
      connectTimeout: 30s
      noChunkedEncoding: true

  # 2. Universal MCP & External Bot Streamable Endpoints (Disable Proxy Buffering)
  - path: ^/(api/v1|mcp)/
    service: http://127.0.0.1:3000
    originRequest:
      noTLSVerify: true
      connectTimeout: 330s
      noChunkedEncoding: true

  # 3. Web UI, Server Actions, & Static Content
  - service: http://127.0.0.1:3000

  # Catch-all 404 rule
  - service: http_status:404
```

#### 3. Route DNS
Bind your subdomain to the tunnel:
```bash
cloudflared tunnel route dns sayabot-tunnel sayabot.yourcompany.com
```

#### 4. Cloudflare Dashboard Settings
In the Cloudflare dashboard for your domain:
- **Network**: Ensure **WebSockets** is toggled **ON**.
- **SSL/TLS**: Set encryption mode to **Full (Strict)**.
- **Caching**: Create a Cache Rule bypassing cache for `/collab` and `/api/v1/*`.

Run `cloudflared` as a background systemd service:
```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

---

### Pathway C: Tailscale Private Mesh Network

For internal enterprise teams or homelab self-hosters who do not want any presence on the public internet, Sayabot runs natively inside a private Tailscale tailnet.

```
Work Laptop (Tailscale IP) ──── WireGuard Mesh Tunnel ────▶ Sayabot Server (Tailscale IP)
```

#### 1. Install & Authenticate Tailscale
On the host server:
```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname=sayabot-srv
```

#### 2. Generate Private TLS Certificate
Tailscale can automatically issue valid Let's Encrypt TLS certificates for machines on your tailnet:
```bash
sudo tailscale cert sayabot-srv.your-tailnet.ts.net
```

#### 3. Configure Compose for Tailscale Ingress
In your `deploy/.env.production`, set:
```env
MESH_DOMAIN=sayabot-srv.your-tailnet.ts.net
NEXT_PUBLIC_SITE_URL=https://sayabot-srv.your-tailnet.ts.net
NEXT_PUBLIC_COLLAB_URL=wss://sayabot-srv.your-tailnet.ts.net/collab
```

Now, only authenticated devices logged into your Tailscale tailnet can access the workspace, collaborate on canvases, or connect via MCP!

---

### Pathway D: Split Cloud Hosting

For teams seeking serverless economics for the web application while maintaining high-availability compute for the orchestrator turn loop.

- **Frontend (`apps/web`)**: Hosted on Vercel.
- **Orchestrator (`apps/orchestrator`)**: Hosted on Fly.io, Railway, or Render.
- **Database**: Managed Supabase.

```
Browser ──▶ Vercel (apps/web) ──── HTTP ────▶ Fly.io (apps/orchestrator:4000)
   │                                                 ▲
   └─────────────── WSS: wss://orch.fly.dev/collab ──┘
```

#### 1. Deploy Orchestrator to Fly.io
Create `fly.toml` in the repository root:

```toml
app = "sayabot-orchestrator"
primary_region = "iad"

[build]
  dockerfile = "deploy/docker/orchestrator.Dockerfile"

[http_service]
  internal_port = 4000
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[[vm]]
  size = "shared-cpu-2x"
  memory = "2048mb"

[checks]
  [checks.health]
    port = 4000
    type = "http"
    path = "/health"
    interval = "15s"
    timeout = "5s"
```

Set production secrets in Fly.io:
```bash
fly secrets set \
  DATABASE_URL="postgresql://postgres.xxx:pass@aws-0-region.pooler.supabase.com:5432/postgres" \
  NEXT_PUBLIC_SUPABASE_URL="https://xxx.supabase.co" \
  NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ..." \
  SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
  MESH_KEK="your_base64_kek" \
  ORCHESTRATOR_INTERNAL_SECRET="your_hex_secret"
```

Deploy the orchestrator:
```bash
fly deploy
```

#### 2. Deploy Web App to Vercel
1. Import the Git repository into Vercel.
2. Configure Project Settings:
   - **Root Directory**: `.`
   - **Framework Preset**: Next.js
   - **Build Command**: `pnpm --filter @sayabot/web build`
   - **Install Command**: `pnpm install`
3. Configure Environment Variables in Vercel:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   DATABASE_URL=postgresql://postgres.xxx:pass@aws-0-region.pooler.supabase.com:5432/postgres
   MESH_KEK=your_base64_kek
   ORCHESTRATOR_INTERNAL_SECRET=your_hex_secret
   ORCHESTRATOR_URL=https://sayabot-orchestrator.fly.dev
   NEXT_PUBLIC_SITE_URL=https://sayabot.yourcompany.com
   NEXT_PUBLIC_COLLAB_URL=wss://sayabot-orchestrator.fly.dev/collab
   ```
4. Deploy the project.

---

### Pathway E: Local Homelab & On-Premises

To run Sayabot on a local home server, Mac Studio, or bare-metal machine:

```bash
# 1. Clone & install dependencies
git clone https://github.com/monid-ai/sayabot.git
cd sayabot
pnpm install

# 2. Configure .env from example template
cp .env.example .env

# Generate keys
openssl rand -base64 32  # Add to MESH_KEK
openssl rand -hex 32     # Add to ORCHESTRATOR_INTERNAL_SECRET

# 3. Apply database migrations
pnpm db:migrate
pnpm db:seed

# 4. Run development or production processes
pnpm dev
```

- Web UI: `http://localhost:3000`
- Orchestrator API: `http://localhost:4000`
- Live Canvas WebSocket: `ws://localhost:4000/collab`

To access from other devices on your local Wi-Fi or LAN, bind to `0.0.0.0` and set `NEXT_PUBLIC_SITE_URL=http://192.168.1.X:3000` and `NEXT_PUBLIC_COLLAB_URL=ws://192.168.1.X:4000/collab`.

---

## 4. Database & Supabase Engine Setup

Sayabot utilizes PostgreSQL as a unified state engine, task queue, and event fabric.

### The Pooler Dilemma: Session Pooler (5432) vs. Transaction Pooler (6543)

> [!CAUTION]
> **CRITICAL CONFIGURATION RULE**: Always connect Sayabot to the Supabase **Session Pooler on Port 5432**, or connect directly to PostgreSQL. **NEVER use the Transaction Pooler (port 6543)** for `DATABASE_URL`.

```
                    ┌────────────────────────────────────────────────────────┐
                    │               Supabase Connection Pooler               │
                    └───────────┬────────────────────────────────┬───────────┘
                                │                                │
                   Port 5432: Session Mode          Port 6543: Transaction Mode
                                │                                │
                                ▼                                ▼
                   ┌────────────────────────┐       ┌────────────────────────┐
                   │  Pinned TCP Connection │       │ Pooled Per-Transaction │
                   └───────────┬────────────┘       └───────────┬────────────┘
                               │                                │
        Supports:              ▼             Fails Under:       ▼
        • pg_try_advisory_lock()             • Advisory locks lost mid-turn!
        • LISTEN / NOTIFY                    • LISTEN silently ignored!
        • pg-boss long polling               • Multiple agents fire overlapping turns!
        • Prepared statements                • Broken real-time interrupt handling!
```

**Why Transaction Pooling Fails with Sayabot**:
1. **Advisory Locks (`pg_try_advisory_lock`)**: When orchestrating multi-agent turns, Sayabot acquires session-level advisory locks (`mesh:room:<id>`). In transaction mode (port 6543), connections are recycled between queries, releasing locks prematurely and causing race conditions and runaway loops.
2. **`LISTEN / NOTIFY` Event Bus**: Human interruptions (`mesh_room_interrupt`) and stop signals (`mesh_stop_run`) rely on long-lived `LISTEN` channels. Transaction poolers reject or fail to deliver asynchronous NOTIFY signals.
3. **`pg-boss` Distributed Worker Queue**: The job scheduler keeps dedicated worker connections open for message dispatching.

### Applying Migrations & SQL Architecture

Sayabot utilizes a dual-layer migration strategy:
1. **Drizzle ORM Schema Migrations**: Relational tables (`packages/db/migrations/`).
2. **Idempotent PostgreSQL Scripting**: Custom SQL scripts (`packages/db/sql/`) that set up RLS policies, CDC publications, functions, and triggers.

To apply migrations manually:
```bash
pnpm db:migrate
```

To seed standard model prices and agent templates:
```bash
pnpm db:seed
```

#### Migration Script Manifest (`packages/db/sql/`)

```
0001_functions.sql              # Organization membership & auth user synchronization triggers
0002_rls.sql                    # Strict multi-tenant Row Level Security policies
0003_realtime.sql               # Supabase Realtime CDC publication on realtime.messages
0004_rpc.sql                    # Atomic RPCs for human danger tool approval notifications
0005_ia.sql                     # Information architecture schemas (meetings, schedules, tasks)
0006_push.sql                   # Web Push VAPID subscriptions schema
0007_agent_reads.sql            # Per-user unread tracking and agent notification reads
0008_task_integrity.sql         # Atomic task assignment, claiming, and transition guards
0009_bot_platform.sql           # Inbound MCP server tokens, external webhook credentials
0010_engine.sql                 # Advisory lock tracking, run checkpoints, and breakers
0011_memory.sql                 # Multi-tier memory tables (personal, room, organization)
0012_permissions_fix.sql        # Authenticated role permissions alignment
0013_auth_oauth_profiles.sql    # OAuth profile sync triggers for Google and GitHub
0014_routines.sql               # Hermes-class cron routines, schedule nodes, audit runs
0015_agent_templates_unique.sql # Standard system agent templates
0016_cognitive_memory.sql       # Vector embeddings & semantic recall engine
0017_vector_providers.sql       # Vector database credentials and provider configuration
0018_workspace_connectors.sql   # Universal MCP connector grants and permissions
```

### Row Level Security (RLS) & Realtime Publication

Sayabot isolates all tenant data at the database engine level. Every table enforces RLS checking `auth.uid()` against `organization_members`.

The Supabase Realtime publication is configured specifically for scoped room channels:
```sql
-- Publication configuration from 0003_realtime.sql
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE routine_runs;

-- Realtime authorization policy for private room channels
CREATE POLICY "Users can subscribe to their room channels"
ON realtime.messages FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM room_members
    WHERE room_members.room_id = (string_to_array(realtime.topic(), ':'))[2]::uuid
    AND room_members.user_id = auth.uid()
  )
);
```

### Authentication & OAuth Configuration

In your Supabase project dashboard (**Authentication → URL Configuration**):

1. **Site URL**: `https://sayabot.yourcompany.com`
2. **Redirect Allowlist**:
   - `https://sayabot.yourcompany.com/auth/callback`
   - `https://sayabot.yourcompany.com/auth/complete`
   - `http://localhost:3000/auth/callback` (for local development)
   - `http://localhost:3000/auth/complete`
3. **Email Templates**:
   - Ensure the **Confirm signup** template contains the 6-digit confirmation token `{{ .Token }}` in addition to the URL link:
     ```html
     <h2>Confirm your signup</h2>
     <p>Your 6-digit verification code is: <strong>{{ .Token }}</strong></p>
     <p><a href="{{ .ConfirmationURL }}">Click here to verify your account</a></p>
     ```
4. **OAuth Providers (Optional)**:
   - **Google**: Configure OAuth Client ID and Secret in Supabase, then set `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=true` in `deploy/.env.production`.
   - **GitHub**: Configure OAuth App in Supabase, then set `NEXT_PUBLIC_GITHUB_AUTH_ENABLED=true`.
   - **Enterprise SAML SSO**: Configure in Supabase Pro, then set `NEXT_PUBLIC_SSO_ENABLED=true`.

---

## 5. Environment Variables & Secret Vaults

### Key Encryption Key (`MESH_KEK`) & In-Flight Token Swapping

Sayabot employs zero-plaintext credential storage. All third-party provider keys (OpenAI, Anthropic, Tavily, AWS, GitHub PATs) and external MCP connection headers are sealed using AES-256-GCM before writing to PostgreSQL.

```
Plaintext API Key ──▶ AES-256-GCM Encrypt(MESH_KEK) ──▶ vault:v1:<iv>:<tag>:<ciphertext>
```

> [!WARNING]
> **Immutability of `MESH_KEK`**: Do NOT rotate or alter `MESH_KEK` without running an explicit re-encryption migration script across the `vaults`, `mcp_servers`, and `agent_credentials` tables. If `MESH_KEK` is lost, all stored credentials become permanently unrecoverable.

### Build-Time Inlining (`NEXT_PUBLIC_*`) vs. Runtime Variables

Next.js inlines environment variables prefixed with `NEXT_PUBLIC_` **directly into client JavaScript bundles at compile time**.

- Modifying `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SITE_URL`, or `MESH_DOMAIN` **requires rebuilding the Docker image** (`./deploy/deploy.sh`).
- Modifying runtime backend secrets (`SUPABASE_SERVICE_ROLE_KEY`, `E2B_API_KEY`, etc.) only requires restarting the containers:
  ```bash
  docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml up -d
  ```

### Complete Environment Variable Dictionary

| Variable Name | Target Service | Mandatory? | Default Value | Description |
| :--- | :--- | :---: | :--- | :--- |
| `MESH_DOMAIN` | Nginx, Web, Docker | **Yes** | `mesh.example.com` | Public FQDN where Sayabot is accessible. |
| `LETSENCRYPT_EMAIL` | Certbot | **Yes** | `ops@example.com` | Email for Let's Encrypt renewal & expiration notifications. |
| `NEXT_PUBLIC_SUPABASE_URL` | Web, Orchestrator | **Yes** | `https://xxxx.supabase.co` | Supabase API URL. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web (Browser & SSR) | **Yes** | — | Supabase public anonymous API key. |
| `SUPABASE_SERVICE_ROLE_KEY` | Web, Orchestrator | **Yes** | — | High-privilege Supabase key. **Never expose to client.** |
| `DATABASE_URL` | Web, Orchestrator, DB | **Yes** | — | PostgreSQL connection string (**Port 5432 Session Pooler**). |
| `MESH_KEK` | Web, Orchestrator | **Yes** | — | 32-byte Base64 key for AES-256-GCM secret vault encryption. |
| `ORCHESTRATOR_INTERNAL_SECRET` | Web, Orchestrator, Computerd | **Yes** | — | 32-byte Hex secret authenticating internal `/internal/*` routes. |
| `ORCHESTRATOR_URL` | Web | Auto | `http://orchestrator:4000` | Internal URL for web server actions to reach the turn engine. |
| `NEXT_PUBLIC_SITE_URL` | Web | Auto | `https://${MESH_DOMAIN}` | Public web URL for auth callbacks and invite links. |
| `NEXT_PUBLIC_COLLAB_URL` | Web | Auto | `wss://${MESH_DOMAIN}/collab` | Public WebSocket endpoint for Yjs live canvas sync. |
| `COMPUTERD_URL` | Orchestrator | Optional | `http://computerd:4100` | Internal URL for sandbox daemon. |
| `EGRESS_URL` | Orchestrator | Optional | `http://egress:8081` | Internal URL for secret broker admin API. |
| `EGRESS_PROXY_URL` | Orchestrator | Optional | `http://egress:8080` | Internal HTTP proxy URL for outbound sandbox traffic. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web, Orchestrator | Optional | — | Web Push VAPID public key for offline alerts. |
| `VAPID_PRIVATE_KEY` | Orchestrator | Optional | — | Web Push VAPID private key. |
| `VAPID_SUBJECT` | Orchestrator | Optional | `mailto:admin@example.com` | Subject contact URL or mailto for push services. |
| `NEXT_PUBLIC_GOOGLE_AUTH_ENABLED`| Web | Optional | `false` | Enable Google OAuth login button. |
| `NEXT_PUBLIC_GITHUB_AUTH_ENABLED`| Web | Optional | `false` | Enable GitHub OAuth login button. |
| `NEXT_PUBLIC_SSO_ENABLED` | Web | Optional | `false` | Enable Enterprise SAML SSO login button. |
| `DEV_OPENAI_COMPAT_BASE_URL` | Orchestrator | Optional | — | Fallback OpenAI-compatible endpoint (Ollama, vLLM, Groq). |
| `DEV_OPENAI_COMPAT_API_KEY` | Orchestrator | Optional | — | API key for fallback endpoint. |
| `DEV_OPENAI_COMPAT_MODEL` | Orchestrator | Optional | — | Default model identifier for seeded bots. |
| `BRAVE_SEARCH_API_KEY` | Orchestrator | Optional | — | Free/Paid Brave Search API key for agent web search. |
| `E2B_API_KEY` | Orchestrator | Optional | — | E2B cloud sandbox provider key (alternative to `computerd`). |
| `MESH_ALLOW_PRIVATE_WEBHOOKS` | Orchestrator | Dev Only | `false` | Allow webhooks to private RFC-1918 IPs. **Must be false in prod.** |
| `MESH_WEB_MEMORY` | Docker Compose | Optional | `1g` | Memory allocation limit for `web` container. |
| `MESH_ORCHESTRATOR_MEMORY` | Docker Compose | Optional | `1g` | Memory allocation limit for `orchestrator` container. |

---

## 6. Reverse Proxy, Networking & WebSocket Tuning

### Nginx Configuration Deep Dive

The Nginx configuration template (`deploy/nginx/templates/mesh.conf.template`) is rendered dynamically on startup using `envsubst`:

```nginx
# Upstream definitions with keepalive connections
upstream mesh_web {
    zone mesh_web 64k;
    server web:3000;
    keepalive 32;
}

upstream mesh_orchestrator {
    zone mesh_orchestrator 64k;
    server orchestrator:4000;
    keepalive 8;
}

server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    http2 on;
    server_name _;
    # Reject unrecognized Host headers
    return 444;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name ${MESH_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${MESH_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${MESH_DOMAIN}/privkey.pem;

    include /etc/nginx/snippets/security-headers.conf;
    limit_conn mesh_conn 100;

    # 1. Canvas Realtime WebSocket (Hocuspocus)
    location = /collab {
        include /etc/nginx/snippets/proxy.conf;
        proxy_pass http://mesh_orchestrator;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        proxy_buffering off;
    }

    # 2. Universal MCP Gateway & External Bot API (Streaming SSE/NDJSON)
    location ~ ^/(api/v1|mcp)/ {
        limit_req zone=mesh_api burst=60 nodelay;
        include /etc/nginx/snippets/proxy.conf;
        proxy_pass http://mesh_web;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_cache off;
        proxy_read_timeout 330s;
        proxy_send_timeout 330s;
        add_header X-Accel-Buffering no;
    }

    # 3. Liveness Check
    location = /api/health {
        access_log off;
        include /etc/nginx/snippets/proxy.conf;
        proxy_pass http://mesh_web;
    }

    # 4. Auth & Rate-Guarded Routes
    location ~ ^/(login|signup|forgot-password|reset-password|auth)(/|$) {
        limit_req zone=mesh_auth burst=20 nodelay;
        include /etc/nginx/snippets/proxy.conf;
        proxy_pass http://mesh_web;
    }

    # 5. Immutable Static Assets
    location /_next/static/ {
        include /etc/nginx/snippets/proxy.conf;
        proxy_pass http://mesh_web;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 6. Default App Catch-All
    location / {
        limit_req zone=mesh_general burst=50 nodelay;
        include /etc/nginx/snippets/proxy.conf;
        proxy_pass http://mesh_web;
    }
}
```

### Hocuspocus WebSocket Upgrade (`/collab`)

Live documents, collaborative code editing, and shared diagrams rely on **Yjs CRDTs** multiplexed through Hocuspocus over WebSockets.

Key requirements for `/collab`:
- `Upgrade: $http_upgrade` and `Connection: "upgrade"` headers passed upstream.
- `proxy_buffering off;` to prevent chunking or delayed dispatch of CRDT sync vectors.
- `proxy_read_timeout 1h;` to prevent idle proxies from prematurely terminating active collaborative sessions.

### Unbuffered Streaming for SSE & NDJSON (`/api/v1/*`, `/mcp/*`)

External bot webhooks, agent thinking traces, and MCP tool responses stream continuously as Server-Sent Events (SSE) or line-delimited JSON (NDJSON).

- `proxy_buffering off;` and `proxy_request_buffering off;` allow immediate chunk forwarding without waiting for the model to finish its complete response.
- `add_header X-Accel-Buffering no;` instructs downstream reverse proxies (like Cloudflare or client gateways) not to buffer responses.
- `proxy_read_timeout 330s;` accommodates deep reasoning loops (o1/o3/Sonnet-thinking) that may take multiple minutes to emit tool calls.

### Alternative: Caddyfile Configuration

If using **Caddy** instead of Nginx:

```caddy
sayabot.yourcompany.com {
    # 1. Hocuspocus Live Canvas WebSocket
    @collab path /collab
    handle @collab {
        reverse_proxy orchestrator:4000 {
            transport http {
                keepalive 1h
            }
        }
    }

    # 2. Universal MCP & Bot API Streamable Proxy
    @mcp path_regexp ^/(api/v1|mcp)/
    handle @mcp {
        reverse_proxy web:3000 {
            flush_interval -1
            transport http {
                response_header_timeout 330s
            }
        }
    }

    # 3. Web UI & Next.js App
    handle {
        reverse_proxy web:3000
    }
}
```

---

## 7. Sandboxes, Computer Use (`computerd`) & Browser CDP

Sayabot gives agents the ability to write code, execute bash scripts, inspect filesystems, and control web browsers in isolated environments.

### Persistent `/home/bot` Linux Sandboxes

When an agent is configured with the `computer` capability, `computerd` provisions an isolated Docker container with a dedicated Docker volume mounted at `/home/bot`:

- Files placed in `/home/bot` persist across chat turns, server restarts, and scheduled cron executions.
- Standard tools available in sandbox: `git`, `curl`, `jq`, `python3`, `node`, `ripgrep`, `tar`, `make`.
- High-risk operations (`rm -rf`, disk manipulation, unauthorized outbound calls) pause execution and trigger a **Human Approval Card** in the room.

### Docker Socket Security Hardening

The `computerd` daemon connects to `/var/run/docker.sock` to control worker containers:

```yaml
# deploy/docker-compose.yml excerpt
computerd:
  user: "0:0"
  image: mesh/computerd:latest
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - ALL
  read_only: true
  volumes:
    - /var/run/docker.sock:/var/run/docker.sock
```

To limit Docker socket privileges, you can deploy a Docker socket proxy (such as `tecnativa/docker-socket-proxy`) allowing only `POST /containers/*` and `GET /containers/*` while blocking access to volumes, networks, or host filesystems.

### Headless Chromium CDP vs. Cloudflare Browser Rendering

Sayabot supports two headless browser automation backends for agents:

1. **Local Dockerized Chromium CDP (`computerd`)**:
   - Runs a local headless Chromium instance inside the agent's Linux container.
   - Connected via Chrome DevTools Protocol on port `9222`.
   - Supports screenshot captures, visual page diffs, DOM inspection, clicking, and typing.

2. **Cloudflare Serverless Browser Rendering**:
   - Zero local memory footprint.
   - Connects to Cloudflare's serverless browser fleet via WebSocket endpoint:
     ```
     wss://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/browser-rendering/devtools/browser
     ```
   - Configured simply by adding `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` to your environment.

### Egress Secret Broker & SSRF Firewall

The `apps/egress` service acts as an outbound security boundary:

```
Agent Sandbox (Token: saaya_ph_9x12...) ──▶ apps/egress:8080 ──▶ Internet (Real Token Injected)
```

1. **Placeholder Tokenization**: Plaintext credentials are never visible in the sandbox environment. The environment variable `$GITHUB_TOKEN` contains an opaque string like `saaya_ph_9x12a8f...`.
2. **In-Flight Swapping**: As the agent executes `curl` or `git`, the egress proxy inspects the request headers, matches the placeholder, verifies the destination host is allowlisted, and replaces it with the genuine token decrypted from the AES-256 vault.
3. **SSRF Blocking**: The proxy resolves DNS destinations and forcibly blocks:
   - `127.0.0.0/8` (Localhost)
   - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (Private RFC-1918 ranges)
   - `169.254.169.254` (Cloud Instance Metadata Service)

---

## 8. Universal MCP Gateway & External Client Connectors

Sayabot's **Universal Model Context Protocol (MCP)** gateway allows your self-hosted agents to collaborate with external AI tools and developer environments.

Endpoint:
```
https://sayabot.yourcompany.com/mcp/:token
```

To generate a token: Navigate to **Agent Settings** (`/[org]/agents/[handle]` → **API Tokens**) and generate a new key.

### Connecting Claude Desktop

Edit your `claude_desktop_config.json`:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "sayabot": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://sayabot.yourcompany.com/mcp/YOUR_AGENT_API_TOKEN"
      ]
    }
  }
}
```

### Connecting Claude Code CLI

Register your self-hosted Sayabot instance directly in the Claude Code command-line tool:

```bash
claude mcp add --transport http sayabot https://sayabot.yourcompany.com/mcp/YOUR_AGENT_API_TOKEN
```

Verify connection:
```bash
claude mcp list
```

### Connecting Cursor & Windsurf

In your project root, create or edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sayabot": {
      "url": "https://sayabot.yourcompany.com/mcp/YOUR_AGENT_API_TOKEN"
    }
  }
}
```

### Connecting OpenAI ChatGPT (Custom GPT Actions)

1. Open ChatGPT → **Explore GPTs** → **Create a GPT**.
2. Go to **Configure** → **Actions** → **Create new action**.
3. Under **Authentication**, select **API Key** (Auth Type: Bearer), and paste your Agent API Token.
4. Set the Schema Import URL to:
   ```
   https://sayabot.yourcompany.com/api/v1/mcp/openapi.json
   ```
5. Your custom GPT can now post messages, trigger agent turns, inspect tasks, and collaborate on canvases in your self-hosted Sayabot rooms!

### Connecting Hermes Agent CLI

Connect the Nous Research Hermes CLI directly to your self-hosted room:

```bash
hermes mcp add sayabot https://sayabot.yourcompany.com/mcp/YOUR_AGENT_API_TOKEN
```

---

## 9. Day-2 Operations, Backups & Maintenance

### Zero-Downtime Rolling Deploys with `deploy.sh`

The deployment manager (`deploy/deploy.sh`) provides automated rollout lifecycle management:

```bash
# Deploy whatever git commit is currently checked out
./deploy/deploy.sh

# Deploy a specific tag or branch
./deploy/deploy.sh --ref v1.2.0

# Deploy pulling pre-built images from GHCR / Docker Hub
./deploy/deploy.sh --ref v1.2.0 --pull

# Run database migrations only
./deploy/deploy.sh migrate

# View operational status and container health
./deploy/deploy.sh status

# Follow real-time container logs
./deploy/deploy.sh logs web
./deploy/deploy.sh logs orchestrator
```

### Automated Rollback Safeguards

Every deployment records the previous release's image digests in `deploy/.releases`.

During a rollout:
1. Migrations are executed first.
2. The `orchestrator` container is recreated and tested against its internal `/health` check.
3. The `web` container is recreated and tested against `/api/health`.
4. Nginx is reloaded and an end-to-end HTTPS check is performed against `https://${MESH_DOMAIN}/api/health`.
5. **If any check fails or times out**, `deploy.sh` aborts the rollout, restores the previous release images, and issues an alert!

To manually roll back to the previous release at any time:
```bash
./deploy/deploy.sh rollback
```

Or roll back to a specific commit SHA:
```bash
./deploy/deploy.sh rollback a1b2c3d
```

### Disaster Recovery & Database Backups

Because all canvas Yjs states, room messages, tasks, and routines are stored in PostgreSQL, backing up the database creates a complete snapshot of your Sayabot instance.

#### 1. Daily PostgreSQL Backup Script
Create `/etc/cron.daily/sayabot-backup`:

```bash
#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="/var/backups/sayabot"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Source database URL from production env file
DATABASE_URL=$(grep '^DATABASE_URL=' /home/deploy/sayabot/deploy/.env.production | cut -d= -f2-)

# Execute custom format compressed pg_dump
pg_dump -d "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --file="$BACKUP_DIR/sayabot_$TIMESTAMP.dump"

# Retain backups for 14 days
find "$BACKUP_DIR" -type f -name "sayabot_*.dump" -mtime +14 -delete
```
Make executable:
```bash
sudo chmod +x /etc/cron.daily/sayabot-backup
```

#### 2. Restoring from Backup
```bash
# 1. Stop active orchestrator to prevent writes
./deploy/deploy.sh down

# 2. Restore database
pg_restore -d "$DATABASE_URL" --clean --if-exists /var/backups/sayabot/sayabot_TIMESTAMP.dump

# 3. Bring services back up
./deploy/deploy.sh
```

### Log Aggregation & Health Monitoring

To monitor Sayabot with uptime services (Better Stack, UptimeRobot, Datadog):
- **Health Check Endpoint**: `https://sayabot.yourcompany.com/api/health`
- **Expected Status**: `200 OK`
- **Response**: `{"ok":true,"timestamp":"..."}`

To view live Docker logs:
```bash
docker compose --env-file deploy/.env.production -f deploy/docker-compose.yml logs -f --tail=100 web orchestrator
```

---

## 10. Comprehensive Troubleshooting Matrix

| Symptom | Root Cause | Exact Remediation |
| :--- | :--- | :--- |
| **Canvas never connects (`wss://.../collab` fails)** | 1. Proxy stripped WebSocket headers.<br>2. Domain mismatch in build bundle.<br>3. Orchestrator process crashed. | 1. Verify `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` are active in Nginx.<br>2. Ensure `NEXT_PUBLIC_COLLAB_URL` matches the public domain. Remember that changing `MESH_DOMAIN` requires a full image rebuild (`./deploy/deploy.sh`).<br>3. Inspect logs: `./deploy/deploy.sh logs orchestrator`. |
| **Orchestrator enters restart loop** | `DATABASE_URL` connects to the transaction pooler on port 6543 instead of session pooler (5432). | Edit `deploy/.env.production`. Change port `6543` to `5432` in your Supabase connection string. Run `./deploy/deploy.sh restart orchestrator`. |
| **Build killed with `Exit 137` (Out Of Memory)** | Next.js webpack compilation exceeded physical memory limit during Docker build. | 1. Check swap: `swapon --show`. If missing, add 4 GB swap: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`.<br>2. Alternatively, build in CI (GitHub Actions) with `MESH_IMAGE_PREFIX=ghcr.io/yourorg/sayabot` and deploy with `./deploy/deploy.sh --pull`. |
| **Postgres Error: `permission denied for schema public` or RLS Violation** | Missing SQL migrations or unapplied role permissions. | Run database migrations explicitly: `./deploy/deploy.sh migrate`. Verify that the migration runner completed all files through `0018_workspace_connectors.sql`. |
| **Decryption Error: `Unsupported state or unable to authenticate data`** | `MESH_KEK` was rotated or differs from the key used when credentials were encrypted. | Restore the original `MESH_KEK` value from your secure password manager backup. Decryption is cryptographically authenticated; ciphertexts cannot be read with any other key. |
| **MCP Client returns `401 Unauthorized`** | Expired, revoked, or malformed Agent Token in request URL. | Ensure the URL format is `https://DOMAIN/mcp/mesh_ak_...`. Generate a fresh Agent API key under **Agent Settings → API Tokens**. |
| **HTTP 429 Too Many Requests** | Exceeded Nginx rate limits defined in `deploy/nginx/nginx.conf`. | Increase rate limit burst values in `deploy/nginx/nginx.conf` (`mesh_api`, `mesh_auth`, `mesh_general`), then reload Nginx: `docker compose ... exec nginx nginx -s reload`. |
| **Certbot failure: `Challenge failed for domain`** | DNS A record does not resolve to the server IP or port 80 is blocked by a firewall. | 1. Verify DNS: `dig +short A yourdomain.com`.<br>2. Check firewall: `sudo ufw allow 80/tcp && sudo ufw allow 443/tcp`.<br>3. Ensure no standalone Apache/Caddy service is currently bound to port 80. |
| **Webhook SSRF Error: `Blocked private network IP`** | Bot webhook points to `localhost` or an RFC-1918 internal IP address. | In production, outbound webhooks to private subnets are blocked by default. For local development testing only, set `MESH_ALLOW_PRIVATE_WEBHOOKS=true` in `.env.production`. |
| **Realtime messages not updating in browser** | Supabase Realtime publication missing for room channels. | Run `pnpm db:migrate` to ensure `0003_realtime.sql` applied. In Supabase Dashboard, verify **Realtime** is toggled **ON** for the `messages` table. |

---

## 11. Production Hardening Checklist

Before announcing your self-hosted Sayabot instance to team members or external clients, verify this pre-flight security checklist:

- [ ] **SSH Hardened**: Key-only authentication enforced; password login disabled (`PasswordAuthentication no`).
- [ ] **UFW Firewall Active**: Only ports `22` (or custom SSH port), `80`, and `443` are open.
- [ ] **File Permissions**: `chmod 600 deploy/.env.production` is strictly enforced.
- [ ] **Secret Backups**: `MESH_KEK` and `ORCHESTRATOR_INTERNAL_SECRET` are securely stored in a team password manager (1Password, Bitwarden, Vault).
- [ ] **Database Connection**: `DATABASE_URL` connects exclusively to the **Session Pooler (port 5432)**.
- [ ] **TLS Certificate**: Domain graded **A or A+** on [Qualys SSL Labs](https://www.ssllabs.com/ssltest/).
- [ ] **Supabase Security**: Row Level Security (RLS) enabled on all 24+ database tables; service role key is never bundled in frontend code.
- [ ] **Health Monitoring**: External monitoring service (Better Stack, UptimeRobot) pinging `https://${MESH_DOMAIN}/api/health` every 60 seconds.
- [ ] **Automated Backups**: Nightly compressed `pg_dump` jobs active with verified off-site retention.
- [ ] **Swap Memory**: At least 4 GB swap configured to safeguard against compiler spikes.

---

*Need help or want to share your deployment setup? Join the [Sayabot Community Discussions](https://github.com/monid-ai/sayabot/discussions) or read the [Architecture Deep Dive](architecture.md).*
