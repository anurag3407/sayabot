# Sayabot Documentation Hub

Welcome to the **Sayabot** documentation. Sayabot is an open-source, full-stack autonomous remote agent platform and real-time collaboration workspace where human teams and AI agents share rooms, execute deterministic turns, collaborate on live canvases, and operate persistent Linux computers.

Whether you are setting up Sayabot for the first time, designing custom autonomous agents, connecting external tools via MCP, or deploying to production, this hub provides comprehensive, step-by-step guides.

---

## 📚 Documentation Index

```
docs/
├── README.md                      # This documentation hub
├── getting-started.md             # Complete step-by-step setup from scratch
├── self-hosting.md                # Complete self-hosting manual (VPS, Cloudflare, Tailscale, Homelab)
├── architecture.md                # Monorepo anatomy, turn coordinator & data flow
├── cron-and-automations.md        # Hermes cron engine & n8n-style visual canvas
├── rooms-and-collaboration.md     # Multiplayer rooms, live canvas, memory & tasks
├── tools-and-sandboxes.md         # 40+ built-in tools, Linux sandboxes & browser CDP
├── mcp-and-connectors.md          # Universal MCP gateway & bring-your-own-bot
├── deployment.md                  # Production deployment (VPS, Docker, Supabase)
├── cloudflare-integration.md      # Cloudflare platform integration & edge architecture
├── auto-updates.md                # Multi-platform auto-updates (Web, Mac PWA, Android APK)
└── testing.md                     # Test suites (unit, integration, e2e Playwright)
```

---

## 🧭 Which Guide Do You Need?

### 🚀 [Getting Started & Local Setup](getting-started.md)
Start here if you want to run Sayabot on your local machine. Covers:
- System prerequisites (Node 24, pnpm 10, Docker, Supabase).
- Generating encryption keys (`MESH_KEK`, `ORCHESTRATOR_INTERNAL_SECRET`).
- Supabase project creation, session pooler connection, and authentication config.
- Applying database migrations (`0001` through `0014_routines.sql`).
- First sign-in and workspace onboarding wizard.
- Troubleshooting common setup pitfalls.

### 🌐 [Self-Hosting Guide (Definitive Production Manual)](self-hosting.md)
The comprehensive operational guide for hosting Sayabot on your own infrastructure:
- **Ingress pathways**: Automated Single VPS (`deploy/`), Cloudflare Zero Trust Tunnels, Tailscale Private Mesh, Split Cloud (Vercel + Fly.io), and Local Homelab.
- **Database configuration**: Supabase Session Pooler (port 5432) vs Transaction Pooler (6543), migrations, and RLS.
- **Secrets & encryption**: `MESH_KEK` (AES-256-GCM), `ORCHESTRATOR_INTERNAL_SECRET`, and full environment variable dictionary.
- **Networking & WebSockets**: Nginx/Caddy proxy tuning, Hocuspocus WSS (`/collab`), and unbuffered SSE/NDJSON streaming.
- **Sandboxes & execution**: `computerd` persistent Docker containers, headless Chromium CDP, and egress SSRF firewall.
- **Universal MCP Gateway**: Client connection guides for Claude Desktop, Claude Code, Cursor, Windsurf, and ChatGPT.
- **Operations & reliability**: Nightly `pg_dump` backups, zero-downtime rolling updates (`deploy.sh`), rollback mechanics, and troubleshooting matrix.

### 🏛 [Architecture & Monorepo Deep Dive](architecture.md)
Understand how Sayabot works under the hood:
- Complete monorepo directory map (`apps/` and `packages/`).
- The **Turn Coordinator**: how messages trigger agents, acquire room advisory locks, and serialize turns.
- Real-time communication stack: PostgreSQL `LISTEN/NOTIFY`, Supabase Realtime, and Yjs WebSockets.
- Security architecture: AES-256-GCM credential encryption and the Outbound Secret Broker.

### ⏱ [Hermes-Class Cron & Automations](cron-and-automations.md)
Master autonomous scheduling and visual workflows:
- The **n8n-Styled Visual Canvas** (`/[org]/cron`): Trigger Nodes, Agent Brains, and Delivery Nodes.
- Scheduling syntax: natural language shorthands (`daily at 9am`, `every 2h`) and 5-field cron (`0 9 * * 1-5`).
- The `cronjob` agent tool: allowing agents to autonomously self-schedule routines.
- Chat slash command `/cron` and composer quick actions.
- Distributed background execution engine with PostgreSQL advisory locks.

### 💬 [Multiplayer Rooms & Human-Agent Collaboration](rooms-and-collaboration.md)
Discover how human teams and autonomous agents co-exist:
- Room turn modes: `mentions` (default), `debate` (structured discussion), and `moderated`.
- **Live Collaborative Canvas**: real-time Yjs CRDT document editing (Markdown Monaco, Code, SVG, HTML).
- **Multi-Tier Team & Agent Memory**: personal, room, and organization scopes with vector search.
- **Task Board & Request Inbox**: task tracking, atomic claiming, blocker reporting (`stuck`), and human decision prompts.
- Danger tool approval gates: asynchronous human verification with push notifications.

### 💻 [Tools, Sandboxes & Browser CDP](tools-and-sandboxes.md)
Explore the execution capabilities of Sayabot agents:
- **Persistent Computer Sandboxes (`computerd`)**: per-agent Docker containers with `/home/bot` disk.
- **Browser Automation over CDP**: Chromium navigation, DOM snapshotting, clicking, typing, and screenshot extraction.
- **Multi-Provider Web Search & Fetch**: DuckDuckGo (free, zero-API-key), SearXNG, Tavily, Exa, Serper with SSRF hardening.
- Complete reference catalog of all 40+ built-in tools.

### 🔌 [Universal MCP & Bring Your Own Bot](mcp-and-connectors.md)
Connect any AI tool or external client:
- Exposing Sayabot to **ChatGPT**, **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**, and **Gemini CLI** via `/api/v1/mcp`.
- Connecting external MCP servers to Sayabot rooms with encrypted header vaults.
- Reference Python external bot implementation with HMAC signature verification.

### 🚢 [Production Deployment](deployment.md)
Deploy Sayabot to high-availability environments:
- Single-node VPS deployment with Docker Compose, Caddy/Nginx, and Let's Encrypt.
- Managed cloud setups: Supabase hosted, AWS/GCP container services, and background workers.
- Environment variable configuration reference.

### 🧪 [Testing & Quality Verification](testing.md)
Run the automated test suites:
- 470+ unit and integration tests across all packages (`Vitest`).
- End-to-end testing with Playwright (`pnpm e2e`).
- Monorepo typechecking with Turborepo (`pnpm typecheck`).
