# AGENTS.md — Autonomous Agent Operational Manual

> **High-Priority Operational Guide for AI Coding Agents**  
> _Target audience: Claude, Cursor, Copilot, Antigravity, Codex, Hermes, Windsurf, OpenClaw, and automated CI agents._  
> _Read this document completely before proposing, generating, modifying, or refactoring code in this repository._

---

## 1. System Overview & Core Philosophy

**Sayabot** is an open-source, full-stack autonomous remote agent platform and multiplayer collaboration workspace. Human teams and AI agents share persistent rooms, execute deterministic turns, collaborate on real-time canvases, operate isolated Linux computers (`computerd`), and connect external knowledge sources via fine-grained workspace connectors and MCP.

### Key Tenets

1. **Deterministic Multi-Agent Turns**: Turn execution is strictly serialized per room using PostgreSQL advisory locks. Agents take turns without race conditions or state clobbering.
2. **Zero Plaintext Secrets**: All sensitive credentials (API tokens, OAuth tokens, webhooks, database connection strings) are sealed using AES-256-GCM envelope encryption via `MESH_KEK`.
3. **Audited & Human-Gated Execution**: Every tool invocation is logged in the database (`tool_calls`). Destructive or externally visible operations (`dangerous: true`) MUST halt execution and wait for human approval.
4. **Sandboxed Compute**: High-privilege agent workloads execute inside isolated Docker containers managed by `computerd`, bounded strictly to `/home/bot` and `/tmp`.
5. **Schema-Driven Architecture**: All data persistence strictly adheres to Drizzle ORM schemas in `packages/db/src/schema/` paired with SQL migrations in `packages/db/sql/`.

---

## 2. Monorepo Directory Map

Sayabot is structured as a Turborepo monorepo powered by `pnpm@10`:

```
sayabot/
├── apps/
│   ├── web/                     # Next.js 16 (App Router), React 19, Tailwind CSS, Server Actions, Live Canvas UI
│   ├── orchestrator/            # Hono HTTP & SSE engine, Turn Coordinator, Agent Loop V2, Tools, Connectors, Cron
│   ├── computerd/               # Persistent Linux Docker sandbox daemon, agentd file & terminal daemon (/home/bot)
│   ├── egress/                  # Hardened SSRF-safe HTTP proxy, IP filtering (RFC 1918 blocks), DNS rebinding defense
│   ├── mobile/                  # React Native / Expo iOS & Android client with offline SQLite cache & push turns
│   └── desktop/                 # Electron / desktop wrapper for local workstation management & canvas windows
├── packages/
│   ├── core/                    # Shared types, capabilities parser, secret redactor, fold keys, turn state machine
│   ├── db/                      # Drizzle ORM schemas, migration runner, seed script, raw SQL migrations (0001-0025)
│   └── llm/                     # Multi-provider LLM abstraction (Anthropic, OpenAI, DeepSeek, Gemini, Ollama), AES-256-GCM crypto
├── deploy/
│   ├── docker/                  # Dockerfiles for web, orchestrator, computerd, egress
│   ├── nginx/                   # Reverse proxy config for WSS (/collab), SSE (/api/v1/stream), webhooks
│   ├── cloudflare/              # Cloudflare Tunnel config and edge rules
│   ├── docker-compose.yml       # Production & self-hosting multi-container compose definition
│   └── deploy.sh                # Zero-downtime rolling update script with preflight checks and migrations
├── docs/                        # Complete user, developer, and operational documentation hub
├── tests/                       # Integration test suites and runner scripts
├── e2e/                         # Playwright end-to-end browser test suites
├── turbo.json                   # Turborepo task pipeline and cache dependency topology
├── pnpm-workspace.yaml          # Monorepo package glob definitions
└── package.json                 # Monorepo root scripts and dev dependencies
```

### Monorepo Packages Breakdown

| Package / App       | NPM Filter              | Role & Dependencies                                                                                                                                                                                 |
| :------------------ | :---------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`          | `@sayabot/web`          | User interface: Room chat, real-time Yjs Monaco collaborative canvas, n8n-style visual workflow editor, settings, connector OAuth flows. Depends on `@sayabot/core`, `@sayabot/db`, `@sayabot/llm`. |
| `apps/orchestrator` | `@sayabot/orchestrator` | Core execution engine: Hono REST/SSE server, Turn Coordinator, room PostgreSQL advisory locks, Agent Loop V2 (planner, critic, subagents), tool execution, connectors, Hermes cron scheduler.       |
| `apps/computerd`    | `@sayabot/computerd`    | Computer sandbox daemon: Manages persistent Docker containers (`saaya-bot-${agentId}`), mounts `/home/bot`, runs `agentd` socket server for command execution and file edits.                       |
| `apps/egress`       | `@sayabot/egress`       | SSRF-safe outbound fetch proxy: Enforces private IP blocklists (blocks 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8, 169.254.169.254), mitigates DNS rebinding.                           |
| `apps/mobile`       | `@sayabot/mobile`       | Mobile app: Expo / React Native client supporting push notifications, background task sync, room chats, and canvas preview.                                                                         |
| `apps/desktop`      | `@sayabot/desktop`      | Desktop app: Electron companion for pairing workstation resources and managing local developer tools.                                                                                               |
| `packages/core`     | `@sayabot/core`         | Core business primitives: Capabilities parser (`parseCapabilities`), secret redactor (`redactSecrets`), turn tokens, mention extractors, ask/response protocol.                                     |
| `packages/db`       | `@sayabot/db`           | Database layer: Drizzle schemas, PostgreSQL client (`createDb`), migration engine (`packages/db/src/migrate.ts`), seeds, and SQL migration files (`0001` - `0025`).                                 |
| `packages/llm`      | `@sayabot/llm`          | AI client & crypto: LLM adapters (Claude, GPT, DeepSeek, Gemini), AES-256-GCM envelope crypto (`encryptSecret`, `decryptSecret`, `sealSecret`, `openSecret`), MCP client gateway.                   |

---

## 3. Exact Turborepo & pnpm Commands

AI agents must always run commands using `pnpm` from the repository root:

### Development & Builds

```bash
# Start all services concurrently in development mode
pnpm dev

# Build all packages and applications according to turbo dependency graph
pnpm build

# Start a specific app in development mode
pnpm --filter @sayabot/orchestrator dev
pnpm --filter @sayabot/web dev
pnpm --filter @sayabot/computerd dev
```

### Typechecking & Linting

```bash
# Typecheck all packages in the monorepo
pnpm typecheck

# Typecheck a single package
pnpm --filter @sayabot/orchestrator typecheck
pnpm --filter @sayabot/web typecheck
pnpm --filter @sayabot/db typecheck

# Run ESLint across all workspaces
pnpm lint

# Format codebase with Prettier
pnpm format
```

### Testing Suites

```bash
# Run all unit tests across all packages
pnpm test

# Run tests for a specific workspace
pnpm --filter @sayabot/orchestrator test
pnpm --filter @sayabot/web test
pnpm --filter @sayabot/core test
pnpm --filter @sayabot/db test
pnpm --filter @sayabot/llm test
pnpm --filter @sayabot/computerd test

# Run all unit test suites in parallel via Turbo
pnpm test:unit

# Run backend integration tests
pnpm test:integration

# Run Playwright end-to-end tests
pnpm e2e
pnpm test:e2e:api
```

### Database Operations

```bash
# Generate Drizzle migrations after editing packages/db/src/schema/*.ts
pnpm db:generate

# Apply all pending migrations (Drizzle snapshots + packages/db/sql/*.sql)
pnpm db:migrate

# Seed the database with default agent templates, routines, and orgs
pnpm db:seed
```

---

## 4. The Five Golden Architectural Rules

These rules are non-negotiable. Any pull request or automated commit that violates these rules will fail security audits and be rejected.

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

---

### Rule 1: Never Hardcode or Leak Secrets; Use AES-256-GCM MESH_KEK Envelope Encryption

All credentials, OAuth tokens, API keys, webhook signing secrets, and database connection strings are encrypted at rest using AES-256-GCM with a 32-byte master key (`MESH_KEK` or `SAYABOT_KEK`).

#### Envelope Crypto Specification (`packages/llm/src/crypto.ts`)

```typescript
import { decryptSecret, encryptSecret, openSecret, sealSecret } from "@sayabot/llm"

// Encryption returns an EncryptedSecret envelope
interface EncryptedSecret {
  ciphertext: string // Base64
  iv: string // Base64 (12 bytes)
  tag: string // Base64 (16 bytes auth tag)
}

// Storing secrets in separate columns (e.g. workspace_connectors):
const { ciphertext, iv, tag } = encryptSecret(rawApiToken, process.env.MESH_KEK!)

// Storing secrets in single-column text (e.g. vault, mcp_servers.headers_enc):
const sealed = sealSecret(JSON.stringify({ apiKey: "sk-..." }), process.env.MESH_KEK!)
const plaintext = openSecret(sealed, process.env.MESH_KEK!)
```

#### Secret Redaction Rules

- **Never** print raw secrets to logs, stdout, SSE streams, or database messages.
- Always scrub strings before storing or sending to the model using `redactSecrets()` from `@sayabot/core`:
  ```typescript
  import { redactSecrets } from "@sayabot/core"
  const scrubbed = redactSecrets(rawOutput).text
  ```
- **Outbound Secret Broker (`use_secret` tool)**: Agents never see plaintext secrets. In rooms, secrets are referenced by placeholder tokens (e.g. `$SECRET{PROD_API_KEY}`). The orchestrator dynamically resolves and injects secrets directly before executing authorized outbound HTTP requests.

---

### Rule 2: Never Bypass Room PostgreSQL Advisory Locks During Turn Execution

In multiplayer rooms, multiple users, webhooks, or scheduled routines can trigger turns simultaneously. If two agent loops execute concurrently for the same room, they can clobber messages, duplicate tool executions, or corrupt canvas states.

#### Advisory Lock Pattern (`apps/orchestrator/src/db.ts`)

```typescript
/**
 * Serializes every turn for a room across all orchestrator instances.
 * Uses a dedicated connection because session advisory locks are connection-scoped.
 */
export async function withRoomLock<T>(roomId: string, fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  const key = `mesh:room:${roomId}`
  try {
    // Acquire exclusive session-level advisory lock
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

#### Lock Execution Mandates

- Every agent turn in `apps/orchestrator/src/coordinator/index.ts` **MUST** be wrapped in `withRoomLock(roomId, async () => { ... })`.
- Advisory locks are **connection-scoped**. You must acquire a dedicated client from `getPool().connect()`, lock it, run the logic, unlock it, and release the client in a `finally` block.
- **Never** call advisory locks on ad-hoc pooled queries (`pool.query(...)`), because consecutive queries might run on different physical connections, causing deadlocks or failure to unlock.

---

### Rule 3: Database Changes MUST Follow Drizzle Schema Migrations

Sayabot uses **Drizzle ORM** for type-safe database queries and migrations, combined with PostgreSQL routines and Row Level Security (RLS) in `packages/db/sql/`.

#### Workflow for Changing Database Schemas

1. **Modify Schema**: Edit or add table definitions in `packages/db/src/schema/<domain>.ts`.
   ```typescript
   // Example in packages/db/src/schema/my_feature.ts
   import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core"
   import { orgs } from "./identity"

   export const myFeature = pgTable("my_feature", {
     id: uuid("id").primaryKey().defaultRandom(),
     orgId: uuid("org_id")
       .notNull()
       .references(() => orgs.id, { onDelete: "cascade" }),
     name: text("name").notNull(),
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
   })
   ```
2. **Export Schema**: Re-export tables and types in `packages/db/src/schema/index.ts` and `packages/db/src/index.ts`.
3. **Generate Migration**:
   ```bash
   pnpm db:generate
   ```
   This generates a snapshot and SQL file in `packages/db/migrations/`.
4. **Add SQL Routines / RLS**: If the table needs RLS policies or PostgreSQL triggers, add a sequential script in `packages/db/sql/` (e.g. `0026_my_feature_rls.sql`).
   - Every tenant table with `org_id` **MUST** have RLS enabled and policies ensuring users can only read/write their organization's records:
   ```sql
   alter table my_feature enable row level security;
   create policy "my_feature_org_isolation" on my_feature
     for all using (org_id in (select org_id from org_members where user_id = auth.uid()));
   ```
5. **Apply Migration**: Run `pnpm db:migrate` which executes both Drizzle snapshots and raw SQL migrations in sorted order.

---

### Rule 4: Dangerous Tools (`dangerous: true`) MUST Pass Through Human Approval Gates

Sayabot implements an asynchronous human-in-the-loop approval gate for any tool capable of destructive mutations or unverified external interactions.

#### Tool Specification Interface (`apps/orchestrator/src/tools/audited.ts`)

```typescript
export interface ToolSpec {
  name: string
  description: string
  schema: z.ZodType
  dangerous: boolean | ((args: Record<string, unknown>) => boolean)
  execute: (args: any, signal?: AbortSignal, ctx?: ToolContext) => Promise<unknown>
}
```

#### Human Approval Lifecycle Flowchart

```
                [ Agent Requests Tool Execution ]
                               │
                     Is tool dangerous?
                     ├── No  ──► [ Execute Tool Immediately ] ──► [ Return Result ]
                     └── Yes
                           │
             ┌─────────────┴─────────────┐
             │ Record in `tool_calls`    │
             │ status: "pending_approval"│
             └─────────────┬─────────────┘
                           │
             ┌─────────────┴─────────────┐
             │ Broadcast Realtime Event  │
             │ `tool.approval_requested` │
             │ Send Push Notification    │
             └─────────────┬─────────────┘
                           │
             ┌─────────────┴─────────────┐
             │ Wait for Human Decision   │
             │ waitForApproval(callId)   │
             └─────────────┬─────────────┘
                           │
             ┌─────────────┴─────────────┐
             ├── Approved ──► [ Execute Tool ] ──► [ Return Result ]
             └── Rejected ──► Return { ok: false, error: "Rejected by operator" }
```

#### What Tools MUST Be Marked `dangerous: true`?

- Writing or deleting files outside the sandbox.
- Executing unrestricted terminal commands (`bash`).
- Outbound connector actions that produce external changes (e.g. `slack_send_message`, deleting Google Drive files, creating GitHub PRs).
- Database write queries (`INSERT`, `UPDATE`, `DELETE`, `DROP`).
- Modifying cron routines or sensitive organization settings.

---

### Rule 5: Persistent Sandboxes (`computerd`) Run in Isolated Docker Containers with `/home/bot`

Sayabot provides persistent Linux compute environments to agents via the `computerd` daemon.

#### Sandbox Architecture

- Each agent receives a dedicated Docker container named `saaya-bot-${agentId}` running a hardened Alpine/Ubuntu image with `agentd`.
- **Persistent Storage**: Backed by a dedicated Docker volume mounted at `/home/bot`:
  ```bash
  docker run -d --name saaya-bot-${agentId} \
    -v saaya-bot-${agentId}:/home/bot:rw \
    sayabot-sandbox:latest
  ```
- **Strict Confinement (`apps/computerd/agentd/files.ts`)**:
  Path operations are strictly validated against allowed root paths (`/home/bot` and `/tmp`).
  ```typescript
  export function isSafePath(targetPath: string): boolean {
    const resolved = path.resolve(targetPath)
    return resolved.startsWith("/home/bot") || resolved.startsWith("/tmp")
  }
  ```
  Any attempt at path traversal (`/home/bot/../../etc/passwd` or traversing symlinks outside `/home/bot`) throws:
  `"access denied: path must be inside /home/bot or /tmp"`.
- **Environment & Non-Interactive Defaults**:
  Agent processes run as a non-privileged `bot` user. Environment variables are loaded strictly from `/home/bot/.saaya/env`.

---

## 5. Adding a New Tool: Step-by-Step Guide

Follow this guide to implement a new built-in tool in the orchestrator.

### Step 1: Create the Tool File

Create `apps/orchestrator/src/tools/builtins/<tool_name>.ts`:

```typescript
import { z } from "zod"
import type { ToolSpec } from "../audited"

export interface MyToolOptions {
  orgId: string
  agentId: string
  roomId?: string
}

export function myTool(opts: MyToolOptions): ToolSpec {
  return {
    name: "my_custom_tool",
    description: "Explain clearly what this tool does, its inputs, and expected output.",
    schema: z.object({
      target: z.string().min(1).describe("Target resource identifier"),
      action: z.enum(["analyze", "transform"]).describe("Action to perform"),
      dryRun: z.boolean().default(true).describe("If true, performs a preview without changes"),
    }),
    // Can be a boolean or dynamic function based on arguments
    dangerous: (args) => args.dryRun === false,
    execute: async (
      input: { target: string; action: string; dryRun: boolean },
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) {
        throw new Error("Tool execution aborted before completion.")
      }

      // Business logic implementation
      return {
        ok: true,
        target: input.target,
        result: `Completed ${input.action} (dryRun: ${input.dryRun})`,
      }
    },
  }
}
```

### Step 2: Register in `apps/orchestrator/src/tools/index.ts`

Import your tool factory and add it to `buildTools()` based on agent capabilities:

```typescript
import { myTool } from "./builtins/my-custom-tool"

// In buildTools():
const specs: ToolSpec[] = [
  // ... other tools
  ...(caps.myCapability
    ? [myTool({ orgId: args.orgId, agentId: args.agent.id, roomId: args.roomId })]
    : []),
]
```

### Step 3: Update Capabilities in `packages/core/src/capabilities.ts`

If your tool requires a new agent capability flag, add it to `AgentCapabilities` and `agentCapabilitiesSchema`:

```typescript
export interface AgentCapabilities {
  // ...
  myCapability: boolean
}
```

### Step 4: Write Vitest Unit Tests

Create `apps/orchestrator/src/tools/builtins/<tool_name>.test.ts`:

```typescript
import { describe, expect, it } from "vitest"
import { myTool } from "./my-custom-tool"

describe("my_custom_tool", () => {
  const tool = myTool({ orgId: "org-test-1", agentId: "agent-test-1" })

  it("evaluates dangerous flag dynamically", () => {
    const isDangerous = typeof tool.dangerous === "function" ? tool.dangerous : () => tool.dangerous
    expect(isDangerous({ target: "test", action: "analyze", dryRun: true })).toBe(false)
    expect(isDangerous({ target: "test", action: "analyze", dryRun: false })).toBe(true)
  })

  it("executes successfully", async () => {
    const res = (await tool.execute({ target: "dataset", action: "analyze", dryRun: true })) as any
    expect(res.ok).toBe(true)
    expect(res.result).toContain("analyze")
  })
})
```

### Step 5: Test Execution

Verify your new tool passes unit tests and typechecks:

```bash
pnpm --filter @sayabot/orchestrator test src/tools/builtins/my-custom-tool.test.ts
pnpm --filter @sayabot/orchestrator typecheck
```

---

## 6. Adding a New Workspace Connector: Step-by-Step Guide

Workspace connectors allow agents to search, read, and interact with external enterprise platforms (Google Drive, Slack, GitHub, Jira).

### Tiered Security Model

1. **Tier-1 (Workspace Level)**: Organization admins configure OAuth or API tokens in Settings → Connectors. Secrets are encrypted using `MESH_KEK` into `workspace_connectors`.
2. **Tier-2 (Agent Grants)**: Individual agents are assigned granular permissions in `agent_connector_grants` (e.g. read-only, restricted to `#general` or specific folders).

### Step 1: Add Provider to ConnectorSource (`apps/orchestrator/src/connectors/types.ts`)

```typescript
export type ConnectorSource = "google_drive" | "slack" | "github" | "jira" | "notion"
```

### Step 2: Implement the Connector Client (`apps/orchestrator/src/connectors/notion.ts`)

```typescript
import { RateLimiter } from "./rate-limiter"
import type { ConnectorDoc, ConnectorSearchOptions } from "./types"

export class NotionConnector {
  private token: string
  private limiter: RateLimiter

  constructor(token: string) {
    this.token = token
    // Respect Notion API rate limits (e.g. 3 requests per second)
    this.limiter = new RateLimiter(3, 1000)
  }

  async search(opts: ConnectorSearchOptions): Promise<ConnectorDoc[]> {
    await this.limiter.acquire()
    // Make authenticated HTTP request to Notion API
    // Return standardized ConnectorDoc array
    return []
  }
}
```

### Step 3: Wire into `ConnectorService` (`apps/orchestrator/src/connectors/service.ts`)

`ConnectorService` handles credential decryption and grant scope validation:

```typescript
export class ConnectorService {
  // 1. Decrypt token using KEK
  async getDecryptedConnector(orgId: string, source: ConnectorSource) {
    const [connector] = await this.db.select().from(workspaceConnectors)...
    const token = decryptSecret({ ciphertext: connector.ciphertext, iv: connector.iv, tag: connector.tag }, kek)
    return { connector, token }
  }

  // 2. Validate agent scope grant
  async getAgentScope(agentId: string, connectorId: string): Promise<ConnectorScopeConfig> {
    const [grant] = await this.db.select().from(agentConnectorGrants)...
    return (grant?.scopeConfig as ConnectorScopeConfig) ?? { readOnly: true }
  }
}
```

### Step 4: Expose Connector Tools in `apps/orchestrator/src/tools/builtins/connectors.ts`

Implement the agent tools (e.g. `notion_search`, `notion_read_page`). Always ensure:

- Search and read operations verify `scopeConfig` (e.g. restricting search to `allowedFolders`).
- Any mutating operation checks `scopeConfig.readOnly` and sets `dangerous: true`.

---

## 7. Testing & Linting Conventions

### Unit & Integration Testing Guidelines

- Use **Vitest** for unit and integration testing.
- Place test files adjacent to source code: `my-module.ts` -> `my-module.test.ts`.
- Mock external network calls, database pools, and LLM completions using `vi.mock()` or `vi.fn()`.
- Use `vi.stubEnv("MESH_KEK", "k")` to provide dummy encryption keys during testing.

### Code Style & Formatting

- **Prettier**:
  - No semicolons (`semi: false`).
  - Double quotes (`singleQuote: false`).
  - Print width: 100 characters (`printWidth: 100`).
- **ESLint & TypeScript Rules**:
  - Unused variables MUST be prefixed with an underscore (`_`), e.g. `_req`, `_signal`.
  - Avoid `any` in application code; use specific interfaces or `unknown` with Zod parsing.
  - Non-null assertions (`!`) are forbidden in application code; use proper guards or fallback defaults. Non-null assertions are permitted only in test files.
  - React Hooks rules: strictly adhere to exhaustive dependencies and rules of hooks in `apps/web`.

---

## 8. Agent Checklist Before Submitting Code

Before creating a commit, pull request, or handing off to another agent, verify:

- [ ] All new files have clickable markdown links and adhere to monorepo structure.
- [ ] No plaintext secrets or API keys are committed or logged anywhere.
- [ ] Any new or modified table has a Drizzle schema and corresponding migration.
- [ ] Room turn operations are protected by `withRoomLock()`.
- [ ] Destructive tools have `dangerous: true` or dynamic danger evaluation.
- [ ] Docker operations in `computerd` are strictly bounded to `/home/bot` and `/tmp`.
- [ ] `pnpm typecheck` runs cleanly without TypeScript errors.
- [ ] `pnpm test` passes without failing test suites.
- [ ] `pnpm lint` and `pnpm format` pass without formatting regressions.
