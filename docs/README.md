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
├── connectors.md                  # Two-tier workspace connectors (Slack, Drive, GitHub, Jira)
├── mcp-and-connectors.md          # Universal MCP gateway & bring-your-own-bot
├── deployment.md                  # Production deployment (VPS, Docker, Supabase)
├── cloudflare-integration.md      # Cloudflare platform integration & edge architecture
├── auto-updates.md                # Multi-platform auto-updates (Web, Mac PWA, Android APK)
└── testing.md                     # Test suites (unit, integration, e2e Playwright)

Developer & Contributor Manuals:
├── ../AGENTS.md                   # Operational manual for AI coding agents (Claude, Cursor, Codex)
├── ../CONTRIBUTING.md             # Human contributor guide, code style, PR workflow
└── ../.github/
    ├── ISSUE_TEMPLATE/            # Structured issue forms (bug, feature, connector, docs)
    └── pull_request_template.md   # Standard pull request checklist & AI disclosure
```

---

## 🧭 Which Guide Do You Need?

### 🚀 [Getting Started & Local Setup](getting-started.md)

Start here if you want to run Sayabot on your local machine. Covers:

- System prerequisites (Node 24, pnpm 10, Docker, Supabase).
- Generating encryption keys (`SAYABOT_KEK` [alias `MESH_KEK`], `ORCHESTRATOR_INTERNAL_SECRET`).
- Supabase project creation, session pooler connection, and authentication config.
- Applying database migrations (`0001` through `0014_routines.sql`).
- First sign-in and workspace onboarding wizard.
- Troubleshooting common setup pitfalls.

### 🌐 [Self-Hosting Guide (Definitive Production Manual)](self-hosting.md)

The comprehensive operational guide for hosting Sayabot on your own infrastructure:

- **Ingress pathways**: Automated Single VPS (`deploy/` with `setup-vps.sh` and `deploy.sh`), Cloudflare Zero Trust Tunnels, Tailscale Private Network, Split Cloud (Vercel + Fly.io), and Local Homelab.
- **Database configuration**: Supabase Session Pooler (port 5432) vs Transaction Pooler (6543), migrations, and RLS.
- **Secrets & encryption**: `SAYABOT_KEK` (AES-256-GCM envelope encryption with legacy `MESH_KEK` alias), `ORCHESTRATOR_INTERNAL_SECRET`, and full environment variable dictionary (`SAYABOT_DOMAIN`, `SAYABOT_APP_SERVICES`, etc.).
- **Networking & WebSockets**: Nginx proxy tuning (`sayabot-locations.conf`, `sayabot.conf.template`), Hocuspocus WSS (`/collab`), and unbuffered SSE/NDJSON streaming.
- **Sandboxes & execution**: `computerd` persistent Docker containers, headless Chromium CDP, and egress SSRF firewall.
- **Universal MCP Gateway**: Client connection guides for Claude Desktop, Claude Code, Cursor, Windsurf, and ChatGPT.
- **Operations & reliability**: Nightly `pg_dump` backups, zero-downtime rolling updates (`deploy.sh`), rollback mechanics, and troubleshooting matrix.

### 📱 [The Self-Hosted Flow: Ask Anywhere, Approve From the Lock Screen](self-hosted-flow.md)

End-to-end setup for running Sayabot as a 24/7 personal agent on your own server:

- **Ingress**: open ports + Let's Encrypt (`SAYABOT_DOMAIN`), or a Cloudflare Tunnel with no open ports (`CLOUDFLARE_TUNNEL_TOKEN`).
- **Phone**: QR pairing, Allow / Don't allow and typed answers from notifications; browser notifications with Allow / Don't allow.
- **Chat ingress**: Telegram, Discord and WhatsApp, with "waiting for your OK" notices in the chat.
- **Automations**: results sent to a chat, plus "routine is done" alerts.
- **Mac + cloud**: Mac tools are skipped when it sleeps, so agents carry on in their cloud computer.
- **Saya AI**: your own provider for every user, set in `.env`. Model changes reach web, phone and Mac with no update.

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

### 🔗 [Workspace Connectors & Enterprise Integrations](connectors.md)

Connect enterprise systems of record with zero-trust security:

- **Two-Tier Architecture**: Organization-level credential vaults (`workspace_connectors`) decoupled from agent grants (`agent_connector_grants`).
- **Cryptographic Security**: AES-256-GCM envelope encryption with `SAYABOT_KEK` (legacy alias `MESH_KEK`), zero token leakage, and PostgreSQL RLS.
- **Provider Guides**: Setup for **Slack**, **Google Drive**, **GitHub**, and **Jira** (OAuth & API tokens, scopes, event subscriptions).
- **Fine-Grained Scopes**: Enforce channel, folder, repo, and read-only boundaries per agent.
- **Provider Rate Limiting**: Adaptive sliding-window exponential backoff with jitter and standard HTTP `Retry-After` header parsing.
- **Complete Tool Catalog**: Reference specs and schemas for `gdrive_search`, `gdrive_read_file`, `slack_search`, `slack_read_thread`, `slack_send_message`, `github_search_code`, `github_get_file`, and `github_get_issue_or_pr`.

### 🔌 [Universal MCP & Bring Your Own Bot](mcp-and-connectors.md)

Connect any AI tool or external client:

- Exposing Sayabot to **ChatGPT**, **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**, and **Gemini CLI** via `/api/v1/mcp`.
- Connecting external MCP servers to Sayabot rooms with encrypted header vaults.
- Reference Python external bot implementation with HMAC signature verification.

### 🚢 [Production Deployment](deployment.md)

Deploy Sayabot to high-availability environments:

- Single-node VPS deployment with Docker Compose (`deploy/docker-compose.yml`), automated VPS setup (`setup-vps.sh`), Nginx (`sayabot-locations.conf`), and Let's Encrypt (`init-letsencrypt.sh`).
- Managed cloud setups: Supabase hosted, AWS/GCP container services, and background workers.
- Environment variable configuration reference (`SAYABOT_DOMAIN`, `SAYABOT_KEK`, `SAYABOT_APP_SERVICES`, `SAYABOT_IMAGE_PREFIX`).

### 🧪 [Testing & Quality Verification](testing.md)

Run the automated test suites:

- 470+ unit and integration tests across all packages (`Vitest`).
- End-to-end testing with Playwright (`pnpm e2e`).
- Monorepo typechecking with Turborepo (`pnpm typecheck`).

---

## 🛠 Developer & Contributor Manuals

### 🤖 [AI Coding Agent Operational Manual](../AGENTS.md)

Mandatory high-priority manual for AI coding assistants (Claude, Cursor, Copilot, Antigravity, Codex, Hermes):

- **Monorepo Directory Map**: In-depth anatomical breakdown of `apps/`, `packages/`, and `deploy/`.
- **Exact pnpm & Turbo Commands**: Filtered commands for dev, build, typecheck, migrations, and tests.
- **Five Golden Architectural Rules**:
  1. _Never hardcode or leak secrets_: AES-256-GCM envelope encryption with `SAYABOT_KEK` / `MESH_KEK` (`@sayabot/llm`).
  2. _Never bypass room PostgreSQL advisory locks_: Deterministic serialization with `withRoomLock()`.
  3. _Database changes MUST follow Drizzle schemas_: Table definitions in `packages/db/src/schema/` and SQL migrations.
  4. _Dangerous tools MUST pass human approval gates_: Asynchronous human-in-the-loop gates in `toAuditedTools`.
  5. _Persistent sandboxes run in Docker bounded to `/home/bot`_: Confinement enforced via `isSafePath()`.
- **Adding a New Tool**: Step-by-step tutorial from Zod schema definition in `apps/orchestrator/src/tools/` to Vitest execution.
- **Adding a New Connector**: Step-by-step tutorial implementing `ConnectorService`, `workspace_connectors`, and `agent_connector_grants`.
- **Testing & Linting Conventions**: Strict Prettier, ESLint, and Vitest testing patterns.

### 🤝 [Human Contributor Guide](../CONTRIBUTING.md)

The complete guide for human developers contributing to Sayabot:

- **Local Machine Setup**: Node 24, pnpm 10, Docker, and Supabase configuration.
- **Branch Naming**: Conventional prefixes (`feat/`, `fix/`, `docs/`, `refactor/`, `test/`).
- **Conventional Commits**: Commit message format (`type(scope): description`) with recognized scopes.
- **Code Style & Formatting**: Prettier (`semi: false`, `singleQuote: false`, `printWidth: 100`) and ESLint guidelines.
- **Pull Request Lifecycle**: Pre-flight verification checklist and review process.
- **AI Agent Co-Authorship**: Transparent disclosure policy when using AI coding assistants.

### 📋 [GitHub Community & Issue Templates](../.github/)

Standardized GitHub issue forms and PR templates:

- **[Bug Report Form](../.github/ISSUE_TEMPLATE/bug_report.yml)**: Structured bug submission with component dropdowns, reproduction steps, and system logs.
- **[Feature Request Form](../.github/ISSUE_TEMPLATE/feature_request.yml)**: Feature proposals with architectural impact and user stories.
- **[Connector Request Form](../.github/ISSUE_TEMPLATE/connector_request.yml)**: Proposals for new enterprise connectors (API auth, scopes, danger ratings).
- **[Documentation Request Form](../.github/ISSUE_TEMPLATE/documentation.yml)**: Documentation fixes, improvements, and missing guides.
- **[Pull Request Template](../.github/pull_request_template.md)**: Comprehensive PR checklist covering migrations, tests, security audits, and AI disclosure.
