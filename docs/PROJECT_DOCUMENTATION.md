# Sayabot: Complete System Architecture & Technical Documentation

> **Authoritative Technical Manual for Developers, System Architects, and AI Agents**  
> _Version: 1.1.0 · Monorepo: `@sayabot/*` · License: AGPL-3.0_  
> _Author: Sayalabs Studio (<sayalabs.studio@gmail.com>)_

---

## Table of Contents

1. [Executive Summary & Core Philosophy](#1-executive-summary--core-philosophy)
2. [High-Level System Architecture & Topology](#2-high-level-system-architecture--topology)
3. [Monorepo Directory Map & Workspace Breakdown](#3-monorepo-directory-map--workspace-breakdown)
4. [The Five Golden Architectural Rules](#4-the-five-golden-architectural-rules)
5. [Data Plane & Database Schema Catalog](#5-data-plane--database-schema-catalog)
6. [The Turn Coordinator & Multi-Agent Execution Engine](#6-the-turn-coordinator--multi-agent-execution-engine)
7. [Sandboxes, Compute Daemons & Execution Environments](#7-sandboxes-compute-daemons--execution-environments)
8. [Audited Tool System, Secret Broker & SSRF Defense](#8-audited-tool-system-secret-broker--ssrf-defense)
9. [Workspace Connectors & Universal MCP Gateway](#9-workspace-connectors--universal-mcp-gateway)
10. [Cognitive Memory Architecture & The Dream Cycle](#10-cognitive-memory-architecture--the-dream-cycle)
11. [Multi-Platform Client Applications](#11-multi-platform-client-applications)
12. [LLM Infrastructure, Provider Adapters & Cost Engine](#12-llm-infrastructure-provider-adapters--cost-engine)
13. [Deployment, Operations & Production Runbooks](#13-deployment-operations--production-runbooks)
14. [Developer Guide, Testing & Quality Assurance](#14-developer-guide-testing--quality-assurance)
15. [Comprehensive Codebase Directory Map](#15-comprehensive-codebase-directory-map)

---

## 1. Executive Summary & Core Philosophy

### 1.1 What is Sayabot?

**Sayabot** is an open-source, full-stack autonomous multi-agent platform and collaborative workspace. It transforms how human engineering teams and autonomous AI agents collaborate by moving beyond isolated chatbot wrappers and single-tenant terminal scripts into a unified multiplayer workspace.

In Sayabot, humans and AI agents share:

- **Persistent Multiplayer Rooms**: Single threads with real-time presence, contextual awareness, and deterministic turn arbitration.
- **Collaborative Live Canvases**: Shared Monaco and markdown canvases powered by Yjs Conflict-Free Replicated Data Types (CRDTs) where humans and multiple agents type and edit simultaneously.
- **Dedicated Linux Computers**: Persistent Docker containers (`/home/bot`) where each agent can clone repositories, run compilers, execute tests, inspect services, and run headless browsers via Chrome DevTools Protocol (CDP).
- **Human-in-the-Loop Approval Gates**: Destructive or externally visible operations (`dangerous: true`) automatically halt execution, trigger push notifications to web/mobile/desktop, and await human authorization with a 5-minute fail-safe timeout.
- **Zero Plaintext Secrets**: Credentials and tokens never enter LLM prompt contexts; secrets are sealed at rest with AES-256-GCM and substituted in-flight by a hardened egress proxy.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       TRADITIONAL AI VS. SAYABOT                            │
├──────────────────────────────────────┬──────────────────────────────────────┤
│ Single-User AI / Chatbot Wrappers    │ Sayabot Multiplayer Collaboration    │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ Siloed single-user chat windows      │ Shared multiplayer team rooms        │
│ Ephemeral state lost on disconnect   │ Persistent rooms, canvases & disks   │
│ Blind unmonitored command execution  │ Audited turns with 5-min approvals   │
│ Plaintext secrets in prompt tokens   │ Zero-knowledge AES-256 secret broker │
│ Shared host filesystem risks         │ Isolated Docker containers /home/bot │
│ One model vendor lock-in             │ 17 providers + Bring-Your-Own-Bot    │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 1.2 The "Bring-Your-Own-Bot" Paradigm

Sayabot does not force users into a single proprietary LLM provider. Instead, it supports a dual integration model:

1. **Hosted Server Agents**: Internal reasoning loops running directly on the orchestrator using standard API keys across 17 supported providers (Anthropic, OpenAI, Google Gemini, DeepSeek, Ollama, Groq, Mistral, xAI, AWS Bedrock, etc.).
2. **Bring-Your-Own-Bot (BYOB)**: External coding agents that users already run and pay for—such as **Claude Code**, **OpenAI Codex**, **Cursor**, **Hermes**, or **ChatGPT**—connect directly into Sayabot rooms via the Model Context Protocol (MCP) or room webhooks. The external agents keep their own credentials and CLI harnesses while collaborating in the room.

---

## 2. High-Level System Architecture & Topology

Sayabot is architected as a distributed system designed for high concurrency, real-time synchronization, and multi-tenant isolation.

```mermaid
flowchart TD
    subgraph Clients["Clients & User Surfaces"]
        Web["Web Application\n(Next.js 16 / React 19 / Tailwind v4)"]
        Mobile["Mobile Client\n(Expo / React Native / SQLite)"]
        Desktop["Desktop Companion\n(Electron / Mac & Win Runner)"]
        ExternalBots["External MCP Clients\n(Claude Code, Codex, Cursor)"]
    end

    subgraph Edge["Ingress & Edge Layer"]
        Nginx["Nginx / Cloudflare Tunnel\n(SSL Termination & Rate Limiting)"]
        WebProxy["Next.js Edge Proxy\n(Session & Route Guard)"]
        Auth["Supabase Auth / OAuth\n(JWT & Session Validation)"]
    end

    subgraph CoreBackend["Core Backend Services"]
        Orchestrator["Orchestrator Service (Hono)\n• Turn Coordinator (Advisory Locks)\n• Agent Loop V2 (Planner, Critic, Subagents)\n• Distributed Cron Scheduler (Hermes)\n• MCP Server Gateway (/api/v1/mcp)"]
        CollabWS["Collab WebSocket Server\n(Hocuspocus + Yjs CRDTs)"]
        Computerd["computerd Daemon (Node / Docker)\n• Persistent saaya-bot-${agentId} containers\n• agentd Unix Socket Server\n• Chromium Headless CDP"]
        Egress["Hardened Egress Proxy\n• AES-256-GCM Secret Broker\n• In-Flight $SECRET{...} Resolution\n• SSRF RFC 1918 Firewall"]
    end

    subgraph DataPlane["Data & Persistence Plane"]
        Postgres[("PostgreSQL 16+ Database\n• Multi-Tenant Row Level Security (RLS)\n• pgvector Vector Embeddings\n• pg_advisory_lock Concurrency Engine\n• LISTEN/NOTIFY Interruption Bus")]
        RealtimeCDC["Supabase Realtime\n(PostgreSQL Logical Replication CDC)"]
        DockerStorage[("Persistent Docker Volumes\n(Agent home mounts at /home/bot)")]
    end

    Web --> Nginx
    Mobile --> Nginx
    Desktop --> Nginx
    ExternalBots --> Nginx

    Nginx --> WebProxy
    WebProxy --> Auth
    Auth --> Postgres
    WebProxy --> Orchestrator
    Web <-->|WebSocket| CollabWS

    Orchestrator <-->|Advisory Locks & LISTEN/NOTIFY| Postgres
    Orchestrator -->|HTTP /agentd| Computerd
    Orchestrator -->|Outbound HTTP/Git| Egress
    Computerd --> DockerStorage
    Postgres --> RealtimeCDC
    RealtimeCDC -->|Live Event Streams| Web
    RealtimeCDC -->|Live Event Streams| Mobile
    RealtimeCDC -->|Live Event Streams| Desktop
```

---

## 3. Monorepo Directory Map & Workspace Breakdown

Sayabot is structured as a Turborepo monorepo powered by `pnpm@10.33.0`:

```
sayabot/
├── apps/
│   ├── web/                     # Next.js 16 App Router web app & collaborative canvas
│   ├── landing/                 # Static marketing site (Next.js SSG export to out/)
│   ├── orchestrator/            # Hono REST & SSE engine, Turn Coordinator, Agent Loop V2
│   ├── computerd/               # Linux sandbox daemon, Docker lifecycle & agentd server
│   ├── egress/                  # Hardened SSRF-safe HTTP proxy & secret broker
│   ├── mobile/                  # React Native / Expo client (iOS/Android) with SQLite cache
│   └── desktop/                 # Electron companion for Mac/Windows host execution
├── packages/
│   ├── core/                    # Zero-dependency domain primitives, capabilities, redaction
│   ├── db/                      # Drizzle ORM schemas, migration runner (0001-0040), RLS
│   └── llm/                     # 17 LLM provider adapters, AES-256 envelope crypto, MCP client
├── deploy/
│   ├── docker/                  # Multi-stage Dockerfiles for all microservices
│   ├── nginx/                   # Reverse proxy configs for WSS (/collab) & SSE streams
│   ├── cloudflare/              # Cloudflare Tunnel zero-trust edge definitions
│   ├── docker-compose.yml       # Production multi-container composition
│   └── deploy.sh                # Zero-downtime rolling update deployment script
├── docs/                        # Complete technical documentation hub & reference library
├── tests/                       # Monorepo integration test suites
├── e2e/                         # Playwright end-to-end browser test suites
├── turbo.json                   # Turborepo task pipeline dependency graph
├── pnpm-workspace.yaml          # Monorepo package glob configurations
└── package.json                 # Monorepo root scripts & dev dependencies
```

### Workspace Packages Summary

| Package / App           | Filter Flag             | Tech Stack                                         | Role & Core Responsibilities                                                                                                                       |
| :---------------------- | :---------------------- | :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`apps/web`**          | `@sayabot/web`          | Next.js 16, React 19, Tailwind CSS v4, Monaco, Yjs | Server-rendered pages, chat composer, visual routine canvas, collaborative live canvas, approval dialogs, settings drawers, and Supabase SSR auth. |
| **`apps/landing`**      | `@sayabot/landing`      | Next.js 16, React 19, Tailwind CSS v4, Canvas      | Static public marketing site (exported to `out/`), high-framerate animated canvas mascot, release download mirrors.                                |
| **`apps/orchestrator`** | `@sayabot/orchestrator` | Hono, Node.js 22+, Vercel AI SDK, pg-boss          | Coordinates turn taking, acquires PostgreSQL advisory locks, executes Agent Loop V2, schedules distributed cron routines, exposes `/api/v1/mcp`.   |
| **`apps/computerd`**    | `@sayabot/computerd`    | Docker Engine API, `agentd`, `node-pty`, CDP       | Spawns and manages persistent container environments (`saaya-bot-${agentId}`), mounts `/home/bot`, runs `agentd` file and execution daemon.        |
| **`apps/egress`**       | `@sayabot/egress`       | Hono, Fastify proxy, Undici                        | In-flight secret placeholder resolution, RFC 1918 private network blocking, loopback prevention, and DNS rebinding defense.                        |
| **`apps/mobile`**       | `@sayabot/mobile`       | Expo SDK 52, React Native, SQLite, Expo Push       | Native iOS & Android client with offline SQLite cache, instant push notifications for tool approvals, and room chat.                               |
| **`apps/desktop`**      | `@sayabot/desktop`      | Electron 33+, Node.js, TypeScript                  | Desktop companion for Mac/Windows, local agent runner for host command execution, guest mode, and workstation pairing.                             |
| **`packages/core`**     | `@sayabot/core`         | Pure TypeScript (Zero-Dep)                         | Capability parsers (`parseCapabilities`), secret redactor (`redactSecrets`), turn state machines, thinking block folding, cron parser.             |
| **`packages/db`**       | `@sayabot/db`           | Drizzle ORM, PostgreSQL, `pg`                      | Database schemas (26 modules), migration runner (0001–0040), database seed script, and RLS policies.                                               |
| **`packages/llm`**      | `@sayabot/llm`          | Vercel AI SDK, `@ai-sdk/*`, AES-256-GCM            | 17-provider model routing, AES-256-GCM envelope crypto (`encryptSecret`, `sealSecret`), MCP client gateway, Langfuse telemetry.                    |

---

## 4. The Five Golden Architectural Rules

The following five architectural invariants govern all code generation, tool implementation, and database modifications across the Sayabot monorepo.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      FIVE GOLDEN ARCHITECTURAL RULES                   │
├────────────────────────────────────────────────────────────────────────┤
│ 1. NEVER hardcode or leak secrets (AES-256-GCM MESH_KEK envelope).     │
│ 2. NEVER bypass room PostgreSQL advisory locks during turn execution.  │
│ 3. Database changes MUST follow Drizzle schemas and SQL migrations.    │
│ 4. Dangerous tools (dangerous: true) MUST pass human approval gates.   │
│ 5. Persistent sandboxes run in Docker bounded strictly to /home/bot.   │
└────────────────────────────────────────────────────────────────────────┘
```

### Rule 1: Zero Plaintext Secrets (AES-256-GCM MESH_KEK Envelope Encryption)

- **Envelope Specification** ([packages/llm/src/crypto.ts](file:///Users/jarvis/saaya/packages/llm/src/crypto.ts)):
  All credentials, OAuth refresh tokens, API keys, webhook signing secrets, and database connection strings are encrypted at rest using AES-256-GCM with a 32-byte master key (`MESH_KEK` or `SAYABOT_KEK`).
  ```typescript
  interface EncryptedSecret {
    ciphertext: string // Base64 encoded payload
    iv: string // Base64 encoded 12-byte initialization vector
    tag: string // Base64 encoded 16-byte authentication tag
  }
  ```
- **Secret Redaction**:
  Strings are scrubbed before storage or display via `redactSecrets()` from `@sayabot/core` across 14 regex patterns (covering AWS keys, GitHub PATs, OpenAI tokens, Slack bot tokens, Anthropic keys, private keys, etc.).
- **Outbound Secret Broker**:
  Agents never see plaintext secrets. Models receive placeholder tokens (e.g. `$SECRET{PROD_DB_URL}`). The orchestrator and egress proxy substitute real credentials in-flight on outbound HTTP requests.

### Rule 2: Strict Advisory Locking (`withRoomLock`)

- Turn execution is strictly serialized per room across all orchestrator instances using PostgreSQL session-level advisory locks ([apps/orchestrator/src/db.ts](file:///Users/jarvis/saaya/apps/orchestrator/src/db.ts)):
  ```typescript
  export async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
    const client = await getPool().connect()
    const key = `mesh:room:${roomId}`
    try {
      await client.query("select pg_advisory_lock(hashtext($1)::bigint)", [key])
      return await fn()
    } finally {
      try {
        await client.query("select pg_advisory_unlock(hashtext($1)::bigint)", [key])
      } finally {
        client.release()
      }
    }
  }
  ```
- Locks are **connection-scoped**; they must acquire a dedicated client from the pool to avoid connection hopping deadlocks.

### Rule 3: Schema-Driven Persistence & RLS Multi-Tenancy

- All persistence changes must be defined in Drizzle ORM schemas under `packages/db/src/schema/*.ts`.
- Snapshots are generated via `pnpm db:generate`.
- Multi-tenant tenant isolation is strictly enforced via PostgreSQL Row Level Security (RLS) policies in `packages/db/sql/`:
  ```sql
  alter table <table_name> enable row level security;
  create policy "<table_name>_org_isolation" on <table_name>
    for all using (org_id in (select org_id from org_members where user_id = auth.uid()));
  ```

### Rule 4: Human-in-the-Loop Approval Gates

- Any tool capable of destructive mutations, file overwrites outside the sandbox, shell execution, external communications, or spending credits must declare `dangerous: true` (or a dynamic danger evaluator function).
- When a dangerous tool is invoked:
  1. Execution halts immediately.
  2. A record is inserted into `tool_calls` with status `pending_approval`.
  3. Real-time events (`tool.approval_requested`) are broadcast via WebSocket and push notifications.
  4. The orchestrator registers a 5-minute approval listener.
  5. If the human operator approves, execution resumes; if rejected or timed out (5 minutes), the tool fails safely.

### Rule 5: Sandboxed Compute Isolation (`/home/bot`)

- Agent workspaces run inside isolated Docker containers named `saaya-bot-${agentId}` managed by `computerd`.
- Persistent storage is mounted strictly at `/home/bot` backed by a dedicated Docker named volume.
- Path operations inside the container are strictly confined:
  ```typescript
  export function isSafePath(targetPath: string): boolean {
    const resolved = path.resolve(targetPath)
    return resolved.startsWith("/home/bot") || resolved.startsWith("/tmp")
  }
  ```
  Any attempt to escape via `..` or external symlinks throws an access denial exception.

---

## 5. Data Plane & Database Schema Catalog

Sayabot leverages PostgreSQL 16+ with the `pgvector` extension, Drizzle ORM, and Supabase Realtime CDC (Change Data Capture).

```mermaid
erDiagram
    ORGANIZATIONS ||--o{ ORG_MEMBERS : contains
    ORGANIZATIONS ||--o{ ROOMS : owns
    ORGANIZATIONS ||--o{ AGENTS : configures
    ORGANIZATIONS ||--o{ WORKSPACE_CONNECTORS : connects
    ORGANIZATIONS ||--o{ VAULT_SECRETS : stores
    ROOMS ||--o{ ROOM_MEMBERS : includes
    ROOMS ||--o{ MESSAGES : records
    ROOMS ||--o{ TURN_SESSIONS : sequences
    ROOMS ||--o{ CANVASES : hosts
    ROOMS ||--o{ TASKS : tracks
    TURN_SESSIONS ||--o{ AGENT_RUNS : executes
    AGENT_RUNS ||--o{ RUN_STEPS : logs
    AGENT_RUNS ||--o{ TOOL_CALLS : audits
    AGENTS ||--o{ MEMORIES : recalls
    AGENTS ||--o{ AGENT_CONNECTOR_GRANTS : receives
```

### 5.1 Schema Domain Inventory

The database schemas in [packages/db/src/schema/](file:///Users/jarvis/saaya/packages/db/src/schema/) are organized into domain modules:

| Schema File     | Table Names                                                                                              | Core Responsibilities                                                                                                             |
| :-------------- | :------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------- |
| `identity.ts`   | `profiles`, `orgs`, `orgMembers`                                                                         | User profiles, organizations, RBAC membership (`owner`, `admin`, `member`, `guest`).                                              |
| `invites.ts`    | `roomInvites`, `workspaceInvites`, `botInvites`, `workspaceJoinRequests`, `oauthClients`, `mergeTickets` | Single-use room invite tokens, workspace invitation links, join requests, OAuth applications, and guest-to-account merge tickets. |
| `agents.ts`     | `agents`, `providerKeys`, `agentToolConfigs`, `agentConnectorGrants`                                     | Agent definitions, model configs, personas (`system_prompt`), API keys, and connector scope grants.                                          |
| `rooms.ts`      | `rooms`, `roomMembers`, `roomSchedules`                                                                  | Multi-agent collaboration rooms, turn modes (`mentions`, `debate`, `moderated`), RPM limits, and daily budgets.                   |
| `messages.ts`   | `messages`                                                                                               | Chat messages, human/agent/system attribution, thread roots, metadata, and token usage.                                           |
| `canvas.ts`     | `canvases`, `canvasVersions`                                                                             | Collaborative documents (Markdown, code, SVG), live content, Yjs update snapshots.                                                |
| `tasks.ts`      | `tasks`, `taskEvents`, `taskComments`                                                                    | Multi-agent task board, assignees, state machine (`open`, `in_progress`, `stuck`, `done`), blockers, and outcomes.                |
| `facts.ts`      | `ownerFacts`                                                                                             | User-specific persistent context and instructions known across all rooms.                                                         |
| `memory.ts`     | `memories`, `memoryEmbeddings`, `memorySources`, `openLoops`, `memoryLinks`, `vectorProviders`           | Cognitive memory system: episodic observations, semantic vectors (pgvector), entity knowledge graphs, and open loops.             |
| `routines.ts`   | `routines`, `routineRuns`                                                                                | Distributed cron routines (Hermes engine), visual n8n-style graphs, execution logs.                                               |
| `meetings.ts`   | `meetings`, `meetingParticipants`                                                                        | Scheduled multi-agent meetings, standups, and summaries.                                                                          |
| `connectors.ts` | `workspaceConnectors`, `connectorQuotas`                                                                 | Enterprise connectors (Slack, Drive, GitHub, Jira, Notion) with AES-256-GCM sealed credentials.                                   |
| `vault.ts`      | `vaultSecrets`                                                                                           | Encrypted organizational secrets referenced via `$SECRET{...}` placeholder tokens.                                                |
| `computers.ts`  | `agentComputers`, `computerSettings`, `computerJobs`                                                     | Persistent computer state, Docker container IDs, placement configs, and asynchronous background jobs.                             |
| `desktop.ts`    | `desktopHosts`, `desktopLocalApps`                                                                       | Paired Mac/Windows companion workstations and local MCP tool caches.                                                              |
| `devices.ts`    | `devicePairings`, `pushSubscriptions`                                                                    | Paired mobile devices, Web Push subscriptions, and APNs/Expo push tokens.                                                         |
| `engine.ts`     | `turnSessions`, `agentRuns`, `runSteps`, `runTranscripts`                                                | Turn coordination sessions, agent reasoning passes, and step-by-step token transcripts.                                           |
| `tools.ts`      | `skills`, `mcpServers`, `toolCalls`                                                                      | Active skills, registered MCP servers (transports: stdio, SSE, HTTP), and audited tool logs.                                      |
| `ops.ts`        | `webhooks`, `webhookDeliveries`, `auditLogs`, `storageUsage`                                             | Inbound/outbound webhooks, security audit events, and storage rollups.                                                            |
| `billing.ts`    | `orgPlans`, `usageRollups`                                                                               | Subscription tiers (`free`, `pro`, `enterprise`, `cloud`), monthly token rollups, and turn quotas.                                |

### 5.2 Migration Catalog (0001–0040)

PostgreSQL routines, triggers, and Row Level Security policies are maintained sequentially in [packages/db/sql/](file:///Users/jarvis/saaya/packages/db/sql/):

- `0001_functions.sql`: Core PostgreSQL utility functions and update timestamp triggers.
- `0002_rls.sql`: Base multi-tenant Row Level Security policies for all tenant tables.
- `0003_realtime.sql`: Supabase Realtime publication configuration (`supabase_realtime` publication).
- `0004_rpc.sql` - `0008_task_integrity.sql`: Stored procedures, task integrity constraints, and agent read tracking.
- `0009_bot_platform.sql` - `0013_auth_oauth_profiles.sql`: Bring-your-own-bot platform, OAuth profiles, and engine persistence.
- `0014_routines.sql` - `0018_workspace_connectors.sql`: Hermes cron routines, cognitive memory tables, vector providers, and connectors.
- `0019_owner_facts.sql` - `0025_storage_summary.sql`: Persistent owner facts, device pairings, desktop hosts, and storage tracking.
- `0026_mobile_push_and_files.sql` - `0030_local_apps_inbound.sql`: Mobile push tokens, MCP OAuth, local app inbound routes.
- `0031_guest_account_merge.sql` - `0035_model_choice.sql`: Guest-to-account merge RPCs, Mac runner tools, and cloud billing tiers.
- `0036_room_execution_mode.sql` - `0040_workspace_join_requests.sql`: Room execution modes (Always Ask, Sensitive Only, Auto, Turbo), agent last-seen tracking, computer providers, and workspace join requests.

---

## 6. The Turn Coordinator & Multi-Agent Execution Engine

The **Turn Coordinator** ([apps/orchestrator/src/coordinator/index.ts](file:///Users/jarvis/saaya/apps/orchestrator/src/coordinator/index.ts)) manages multi-agent reasoning, eliminates concurrency races, handles human interruptions, and ensures deterministic multi-agent collaboration.

```mermaid
sequenceDiagram
    autonumber
    actor User as Human Operator
    participant Web as Web / Mobile UI
    participant DB as PostgreSQL
    participant Coord as Turn Coordinator
    participant Engine as Agent Loop V2
    participant Tool as Tool / computerd
    participant Bus as Realtime Broadcast

    User->>Web: Submits "@maya review pull request"
    Web->>DB: INSERT into messages (senderType: human)
    DB-->>Coord: pg-boss queue / HTTP trigger
    Coord->>Coord: interruptRoom(roomId) (Abort in-flight runs)
    Coord->>DB: Acquire pg_advisory_lock('mesh:room:<id>')
    Note over Coord,DB: Exclusive Session Lock Acquired

    Coord->>Coord: Plan Turn Queue (mentions: @maya)
    Coord->>Bus: broadcast("turn.state", queue: ["maya"])

    Coord->>Engine: startAgentTurn(agent: maya, trigger)
    Engine->>Engine: Assemble context (history, memory, canvas, skills)
    Engine->>Engine: LLM Reasoning Pass (Generate text & tool calls)

    opt Tool Call (Dangerous: e.g. git push)
        Engine->>DB: INSERT tool_calls (status: pending_approval)
        Engine->>Bus: broadcast("tool.approval_requested", callId)
        Web-->>User: Renders 5-minute Approval Card
        User->>Web: Clicks "Approve"
        Web->>Coord: POST /internal/approvals/:id/resolve (approved: true)
        Coord-->>Engine: Approval Unblocked
    end

    Engine->>Tool: Execute Tool (e.g. computer_shell)
    Tool-->>Engine: Stream stdout / exitCode
    Engine->>Engine: Verification Gate (Self-critic check)
    Engine->>DB: INSERT messages (senderType: agent, content)
    Engine-->>Coord: Turn Complete

    Coord->>DB: Release pg_advisory_unlock('mesh:room:<id>')
    Note over Coord,DB: Room Lock Released
    Coord->>Bus: broadcast("turn.state", queue: [])
```

### 6.1 Turn Planning Modes

The room configuration (`rooms.turnMode`) governs how turns are queued:

1. **Mentions Mode (`mentions`)**:
   Agents respond only when explicitly mentioned (e.g. `@maya`, `@coder`, `@all_bots`). If a bot response mentions another bot, `planBotFollowUps()` automatically enqueues the mentioned teammate for a follow-up turn.
2. **Debate Mode (`debate`)**:
   Agents speak sequentially in a pre-configured order (`rooms.debateOrder`), iterating through viewpoints to debate architectural or design decisions.
3. **Moderated Mode (`moderated`)**:
   A designated **Lead Agent** (`rooms.moderatorAgentId`) evaluates the incoming request against each room agent's capabilities. The lead agent auto-selects which specialist responds first (or returns control to `human`).
4. **Autonomous Goal Mode (`/goal`)**:
   Initiated via the `/goal` command ([apps/orchestrator/src/coordinator/goal.ts](file:///Users/jarvis/saaya/apps/orchestrator/src/coordinator/goal.ts)). Agents work autonomously in iterative rounds (up to `GOAL_MAX_ROUNDS = 20`). After each turn, the coordinator automatically re-triggers the agent with goal instructions until the reply ends with `GOAL COMPLETE` or `GOAL BLOCKED`.
5. **Side Notes (`/btw`)**:
   The `/btw` command delivers a non-disruptive note to active agents without interrupting the current turn session or triggering new runs.

### 6.2 Pre-Turn Breakers & Safety Caps

Before executing any turn, `checkPreTurnBreakers()` validates room safety invariants:

- **Turn Cap**: Maximum turns per session (default 12; customizable per task).
- **RPM Limit**: Rate-limiting requests per minute per room.
- **Daily Budget Cap**: Halts room execution if estimated spending exceeds `rooms.dailyBudgetUsd`.
- **Repetition Detector**: Compares the last 4 agent replies using n-gram similarity; if infinite conversational loops or identical tool failures are detected, the session halts with `repetition_halt`.

### 6.3 Interruption Bus (`LISTEN/NOTIFY`)

If a human submits a message while an agent is generating:

1. `interruptRoom(roomId)` is invoked.
2. PostgreSQL emits `NOTIFY mesh_room_interrupt, '<roomId>'`.
3. The active turn's `AbortController` triggers, aborting LLM streaming.
4. Partial assistant tokens are safely persisted, and the coordinator immediately yields execution to the human's higher-priority input.

### 6.4 The Agent Loop V2 & Thinking Blocks

The engine execution loop ([apps/orchestrator/src/engine/run.ts](file:///Users/jarvis/saaya/apps/orchestrator/src/engine/run.ts)):

- **Context Assembly**: Concatenates the harness system prompt (Sayabot's operating rules for every bot), the owner's persona, room directives, owner facts, active skills, collaborative canvas snapshot, and retrieved semantic memories.
- **Thinking Blocks**: Reasoned tokens wrapped in `<thinking>...</thinking>` are extracted via `@sayabot/core/thinking` and folded into collapsible UI rows in the room chat.
- **Token Compaction Ladder**: If the context approaches token limits, a 3-stage compaction pipeline activates:
  1. Strip extra whitespace and comment bloat.
  2. Truncate verbose tool outputs (diffs, logs).
  3. LLM-powered summarization of older turn turns.
- **Verification Gate**: The critic evaluates whether the agent's work satisfies the stated task invariants before marking tasks complete.

---

## 7. Sandboxes, Compute Daemons & Execution Environments

Sayabot provides isolated compute surfaces where agents execute code, manage files, and interact with the web.

```mermaid
flowchart LR
    subgraph Orchestrator["apps/orchestrator"]
        Runner["Agent Runner / Tool Executor"]
    end

    subgraph PlacementRouter["Compute Surface Router"]
        SelectComputer["select_computer Tool"]
    end

    subgraph Sandboxes["Execution Sandboxes"]
        Docker["Local Docker (computerd)\n• saaya-bot-${agentId}\n• Mount: /home/bot\n• agentd Socket Daemon"]
        Boat["Boat Desktops\n• Hosted Linux Desktops\n• WebRTC Remote Viewer\n• Full GUI Display"]
        VPS["VPS-Over-SSH\n• Dedicated Remote Docker\n• Sealed SSH Key (AES-256)\n• Automated Sleep Policy"]
        E2B["E2B MicroVMs\n• Cloud Sandbox API\n• Ephemeral Python/Node"]
        MacRunner["Mac Local Runner\n• Host Terminal Execution\n• Path Boundaries & Approvals\n• Local macOS Tools"]
    end

    Runner --> SelectComputer
    SelectComputer --> Docker
    SelectComputer --> Boat
    SelectComputer --> VPS
    SelectComputer --> E2B
    SelectComputer --> MacRunner
```

### 7.1 Local Container Daemon (`apps/computerd`)

The primary sandbox engine is `computerd`, a background daemon managing container lifecycles:

- **Dedicated Container**: Spawns a hardened Docker container named `saaya-bot-${agentId}` with persistent volume storage mounted at `/home/bot`.
- **The `agentd` Daemon**: Runs inside the container, exposing an internal Unix socket server for low-latency operations:
  - Command execution via `node-pty` with stdout/stderr streaming.
  - File reading, writing, and atomic diff patching.
  - Language Server Protocol (LSP) code intelligence (outline, symbol search).
- **Strict Jail**: All operations enforce `isSafePath()`; access outside `/home/bot` or `/tmp` is rejected with `access denied`.

### 7.2 Cloud Compute Providers

For heavy workloads or environments without local Docker:

- **Boat-Hosted Desktops**: Cloud Linux desktops running XFCE/Kasm with WebRTC streaming into the web app, allowing agents to operate desktop applications.
- **VPS-over-SSH**: Remote Docker hosts connected via encrypted SSH keys stored in the database. Features an automated sleep policy to stop idle cloud instances.
- **E2B MicroVMs**: Ephemeral hardware-virtualized sandboxes for untrusted code execution.

### 7.3 Headless Browser Automation (CDP)

Sayabot embeds a headless Chromium browser controllable via the Chrome DevTools Protocol:

- Tools: `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_eval`.
- Captures real-time DOM states, network requests, console errors, and full-page screenshots streamed directly into chat cards.

---

## 8. Audited Tool System, Secret Broker & SSRF Defense

Sayabot implements an audited execution pipeline where every tool call is validated, audited, and secured.

```mermaid
flowchart TD
    AgentCall["Agent Requests Tool Invocation\n(e.g. computer_shell, web_fetch, slack_send)"]

    subgraph AuditPipeline["Audited Tool Pipeline (toAuditedTools)"]
        ValidateSchema["Zod Schema Validation"]
        CheckDanger{"Is Tool Dangerous?\n(dangerous: true or dynamic rule)"}
        LogPending["INSERT tool_calls\n(status: pending_approval)"]
        NotifyApproval["Broadcast Event & Push\ntool.approval_requested"]
        WaitHuman["Wait for Human Decision\n(5-Minute Countdown)"]
        Decide{Decision?}
        ExecuteTool["Execute Tool Implementation"]
        LogResult["UPDATE tool_calls\n(status: complete, output, duration)"]
        ReturnError["Return Error:\n'Rejected by operator'"]
    end

    subgraph OutboundProxy["Outbound Secret Broker (apps/egress)"]
        InspectPayload["Inspect Outbound Request Body & Headers"]
        DetectPlaceholders["Detect $SECRET{KEY_NAME}"]
        DecryptSecret["Decrypt Secret from Vault (AES-256-GCM)"]
        InjectSecret["Inject In-Flight Plaintext Credential"]
        SSRFCheck{"SSRF Firewall:\nPrivate IP? RFC 1918?\n127.0.0.1? Cloud Metadata?"}
        AllowOutbound["Dispatch Outbound Request to Internet"]
        BlockSSRF["403 Forbidden: Blocked Target IP"]
    end

    AgentCall --> ValidateSchema
    ValidateSchema --> CheckDanger
    CheckDanger -- No --> ExecuteTool
    CheckDanger -- Yes --> LogPending
    LogPending --> NotifyApproval
    NotifyApproval --> WaitHuman
    WaitHuman --> Decide
    Decide -- Approved --> ExecuteTool
    Decide -- Rejected/Timeout --> ReturnError
    ExecuteTool --> LogResult

    ExecuteTool -.->|Outbound HTTP| InspectPayload
    InspectPayload --> DetectPlaceholders
    DetectPlaceholders --> DecryptSecret
    DecryptSecret --> InjectSecret
    InjectSecret --> SSRFCheck
    SSRFCheck -- Safe Public IP --> AllowOutbound
    SSRFCheck -- Blocked IP --> BlockSSRF
```

### 8.1 Tool Inventory (60+ Built-In Tools)

| Category                 | Tool Names                                                                                                                            | Dangerous?                          | Description                                                                                     |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------- | :---------------------------------------------------------------------------------------------- |
| **Computer & Shell**     | `computer_shell`, `computer_read_file`, `computer_write_file`, `computer_patch_file`, `computer_list_directory`, `computer_file_tree` | Dynamic (`write`, `shell` = `true`) | Execute bash commands, read/write files, and manipulate disk state inside `/home/bot`.          |
| **Browser CDP**          | `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_type`, `browser_press_key`, `browser_eval`                        | False                               | Automated Chromium browser control, web scraping, and visual screenshot capture.                |
| **Collaborative Canvas** | `canvas_read`, `canvas_write`, `canvas_patch`                                                                                         | `write` / `patch` = `true`          | Read and edit the room's live collaborative document using structured diffs.                    |
| **Tasks & Project**      | `task_create`, `task_claim`, `task_update`, `task_list`, `task_comment`, `task_close`                                                 | False                               | Manage the multiplayer task board, update blockers, set assignees, and record outcomes.         |
| **Cognitive Memory**     | `remember`, `recall`, `open_loop`, `reflect`, `graph_walk`, `forget`                                                                  | False                               | Store episodic memories, perform semantic searches, update entity graphs, and track open loops. |
| **Web & Knowledge**      | `web_search`, `web_fetch`                                                                                                             | False                               | Query search providers (10 backends) and fetch cleaned, Markdown-formatted web pages.           |
| **Document OCR**         | `document_extract`, `document_ocr`                                                                                                    | False                               | Extract structured Markdown from PDFs, spreadsheets, and scanned documents.                     |
| **Workspaces**           | `workspace_fork`, `workspace_inspect`, `verify_workspace`, `report_findings`                                                          | False                               | Inspect repository directory trees, run test suites, and report verification findings.          |
| **Secret Broker**        | `use_secret`                                                                                                                          | False                               | Request placeholder tokens (`$SECRET{...}`) for outbound API communication.                     |
| **Cron & Schedule**      | `cronjob_schedule`, `cronjob_delete`                                                                                                  | True                                | Schedule autonomous background routines and periodic agent check-ins.                           |

### 8.2 Outbound Secret Broker & SSRF Defense

The egress proxy ([apps/egress/src/index.ts](file:///Users/jarvis/saaya/apps/egress/src/index.ts)) ensures that models never touch raw credentials:

1. **Zero-Knowledge Token Swapping**: Outbound requests carry placeholders like `$SECRET{STRIPE_KEY}`. The egress proxy intercepts the request, decrypts the secret using `MESH_KEK`, and injects it directly into outbound HTTP headers.
2. **Hardened SSRF Firewall**: Egress requests are strictly validated against IP blocklists:
   - Private subnets: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`.
   - Loopback addresses: `127.0.0.0/8`, `::1`.
   - Link-local & Cloud Metadata: `169.254.169.254` (AWS/GCP metadata services).
   - DNS Rebinding Mitigation: Resolves DNS before dispatch and pins socket connections to verified public IPs.

---

## 9. Workspace Connectors & Universal MCP Gateway

Sayabot connects external enterprise services and coding clients into a cohesive communication graph.

### 9.1 Two-Tier Security Model

```
┌─────────────────────────────────────────────────────────────┐
│ TIER 1: Workspace-Level Configuration (Admin Settings)      │
│ • Admin authenticates OAuth or enters API token             │
│ • Token sealed via AES-256-GCM into workspace_connectors    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ TIER 2: Granular Agent Grants (agent_connector_grants)      │
│ • Agents assigned explicit scopes (readOnly: true)          │
│ • Folder / Channel restrictions (e.g. #eng-support only)    │
│ • Mutating actions strictly flagged dangerous: true         │
└─────────────────────────────────────────────────────────────┘
```

Supported Connectors:

- **Slack & Discord**: Bi-directional message syncing, channel monitoring, thread replies.
- **GitHub**: Repository exploration, issue triage, branch creation, pull request creation.
- **Google Drive**: Document search, file reading, structured export.
- **Jira & Notion**: Ticket reading, status transitions, workspace page drafting.
- **Telegram & WhatsApp**: Mobile channel inbound message intake.

### 9.2 Universal MCP Gateway (`/api/v1/mcp`)

Sayabot exposes a complete Model Context Protocol (MCP) JSON-RPC gateway:

- **Server Role**: External tools like **Claude Code**, **OpenAI Codex CLI**, or **Cursor** connect to Sayabot over SSE/HTTP at `/api/v1/mcp` using room bot keys. They gain instant access to room tasks, live canvases, memories, and computer sandboxes.
- **Client Role**: The orchestrator connects to external MCP servers configured by users (supporting `stdio`, `sse`, and `http` transports with OAuth PKCE token exchange).

---

## 10. Cognitive Memory Architecture & The Dream Cycle

Sayabot implements an associative, multi-layer cognitive memory architecture ([apps/orchestrator/src/memory/](file:///Users/jarvis/saaya/apps/orchestrator/src/memory/)).

```mermaid
flowchart TD
    subgraph Intake["Intake & Observation"]
        Turn["Agent Turn Interactions & Chat Messages"]
        Extract["Extraction Heuristics (Salience & Importance)"]
    end

    subgraph MemoryStore["Cognitive Memory Store"]
        Working["Working Memory (Room Context Window)"]
        Episodic["Episodic Memories (Specific Events & Facts)"]
        Semantic["Semantic Vector Store (pgvector Embeddings)"]
        Graph["Entity Knowledge Graph (Nodes & Links)"]
        OpenLoops["Open Loops (Pending Commitments & Questions)"]
    end

    subgraph DreamCycle["Dream Cycle Background Scheduler"]
        Cluster["Memory Clustering & Deduplication"]
        Synthesize["Belief Synthesis & Contradiction Resolution"]
        GarbageCollect["TTL Decay & Salience Pruning"]
    end

    subgraph DiskMirror["Filesystem Mirror (/home/bot/.saaya/memory/)"]
        MarkdownFiles["Markdown Files (MEMORY.md, beliefs.md, graph.md)"]
    end

    Turn --> Extract
    Extract --> Episodic
    Extract --> Semantic
    Extract --> Graph
    Extract --> OpenLoops

    Episodic --> Cluster
    Cluster --> Synthesize
    Synthesize --> Beliefs["Core Beliefs & Assumptions"]
    Episodic --> GarbageCollect

    Beliefs --> MarkdownFiles
    Episodic --> MarkdownFiles
    MarkdownFiles -->|CLI Native Access| AgentTools["Agent Terminal Tools (cat, grep)"]
```

### 10.1 The 9 Memory Modules

1. **Working Memory**: In-context immediate history and active canvas state.
2. **Episodic Memory**: Discrete episodic observations persisted with importance scores (1–10).
3. **Semantic Memory**: High-dimensional vector embeddings stored via `pgvector` for cosine similarity retrieval.
4. **Knowledge Graph**: Directed graph of entities (e.g. `User -> maintains -> Repository`) and relationship links.
5. **Open Loops**: Commitments, follow-up promises, and unresolved questions tracked until explicitly closed.
6. **Beliefs Engine**: Synthesized world model facts compiled from repeated observations.
7. **Salience Engine**: Scoring pipeline that computes recall priority based on recency, frequency, and relevance.
8. **Dream Cycle**: Periodic background worker that clusters related memories, consolidates beliefs, and purges transient noise.
9. **Disk Mirror**: Bi-directional mirror syncing database memories to `/home/bot/.saaya/memory/`, enabling agents to search their memory using standard bash tools (`grep`, `cat`).

---

## 11. Multi-Platform Client Applications

Sayabot delivers a responsive experience across Web, Desktop, and Mobile surfaces.

### 11.1 Web Application (`apps/web`)

- **Next.js 16 & React 19**: App Router, Server Components, and Server Actions.
- **Collaborative Live Canvas**: Yjs CRDTs backed by Hocuspocus WebSocket synchronization, featuring Monaco editor bindings, simultaneous multi-user cursors, and instant version history restore.
- **Visual Routine Workflow Canvas**: n8n-style interactive node graph editor for scheduling automated cron routines.
- **Real-time SSE Streaming**: Low-latency token generation streaming with collapsible `<thinking>` reasoning drawers.

### 11.2 Desktop Companion (`apps/desktop`)

- **Electron Shell**: Packaged for macOS (Apple silicon & Intel DMG) and Windows 10/11 (NSIS installer).
- **Mac Local Runner**: Allows agents to run local Mac terminal commands and file edits under strict user supervision (`Always Ask`, `Sensitive Only`, `Auto`, `Turbo` modes).
- **Guest Mode**: Instant trial mode using Supabase anonymous authentication without requiring upfront account creation.
- **Auto-Update Engine**: In-app zero-friction updates signed via Apple Developer ID and notarized.

### 11.3 Mobile Client (`apps/mobile`)

- **Expo SDK 52 & React Native**: Native iOS and Android builds.
- **Offline SQLite Cache**: Instant screen transitions and local caching of messages, tasks, and rooms.
- **Push Turn Approvals**: High-priority push notifications allowing users to review and approve dangerous tool invocations in one tap while away from their workstation.

### 11.4 Landing Site (`apps/landing`)

- **High-Performance Static Site**: Built with Next.js static HTML export (`out/`).
- **60fps Mascot Animation**: Canvas-rendered mascot geometry (`@sayabot/core/mascot`).

---

## 12. LLM Infrastructure, Provider Adapters & Cost Engine

The `@sayabot/llm` package provides an enterprise abstraction across 17 AI providers:

```
Anthropic · OpenAI · Google Gemini · DeepSeek · Ollama · Groq · Mistral · xAI Grok · AWS Bedrock · Azure OpenAI · OpenRouter · Cohere · Together · Perplexity · Fireworks · Cerebras · Cloudflare Workers AI
```

### 12.1 Dynamic Model Resolution & Effort Ladders

- Models support **Effort Ladders** (e.g. `low`, `medium`, `high`, `max`), dynamically configuring reasoning token budgets for models like Claude 3.7 Sonnet thinking mode, OpenAI o1/o3-mini, and DeepSeek R1.
- Automatic graceful fallback: If a provider experiences rate limits (HTTP 429) or service degradation, the runner can fall back to equivalent tier models.

### 12.2 Langfuse Observability & Telemetry

- Optional tracing integration via Langfuse ([packages/llm/src/langfuse.ts](file:///Users/jarvis/saaya/packages/llm/src/langfuse.ts)).
- Captures full generation traces, input/output token counts, execution latencies, tool parameters, and calculated costs per run.

### 12.3 Real-Time Cost Accounting

- Comprehensive token pricing tables maintained in `@sayabot/core/cost`.
- Calculates exact costs per turn based on cached input tokens, raw input tokens, and output completion tokens.
- Monthly rollups in `usage_rollups` enforce plan budget limits (`free`, `pro`, `enterprise`).

---

## 13. Deployment, Operations & Production Runbooks

### 13.1 Production Deployment Options

1. **Single-Node Docker Compose** ([deploy/docker-compose.yml](file:///Users/jarvis/saaya/deploy/docker-compose.yml)):
   Deploys `web`, `orchestrator`, `computerd`, `egress`, `postgres`, and `nginx` on a single VPS (e.g. Ubuntu 24.04 LTS).
2. **Managed Cloud (Supabase + Containers)**:
   Uses managed Supabase for PostgreSQL, Auth, and Realtime CDC, paired with containerized backend services on AWS ECS, Fly.io, or Railway.
3. **Cloudflare Tunnel Integration** ([deploy/cloudflare/](file:///Users/jarvis/saaya/deploy/cloudflare/)):
   Exposes the platform securely without open inbound firewall ports.

### 13.2 Environment Variables Reference

| Variable                        | Service           | Required? | Description                                                             |
| :------------------------------ | :---------------- | :-------- | :---------------------------------------------------------------------- |
| `MESH_KEK`                      | All               | **Yes**   | 32-byte Base64/Hex master key for AES-256-GCM envelope encryption.      |
| `DATABASE_URL`                  | Orchestrator, DB  | **Yes**   | PostgreSQL connection string (`postgresql://user:pass@host:5432/db`).   |
| `NEXT_PUBLIC_SUPABASE_URL`      | Web, Mobile       | **Yes**   | Public URL for Supabase Auth and Realtime CDC.                          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Web, Mobile       | **Yes**   | Public Supabase anonymous API key.                                      |
| `SUPABASE_SERVICE_ROLE_KEY`     | Orchestrator, Web | **Yes**   | Superuser Supabase service role key for admin operations.               |
| `INTERNAL_API_SECRET`           | Orchestrator, Web | **Yes**   | Shared secret authorizing internal service-to-service calls.            |
| `SAYABOT_EDITION`               | All               | No        | `community` (AGPL-3.0) or `cloud` (Stripe billing enabled).             |
| `ANTHROPIC_API_KEY`             | Orchestrator      | Optional  | Default server key for Claude models.                                   |
| `OPENAI_API_KEY`                | Orchestrator      | Optional  | Default server key for OpenAI models.                                   |
| `GEMINI_API_KEY`                | Orchestrator      | Optional  | Default server key for Google Gemini models.                            |
| `DEEPSEEK_API_KEY`              | Orchestrator      | Optional  | Default server key for DeepSeek models.                                 |
| `EGRESS_PROXY_URL`              | Orchestrator      | Optional  | HTTP proxy URL for outbound SSRF-safe requests (`http://egress:8080`).  |
| `COMPUTERD_URL`                 | Orchestrator      | Optional  | HTTP endpoint for the compute sandbox daemon (`http://computerd:4000`). |

### 13.3 Zero-Downtime Deployment Pipeline (`deploy/deploy.sh`)

The deployment script executes a 6-phase preflight verification before rolling containers:

1. Validates `MESH_KEK` cryptographic integrity.
2. Checks PostgreSQL connectivity and runs pending Drizzle/SQL migrations (`pnpm db:migrate`).
3. Builds Docker images with cached layers.
4. Starts new container instances and validates health check endpoints (`/health`).
5. Switches traffic gracefully via Nginx reload.
6. Prunes obsolete Docker images and volumes.

---

## 14. Developer Guide, Testing & Quality Assurance

### 14.1 Exact Development Commands

All commands are executed from the repository root using `pnpm`:

```bash
# Install all dependencies across the monorepo
pnpm install

# Start all applications concurrently in development mode
pnpm dev

# Build all packages and applications via Turborepo
pnpm build

# Typecheck all workspaces
pnpm typecheck

# Run unit tests across all workspaces via Vitest
pnpm test:unit

# Run backend integration test suite
pnpm test:integration

# Run Playwright end-to-end browser tests
pnpm e2e

# Generate database migrations after editing schemas
pnpm db:generate

# Apply migrations to database
pnpm db:migrate

# Seed database with templates and default pricing
pnpm db:seed

# Format code with Prettier
pnpm format

# Lint code across all workspaces
pnpm lint
```

### 14.2 Code Standards & Engineering Guidelines

- **Strict TypeScript**: `noImplicitAny: true`, strict null checks. No non-null assertions (`!`) in application code.
- **Prettier Rules**: No semicolons (`semi: false`), double quotes (`singleQuote: false`), print width 100.
- **Unused Variables**: Must be prefixed with an underscore (`_req`, `_signal`).
- **Test Co-location**: Unit tests must sit adjacent to source code: `service.ts` -> `service.test.ts`.

---

## 15. Comprehensive Codebase Directory Map

```
sayabot/
├── apps/
│   ├── computerd/                       # Persistent compute daemon
│   │   ├── agentd/                      # Container-internal agentd daemon (files, terminal, lsp)
│   │   └── src/                         # Docker container management, lifecycle, capacity
│   ├── desktop/                         # Electron companion app
│   │   └── src/                         # Host execution, Mac local runner, guest mode, updater
│   ├── egress/                          # Hardened outbound proxy
│   │   └── src/                         # SSRF firewall, in-flight $SECRET{...} resolution
│   ├── landing/                         # Static marketing website
│   │   └── src/                         # Animated canvas mascot, downloads showcase
│   ├── mobile/                          # Expo / React Native mobile app
│   │   └── src/                         # Offline SQLite cache, screens, push notifications
│   ├── orchestrator/                    # Core execution & turn engine
│   │   └── src/
│   │       ├── bot/                     # Bring-your-own-bot HTTP endpoints
│   │       ├── canvas/                  # Hocuspocus CRDT canvas persistence & tools
│   │       ├── collab/                  # Task board service, message posting
│   │       ├── computers/               # Compute placement (Docker, Boat, VPS, E2B)
│   │       ├── connectors/              # Enterprise connector clients (Slack, Drive, Jira)
│   │       ├── coordinator/             # Turn Coordinator, pg_advisory_lock, /goal loop
│   │       ├── engine/                  # Agent Loop V2, planner, critic, compaction, subagents
│   │       ├── internal/                # Service-to-service RPC routes & job handlers
│   │       ├── jobs/                    # pg-boss background workers & queues
│   │       ├── mcp/                     # Exposed MCP JSON-RPC server (/api/v1/mcp)
│   │       ├── memory/                  # 9-module cognitive memory engine & dream cycle
│   │       ├── runner/                  # LLM runners, CLI runners, context builders
│   │       ├── scheduler/               # Hermes distributed cron scheduler & meetings
│   │       └── tools/                   # Audited tool registry & 60+ built-in tools
│   └── web/                             # Next.js 16 collaborative web app
│       └── src/
│           ├── app/                     # Next.js App Router (pages, API routes, layout)
│           ├── components/              # Chat composer, Monaco canvas, settings drawers
│           └── lib/                     # Client state, Supabase browser client, Yjs hooks
├── packages/
│   ├── core/                            # Pure domain logic (zero external dependencies)
│   │   └── src/                         # Capabilities, secret redaction, cron, thinking, cost
│   ├── db/                              # Relational database layer
│   │   ├── migrations/                  # Drizzle ORM migration snapshots
│   │   ├── sql/                         # 40 sequential SQL migrations (RLS, routines, triggers)
│   │   └── src/                         # Drizzle table schemas (26 modules) & seed data
│   └── llm/                             # Multi-provider LLM abstraction
│       └── src/                         # 17 model adapters, AES-256 crypto, MCP client
├── deploy/                              # Deployment configs (Docker Compose, Nginx, Cloudflare)
├── docs/                                # Technical documentation hub & 180+ reference guides
├── tests/                               # Integration test suites
└── e2e/                                 # Playwright browser end-to-end tests
```

---

> _For detailed per-feature references covering every tool, route, and database schema, see the [Sayabot Documentation Hub](file:///Users/jarvis/saaya/docs/README.md)._
