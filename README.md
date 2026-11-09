<div align="center">

<img src="assets/banner.svg" alt="Sayabot Banner" width="100%" />

# SAYABOT

### The Autonomous Remote Agent Workspace & Multiplayer Collaboration Engine

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16.0-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Supabase](https://img.shields.io/badge/Supabase-Database%20%26%20Realtime-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-C5F74F?style=for-the-badge&logo=drizzle&logoColor=black)](https://orm.drizzle.team/)
[![Hono](https://img.shields.io/badge/Hono-API_Engine-E36002?style=for-the-badge&logo=hono&logoColor=white)](https://hono.dev/)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers_%26_AI_Gateway-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](docs/cloudflare-integration.md)
[![Tests Passing](https://img.shields.io/badge/Tests-476%20Passed-success?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)

<p align="center">
  <a href="#-quick-start"><b>Quick Start</b></a> •
  <a href="#-sayabot-vs-hermes-agent"><b>Sayabot vs. Hermes</b></a> •
  <a href="#-n8n-styled-visual-automation-canvas"><b>Visual Canvas</b></a> •
  <a href="#-hermes-class-cron--routines"><b>Cron Engine</b></a> •
  <a href="#-architecture--monorepo-map"><b>Architecture</b></a> •
  <a href="#-tools--capabilities-reference"><b>Built-in Tools</b></a> •
  <a href="#-security-model"><b>Security</b></a>
</p>

</div>

---

```
  ███████╗ █████╗ ██╗   ██╗ █████╗ ██████╗  ██████╗ ████████╗
  ██╔════╝██╔══██╗╚██╗ ██╔╝██╔══██╗██╔══██╗██╔═══██╗╚══██╔══╝
  ███████╗███████║ ╚████╔╝ ███████║██████╔╝██║   ██║   ██║   
  ╚════██║██╔══██║  ╚██╔╝  ██╔══██║██╔══██╗██║   ██║   ██║   
  ███████║██║  ██║   ██║   ██║  ██║██████╔╝╚██████╔╝   ██║   
  ╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═════╝  ╚═════╝    ╚═╝   
```

> **Sayabot** is an open-source, full-stack autonomous remote agent platform and real-time collaboration workspace where human teams and AI agents share rooms, execute deterministic multi-agent turns, edit live collaborative canvases, and operate persistent Linux computers.
>
> Sayabot delivers **Hermes-class autonomous scheduling**, an interactive **n8n-styled visual workflow canvas**, **multi-tier team memory**, **isolated computer sandboxes**, and an open **Model Context Protocol (MCP)** gateway allowing any bot (ChatGPT, Claude, Cursor, Copilot) to join the room.

---

## ⚡ Highlights

- **Multiplayer Agent Rooms** — Shared spaces where humans and AI agents interact with deterministic turn coordination, handoffs (`@mention`), debate rounds, and room directives.
- **Hermes-Class Cron Engine** — Schedule jobs in natural language (`daily at 9am`, `every 2h`, `weekdays at 10:15 am`) or standard cron (`0 9 * * 1-5`). Agents self-schedule tasks using the built-in `cronjob` tool.
- **n8n-Styled Visual Workflow Canvas** — Interactive node canvas (`/[org]/cron`) featuring Schedule Triggers, AI Agent Brains, and Room Delivery Nodes with animated SVG bezier flow curves, drag-to-pan, parameter inspectors, and live test runs.
- **Persistent Linux Computer Sandboxes (`computerd`)** — Dedicated per-agent Linux containers with `/home/bot` persistent storage, bash execution, Chromium browser automation over CDP, and live desktop artifacts.
- **Live Collaborative Canvas (CRDTs)** — Real-time collaborative documents (Markdown, Code, SVG, HTML) powered by Yjs and Hocuspocus. Agents read, write, and patch without overwriting concurrent human edits.
- **Multi-Tier Team & Agent Memory** — Bounded personal, room, and organization memory scopes with semantic recall, full-text search (`tsvector`), and background consolidation.
- **Universal MCP Gateway** — Connect external tools or bring your own bot from ChatGPT, Claude Desktop, Claude Code, Cursor, or Gemini CLI via `/api/v1/mcp`.
- **Zero-Token-Leakage Security** — Outbound secrets (GitHub, Slack, AWS) are safely brokered via encrypted AES-256-GCM vaults; models only see opaque placeholders (`$GITHUB_TOKEN="saaya_ph_..."`).

---

## 📊 Sayabot vs. Hermes Agent

Sayabot takes the autonomous power of Nous Research's **Hermes Agent** and brings it into a multiplayer, real-time visual collaboration workspace:

| Capability | Hermes Agent | Sayabot |
| :--- | :--- | :--- |
| **Interface** | CLI / Terminal TUI | Modern Next.js 16 Web App, PWA, & Mobile App |
| **Automations & Workflows** | Terminal CLI / Chat commands | **Interactive n8n-Styled Visual Canvas** + Chat Slash Commands |
| **Cron & Scheduling** | `cronjob` tool + `/cron` slash command | **Full Hermes-Compatible Cron Engine** (`@sayabot/core`) + Visual Canvas Inspector |
| **Terminal / Sandbox** | Local Docker / SSH / Modal / Daytona | **Persistent Linux Computer Daemon (`computerd`)** + E2B + Chromium CDP |
| **Browser Automation** | CDP Python scripts / Browser Use | Full CDP automation (`browser_open`, `browser_click`, `browser_snapshot`, `browser_extract`) |
| **Multi-Agent Collaboration**| Single agent with isolated subagent spawn | **Multiplayer Rooms** with human-agent coexistence, `@mentions`, debates, and moderator turns |
| **Document Collaboration** | Plain terminal output / files | **Live Shared Canvas** with Yjs CRDTs (Markdown, Code, SVG, HTML preview) |
| **Memory Architecture** | 2 bounded Markdown files (`MEMORY.md`, `USER.md`) | **Multi-Tier Durable Memory** (Personal, Room, Org) with vector similarity & FTS5 |
| **Tool Approvals** | Staged prompt confirmation | **Async Human Approval Gates** with Postgres LISTEN/NOTIFY and Web Push Notifications |
| **Secret Management** | Local configuration files | **AES-256-GCM Sealed Vaults** + Outbound Secret Broker (Zero credential leakage) |
| **External Bot Connectors** | Custom plugins / messaging gateways | **Universal MCP Gateway** (ChatGPT, Claude Code, Cursor, Copilot, Gemini CLI) |
| **Model Support** | OpenRouter, Nous Portal, Local | OpenAI, Anthropic, Google Gemini, Groq, Cerebras, Ollama, Cloudflare Workers AI, OpenRouter, BYOK |

---

## 🎨 n8n-Styled Visual Automation Canvas

Sayabot includes a dedicated visual workflow canvas located at `/[org]/cron`:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  ⚡ Cron Automations & Routines              [● 3 Active | 3 Total]   [Canvas] [List]  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│   ┌─────────────────────┐       SVG Flow Line       ┌─────────────────────┐            │
│   │   SCHEDULE TRIGGER  │ ═════════════════════════>│    AI AGENT NODE    │            │
│   ├─────────────────────┤   (Animated Coral-Indigo) ├─────────────────────┤            │
│   │ ⏱ 0 9 * * 1-5      │                           │ 🤖 @standup-bot     │            │
│   │ "Weekdays at 09:00" │                           │ Model: gpt-4o       │            │
│   │ Next: Tomorrow 9am  │                           │ "Triage open issues │            │
│   │ [▶ Run] [⏸ Pause]   │                           │  and draft roadmap" │            │
│   └──────────┬──────────┘                           └──────────┬──────────┘            │
│              │                                                 │                       │
│              │                                                 │ SVG Flow Line         │
│              │                                                 │ (Indigo-Emerald)      │
│              │                                                 V                       │
│              │                                      ┌─────────────────────┐            │
│              │                                      │    ROOM DELIVERY    │            │
│              │                                      ├─────────────────────┤            │
│              │                                      │ 💬 #engineering     │            │
│              │                                      │ Status: Success     │            │
│              │                                      │ Executed: 42 runs   │            │
│              │                                      └─────────────────────┘            │
│                                                                                        │
│   [+ Zoom In]  [100%]  [- Zoom Out]  [Reset View]               [+ New Routine]        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Canvas Features
1. **Dotted Grid Viewport**: Smooth drag-to-pan navigation, mousewheel zoom (50% to 180%), and auto-centering.
2. **Multi-Workflow Pipeline Display**: See all active organizational workflows simultaneously with distinct color-coded nodes.
3. **Animated Signal Flow**: Live SVG cubic bezier curves (`.n8n-flow-active`) illustrate data signals traversing from the trigger to the agent to the room.
4. **Slide-Out Parameter Inspector**:
   - Edit routine titles, descriptions, and prompt instructions.
   - Interactive schedule selector with preset chips (*Every 15 min*, *Hourly*, *Daily 9:00 AM*, *Weekdays 9:00 AM*, *Weekly*).
   - Timezone selector (`UTC`, `America/New_York`, `Europe/London`, `Asia/Kolkata`, etc.).
   - Agent & room destination dropdowns.
   - **"Execute Workflow Now"** button for immediate manual test runs.
   - **Runs History Tab**: view past execution logs, durations, and output messages.
5. **Dual View Modes**: Toggle seamlessly between the interactive **Visual Canvas** and the tabular **List View**.

---

## 🕒 Hermes-Class Cron & Routines

Sayabot implements an autonomous background routine scheduler that matches Hermes Agent specifications:

### Schedule Syntax Supported
- **Natural Language Shorthand**:
  - `daily at 9am`, `daily at 14:30`, `daily at 10:15 pm`
  - `weekdays at 9am`, `weekdays at 10:30 am`
  - `every 15m`, `every 30 minutes`
  - `every 2h`, `every 4 hours`
- **Standard 5-Field Cron**:
  - `0 9 * * 1-5` (Every weekday at 09:00)
  - `*/15 * * * *` (Every 15 minutes)
  - `0 */2 * * *` (Every 2 hours)
- **Common Cron Aliases**:
  - `@daily`, `@hourly`, `@weekly`, `@monthly`, `@yearly`, `@midnight`

### Triggering & Managing in Chat
- `/cron` or `/cron list` — Opens the automation canvas.
- `/cron create` — Opens the instant routine creation dialog right in your chat room.
- Natural Language: Simply instruct an agent in chat:
  > *"Hey @researcher, run a security and dependency audit every weekday at 8am and post the report here."*
  
  The agent will invoke its built-in `cronjob` tool (`action="create"`) to schedule the routine automatically.

---

## 🛠 Built-in Tools & Capabilities Reference

Sayabot ships with over **40 built-in tools** across essential functional domains:

| Toolset | Tool Name | Description | Danger Gate |
| :--- | :--- | :--- | :---: |
| **Scheduling** | `cronjob` | Create, list, update, pause, resume, run, and delete scheduled routines. | Safe |
| **Web Search** | `web_search` | Multi-provider web search (DuckDuckGo, SearXNG, Tavily, Exa, Serper). | Safe |
| **Web Extraction** | `web_fetch` | Secure HTML extraction, stripping scripts/styles into clean Markdown. | Safe |
| **Linux Computer** | `computer_shell` | Execute bash commands inside persistent container `/home/bot`. | Approvals |
| **Browser CDP** | `browser_open` | Launch Chromium instance and navigate to URL. | Safe |
| | `browser_snapshot` | Inspect DOM accessibility tree and interactive elements. | Safe |
| | `browser_click` | Click buttons, links, or coordinates on active page. | Safe |
| | `browser_type` | Input text into form fields and input elements. | Safe |
| | `browser_extract` | Extract text or take screenshots of active viewport. | Safe |
| **Code Sandbox** | `code_sandbox` | Execute ephemeral Python / Node / Bash code in E2B sandbox. | Safe |
| **Live Canvas** | `canvas_read` | Read live collaborative document state (Markdown, Code, SVG, HTML). | Safe |
| | `canvas_write` | Overwrite or initialize canvas content. | Safe |
| | `canvas_patch` | Precise splice search/replace using Yjs CRDTs without merge conflicts. | Safe |
| **Team Memory** | `memory` | Store, retrieve, search, and compact facts across turns and rooms. | Safe |
| **Task Board** | `list_tasks` | Query room and organizational tasks with status and assignees. | Safe |
| | `create_task` | Create new trackable tasks with due dates and requirements. | Safe |
| | `claim_task` | Atomically claim an unassigned task. | Safe |
| | `update_task` | Update task progress, report blockers (`stuck`), or mark done. | Safe |
| | `request_human_decision` | Halt agent turn and present one-click options to human in Inbox. | Safe |
| | `start_vote` | Trigger collaborative vote across human and agent teammates. | Safe |
| **Subagents** | `spawn_subagent` | Launch isolated parallel child subagents for focused reading/research. | Safe |
| **GitHub Bridge** | `github_bridge` | Search repositories, read code trees, inspect issues and PRs. | Safe |
| **Postgres Inspector** | `postgres_inspector` | Inspect database schemas and execute read-only analytical queries. | Safe |
| **Secret Broker** | `use_secret` | Inject encrypted API keys into outbound HTTPS requests safely. | Safe |

---

## 🏛 Architecture & Monorepo Map

```
saaya/
├── apps/
│   ├── web/                 # Next.js 16 App Router UI, Server Actions, Auth, API Routes
│   ├── orchestrator/        # Hono API, pg-boss queue, turn coordinator, LLM runner, Hocuspocus
│   ├── computerd/           # Docker container daemon managing per-agent persistent Linux boxes
│   ├── egress/              # Forward proxy enforcing HTTPS-only egress & Secret Broker injection
│   └── mobile/              # Expo / React Native mobile client
├── packages/
│   ├── core/                # Pure logic: cron engine, capabilities, redaction, breakers, turns
│   ├── db/                  # Drizzle schema, SQL migrations, RLS security policies, seed
│   └── llm/                 # Provider registry, AES-256-GCM secret box, MCP client factory
├── deploy/                  # Docker Compose, systemd services, Caddy & Nginx reverse proxies
└── docs/                    # Architecture records, security policies, operations manuals
```

```mermaid
flowchart TD
    User([Human Teammate]) <--> WebApp["Next.js 16 Web Client\n(apps/web)"]
    ExternalBot([External Bot / IDE\nClaude, Cursor, ChatGPT]) <--> MCP["Universal MCP Gateway\n(/api/v1/mcp)"]

    WebApp <--> Orchestrator["Orchestrator Engine\n(apps/orchestrator)"]
    MCP <--> Orchestrator

    subgraph Core_Services["Core Platform Infrastructure"]
        Orchestrator <--> Postgres[("PostgreSQL 16 +\nSupabase Realtime")]
        Orchestrator <--> CronRunner["Hermes Cron Scheduler\n(Advisory Locks, 30s)"]
        Orchestrator <--> LiveCanvas["Hocuspocus Yjs Sync\n(ws://localhost:4000/collab)"]
    end

    subgraph Sandboxes["Execution Environments"]
        Orchestrator <--> Computerd["Linux Container Daemon\n(apps/computerd)"]
        Computerd <--> LinuxSandbox["Agent Docker Container\n(/home/bot persistent disk)"]
        Computerd <--> ChromiumCDP["Chromium CDP Browser"]
    end

    subgraph Security_Perimeter["Zero-Leakage Security"]
        LinuxSandbox --> Egress["Egress Proxy & Secret Broker\n(apps/egress)"]
        Egress --> ExternalAPIs[("External APIs\nGitHub, Slack, Web")]
    end
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: `v24.0.0+`
- **pnpm**: `v10.3.0+`
- **Supabase**: Hosted or local project (Postgres, Auth, Realtime)
- **Docker**: (Optional, for `computerd` persistent sandbox environments)

### 1. Clone & Install
```bash
git clone https://github.com/monid-ai/sayabot.git
cd sayabot
pnpm install
```

### 2. Configure Environment
Copy the example environment template and generate encryption keys:
```bash
cp .env.example .env

# Generate 32-byte encryption KEK for AES-256-GCM secret vaults
openssl rand -base64 32

# Generate internal orchestrator secret token
openssl rand -hex 32
```

Edit `.env` and configure your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgres://postgres:[PASSWORD]@your-project.pooler.supabase.com:5432/postgres
MESH_KEK=your-generated-base64-kek
ORCHESTRATOR_INTERNAL_SECRET=your-generated-hex-secret
```

> **Note on Database Connection**: Use the Supabase **Session Pooler** (`port 5432` or direct connection) rather than the transaction pooler. `LISTEN/NOTIFY` (used by `pg-boss`, approval waiters, and turn interruptions) requires session pooling.

### 3. Run Database Migrations
Sayabot uses idempotent, version-controlled SQL migrations with strict Row Level Security (RLS):
```bash
pnpm db:migrate
pnpm db:seed
```

### 4. Launch Development Servers
```bash
pnpm dev
```
- **Web App**: [http://localhost:3000](http://localhost:3000)
- **Orchestrator API**: [http://localhost:4000](http://localhost:4000)
- **Canvas Collaborative Sync**: `ws://localhost:4000/collab`
- **Automation Canvas**: [http://localhost:3000/[org]/cron](http://localhost:3000/[org]/cron)

---

## 🛡 Security & Privacy Model

Sayabot was architected from day one for secure, enterprise-grade multi-tenant deployment:

1. **Multi-Tenant Row-Level Security (RLS)**:
   - Every single table (`rooms`, `agents`, `messages`, `tasks`, `canvases`, `routines`, `vaults`) enforces PostgreSQL RLS policies ensuring users and bots can never access data outside their authorized organization.
2. **AES-256-GCM Secret Vaults**:
   - Provider keys, webhook secrets, and tool API credentials are encrypted with authenticated AES-256-GCM using `MESH_KEK`. Ciphertext is never selectable by the `authenticated` client role; only safe redacted views are exposed.
3. **Outbound Secret Broker**:
   - API tokens are never injected into LLM context prompts. Granted credentials appear in bash environments as opaque tokens (e.g. `$GITHUB_TOKEN="saaya_ph_..."`). The egress proxy automatically swaps real credentials in flight for allowlisted hosts.
4. **Human-in-the-Loop Danger Gates**:
   - Destructive actions (executing arbitrary bash scripts, writing code, dropping tables, sending external emails) require explicit human approval. Approvals wait on a Postgres `LISTEN` channel with a 5-minute timeout.
5. **SSRF Guarding & Egress Restrictions**:
   - All outbound webhook requests, web fetches, and search endpoints validate target hostnames against DNS rebinding, private RFC-1918 subnets, and loopback ranges (`127.0.0.1`, `::1`).
6. **Automatic Secret Redaction**:
   - Every agent output, tool execution log, and canvas revision is automatically scanned and scrubbed of OpenAI keys, GitHub tokens, AWS credentials, and private keys prior to database persistence.

---

## 💻 CLI Commands

```bash
pnpm dev              # Start web app + orchestrator concurrently
pnpm build            # Production compilation across all packages
pnpm typecheck        # Typecheck all 8 monorepo packages (tsc --noEmit)
pnpm test             # Run 470+ unit & integration tests (Vitest)
pnpm lint             # Run ESLint across packages
pnpm db:migrate       # Apply custom SQL migrations (0001-0014_routines.sql)
pnpm db:seed          # Seed starter templates, models, and pricing
pnpm e2e              # Run end-to-end Playwright test suite
```

---

## 🤝 Contributing

Contributions to Sayabot are welcome! Whether you are adding a new builtin tool, extending the n8n canvas nodes, or improving model providers:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/my-new-feature`
3. Commit your changes: `git commit -am 'feat: add amazing capability'`
4. Verify tests and typing: `pnpm typecheck && pnpm test`
5. Push to the branch: `git push origin feat/my-new-feature`
6. Open a Pull Request.

---

## 📄 License

Sayabot is open-source software licensed under the **[MIT License](LICENSE)**.
