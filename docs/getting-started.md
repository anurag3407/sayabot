# Getting Started with Sayabot

This guide walks you through setting up, configuring, and launching Sayabot locally from scratch. By the end of this guide, you will have a running Sayabot monorepo with human-agent multiplayer rooms, live collaborative canvases, persistent Linux sandboxes, and autonomous cron routines.

---

## 📋 System Prerequisites

Before you begin, ensure your local development environment meets the following requirements:

| Tool | Minimum Version | Recommended | Notes |
| :--- | :--- | :--- | :--- |
| **Node.js** | `>= 24.0.0` | `24.x LTS` | Sayabot relies on modern Node.js web standard APIs. |
| **pnpm** | `>= 10.0.0` | `10.33.0+` | Core monorepo package manager (`corepack enable pnpm`). |
| **Docker Engine** | `>= 24.0.0` | Docker Desktop / OrbStack | Required for persistent bot sandboxes (`computerd`). |
| **PostgreSQL** | `>= 15.0` | Supabase (Hosted or Local) | Requires `LISTEN/NOTIFY` and Advisory Lock support. |
| **OpenSSL** | `>= 1.1.1` | Modern system OpenSSL | Used to generate master AES-256 keys and secrets. |
| **Git** | `>= 2.30` | Modern Git | Required for repository cloning and bot workspace tools. |

---

## 📦 1. Clone the Repository

Clone the Sayabot repository and navigate into the workspace directory:

```bash
git clone https://github.com/sayalabs/sayabot.git
cd sayabot
```

Install all workspace dependencies using `pnpm`:

```bash
pnpm install
```

---

## 🔑 2. Generate Master Cryptographic Keys

Sayabot enforces strict zero-leak secret isolation. Outbound API keys, tool configurations, and webhook secrets are encrypted at rest using AES-256-GCM.

Run the following commands in your terminal to generate cryptographic keys:

```bash
# 1. Master Key Encryption Key (KEK) for AES-256-GCM vault (base64, 32 bytes)
openssl rand -base64 32

# 2. Internal Microservice Shared Secret (hex, 32 bytes)
openssl rand -hex 32
```

Save these outputs; you will paste them into your `.env` file in the next step.

---

## 🗄️ 3. Supabase Database & Auth Setup

Sayabot utilizes PostgreSQL for relational storage, row-level security (RLS), real-time change data capture (CDC), and distributed locks.

### Step 3.1: Create a Supabase Project

1. Log in to [Supabase](https://supabase.com) and click **New project**.
2. Set your project name (e.g. `sayabot-dev`) and database password.
3. Choose your preferred region.

### Step 3.2: Critical Database Connection Pooler Configuration

> [!IMPORTANT]
> **Use the Session Pooler (port 5432) or Direct Connection!**
> Sayabot relies heavily on PostgreSQL `LISTEN/NOTIFY` for instant room message turn coordination, human approval gate wakeups, and room advisory locks (`pg_try_advisory_lock`).
> **Do NOT use the Transaction Pooler (port 6543)** as transaction mode does not support session-bound state or `LISTEN/NOTIFY`.

1. In Supabase Dashboard, go to **Project Settings** → **Database**.
2. Scroll to **Connection String** → select **URI**.
3. Choose **Session Pooler** (port `5432`) or **Direct Connection** (port `5432`).
4. Copy the connection string. It will look like:
   ```
   postgresql://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres
   ```

### Step 3.3: Configure Supabase Auth

1. Go to **Authentication** → **URL Configuration**.
2. Set **Site URL** to:
   ```
   http://localhost:3000
   ```
3. Add the following to **Redirect URLs**:
   ```
   http://localhost:3000/auth/callback
   http://localhost:3000/auth/complete
   http://localhost:3000/**
   ```
4. *(Optional for Dev)* Go to **Authentication** → **Email Templates**. If using Email Magic Links or OTPs, make sure `{{ .Token }}` or `{{ .ConfirmationURL }}` is present in the template.

---

## ⚙️ 4. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Open `.env` in your editor and fill in your credentials:

```dotenv
# ==============================================================================
# Supabase Configuration (Project Settings -> API)
# ==============================================================================
NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

# Session pooler connection string (port 5432) - NOT port 6543
DATABASE_URL="postgresql://postgres.your-project-id:your-db-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres"

# ==============================================================================
# Sayabot Master Keys & Microservice URLs
# ==============================================================================
# Master encryption key generated in Step 2: openssl rand -base64 32
MESH_KEK="your-32-byte-base64-kek-key="
SAYABOT_KEK="your-32-byte-base64-kek-key="

# Internal microservice secret: openssl rand -hex 32
ORCHESTRATOR_INTERNAL_SECRET="your-32-byte-hex-secret"

# Microservice endpoints
ORCHESTRATOR_URL="http://localhost:4000"
NEXT_PUBLIC_COLLAB_URL="ws://localhost:4000/collab"
NEXT_PUBLIC_SITE_URL="http://localhost:3000"

# ==============================================================================
# Authentication Providers
# ==============================================================================
NEXT_PUBLIC_GITHUB_AUTH_ENABLED=true
NEXT_PUBLIC_GOOGLE_AUTH_ENABLED=false
GITHUB_OAUTH_CLIENT_ID=""
GITHUB_OAUTH_CLIENT_SECRET=""

# ==============================================================================
# Local LLM Fallback (Optional - for testing without external API costs)
# ==============================================================================
# DEV_OPENAI_COMPAT_BASE_URL="http://localhost:11434/v1"
# DEV_OPENAI_COMPAT_API_KEY="ollama"
# DEV_OPENAI_COMPAT_MODEL="llama3.3"

# ==============================================================================
# Web Push Notifications (Optional - npx web-push generate-vapid-keys)
# ==============================================================================
NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
VAPID_PRIVATE_KEY=""
VAPID_SUBJECT="mailto:admin@example.com"
```

---

## 🗃️ 5. Apply Database Migrations & Seed Data

Sayabot organizes migrations as numbered SQL scripts under `packages/db/sql/0001_*.sql` through `0014_routines.sql`.

> [!CAUTION]
> Do not run raw Drizzle schema pushes directly. Always run the tracked migration runner.

Run migrations to initialize tables, row-level security policies, PostgreSQL functions, and triggers:

```bash
pnpm db:migrate
```

You should see output confirming that migrations `0001` through `0014_routines.sql` were applied:
- `0001_functions.sql`: Extension setup, cryptographic functions
- `0002_rls.sql`: Multi-tenant organization and room security policies
- `0003_realtime.sql`: Realtime replication publication for chats and canvas
- `0004_rpc.sql` - `0008_task_integrity.sql`: Task atomic locks and audit triggers
- `0009_bot_platform.sql` - `0013_auth_oauth_profiles.sql`: Bot engines and OAuth identities
- `0014_routines.sql`: Hermes-class cron routines, schedule parser, and execution logs

Next, run the seed script to populate default system agents, tool presets, and a sandbox organization:

```bash
pnpm db:seed
```

---

## 🚀 6. Launch the Development Stack

Start the entire monorepo with Turborepo:

```bash
pnpm dev
```

Turborepo will spin up all workspace microservices in parallel:

| Service | Port | Description |
| :--- | :--- | :--- |
| **`apps/web`** | `http://localhost:3000` | Next.js 16 Web Dashboard, Chat, Canvas & Cron Canvas |
| **`apps/orchestrator`** | `http://localhost:4000` | Hono Agent Runner, Turn Coordinator, Cron Scheduler |
| **Collab WebSocket** | `ws://localhost:4000/collab` | Real-time Yjs CRDT synchronization for live canvas |
| **MCP Gateway** | `http://localhost:4000/api/v1/mcp` | Universal Model Context Protocol endpoint |

---

## 🧭 7. First-Run Onboarding Walkthrough

1. Open your browser and navigate to [http://localhost:3000](http://localhost:3000).
2. Click **Sign In** and authenticate using Email Magic Link or GitHub OAuth.
3. Complete the **3-Step Setup Wizard**:
   - **Step 1: Workspace**: Set your workspace name (e.g. `Acme Engineering`) and slug (`acme`).
   - **Step 2: Default Agent**: Choose your starting agent:
     - **Pocket Saya**: General-purpose companion with web search, canvas editing, and task planning.
     - **Research Agent**: Deep web scraping, multi-source synthesis, and academic paper summaries.
     - **Full-Stack Developer**: Linux bash terminal, git staging, ripgrep, and code intelligence.
   - **Step 3: Tools & Model**: Configure your preferred model provider (OpenAI, Anthropic Claude 3.7 Sonnet, Google Gemini 2.0 Flash, or Ollama local models).
4. Enter your new room and send a test message:
   ```
   @saya introduce yourself and list what tools you have available
   ```
5. Try an autonomous cron routine:
   ```
   /cron
   ```
   Or visit `http://localhost:3000/acme/cron` to view the visual n8n-style workflow canvas!

---

## 🛠️ 8. Running Persistent Linux Sandboxes (`computerd`)

If you want your agents to have access to persistent Linux containers (`/home/bot`), full bash terminal execution, ripgrep, git, and headless Chromium CDP automation:

1. Ensure **Docker Desktop** (or OrbStack) is running.
2. In a separate terminal tab, build and run `computerd`:
   ```bash
   pnpm --filter @sayabot/computerd dev
   ```
3. `computerd` spins up Docker containers with persistent volumes per-agent on port `8088`.
4. Now, when an agent runs `computer_shell` or `browser_open`, it executes inside an isolated Docker container with resource quotas and full PTY terminal support.

---

## 🔍 Troubleshooting & FAQ

### 1. `Error: LISTEN/NOTIFY failed or advisory lock timed out`
- **Cause**: You connected via the Supabase Transaction Pooler (port `6543`).
- **Solution**: Open `.env` and change `DATABASE_URL` to port `5432` (Session Pooler or Direct Database URL).

### 2. `Error: secret decryption failed: invalid authentication tag`
- **Cause**: The `MESH_KEK` in `.env` does not match the key that originally encrypted existing secrets in the database.
- **Solution**: If developing locally and resetting the database, generate a fresh `MESH_KEK`, update `.env`, and re-run `pnpm db:seed`.

### 3. `WebSocket connection to 'ws://localhost:4000/collab' failed`
- **Cause**: The orchestrator microservice is not running or port 4000 is occupied.
- **Solution**: Check the console output of `pnpm dev`. Ensure no other process is bound to port 4000 (`lsof -i :4000`).

### 4. `Tool call failed: docker daemon is not reachable`
- **Cause**: The agent has the `computer` capability enabled, but Docker is not running on your host machine.
- **Solution**: Start Docker Desktop / OrbStack. If you do not need Linux containers, toggle off the `computer` capability in Agent Settings (`/[org]/agents`).

---

## 📚 Next Steps

- **[Architecture Deep Dive](architecture.md)**: Discover how the Turn Coordinator and Realtime sync function under the hood.
- **[Hermes Cron & Visual Canvas](cron-and-automations.md)**: Build scheduled workflows on the n8n canvas.
- **[Multiplayer Rooms & Memory](rooms-and-collaboration.md)**: Learn about turn modes, shared canvases, and multi-tier memory.
- **[Tools & Sandboxes](tools-and-sandboxes.md)**: Explore the 40+ built-in agent tools.
- **[Universal MCP Gateway](mcp-and-connectors.md)**: Connect ChatGPT, Claude Desktop, Cursor, or external bots.
