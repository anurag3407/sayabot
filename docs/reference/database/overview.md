# Database Package Overview (`@sayabot/db`)

`packages/db` is Sayabot's single source of truth for PostgreSQL persistence: Drizzle ORM table definitions in `src/schema/`, generated Drizzle snapshot migrations in `migrations/`, and hand-written idempotent SQL migrations in `sql/`. Every app in the monorepo (web, orchestrator, computerd) reaches the database through `createDb()` from this package, and every schema change must land as a Drizzle schema edit plus generated snapshot plus (where RLS/triggers/functions are involved) a numbered SQL file. This page explains the package's wiring — client creation, the migration pipeline, the config, and the shared enum catalog — before the per-domain schema pages dive into individual tables.

Source files: `packages/db/src/client.ts`, `packages/db/src/migrate.ts`, `packages/db/drizzle.config.ts`, `packages/db/src/schema/index.ts`, `packages/db/src/schema/enums.ts`, `packages/db/src/index.ts`, `packages/db/package.json`

---

## What the package exports

The package entry point is deliberately minimal — two re-export lines (`packages/db/src/index.ts:1-2`):

```typescript
export * from "./schema"
export * from "./client"
```

- `./schema` re-exports every table, enum, and type helper from `packages/db/src/schema/index.ts`, which in turn re-exports all 23 domain modules in a fixed order (`packages/db/src/schema/index.ts:1-23`): `enums`, `identity`, `templates`, `agents`, `vault`, `computers`, `invites`, `rooms`, `messages`, `meetings`, `tasks`, `canvas`, `tools`, `ops`, `engine`, `memory`, `routines`, `connectors`, `facts`, `devices`, `desktop`, `computer-settings`, `billing`.
- `./client` exports `createDb`, the `Db`/`DbPool` types, and `requireDatabaseUrl` (`packages/db/src/client.ts:21-28`).

The `package.json` exposes two subpaths (`packages/db/package.json:5-8`): `"."` (everything) and `"./schema"` (tables only, for callers that must not pull in `pg` client code). Scripts are `generate` (drizzle-kit), `migrate` (`tsx src/migrate.ts`), `seed` (`tsx src/seed.ts`), `typecheck`, and `lint`. Root-level wrappers are `pnpm db:generate`, `pnpm db:migrate`, and `pnpm db:seed` (root `package.json:12-14`).

---

## Client creation (`src/client.ts`)

`createDb(connectionString, options?)` builds a `pg.Pool` and wraps it with Drizzle (`packages/db/src/client.ts:5-19`):

```typescript
export function createDb(connectionString: string, options?: { max?: number }) {
  const isSupabasePooler = connectionString.includes(".pooler.supabase.com")
  const defaultMax = isSupabasePooler ? 4 : 10
  const max =
    options?.max ??
    (process.env.DATABASE_POOL_MAX ? parseInt(process.env.DATABASE_POOL_MAX, 10) : defaultMax)
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  const db = drizzle(pool, { schema })
  return { pool, db }
}
```

Key behaviors:

- **Pooler awareness** (`packages/db/src/client.ts:6-7`): when the connection string points at Supabase's pooler host (`.pooler.supabase.com`), the default pool size drops from 10 to 4. Transaction-mode poolers multiplex many clients over few server connections, so large client-side pools just queue and time out; the low default keeps idle connections under the pooler's limits. `DATABASE_POOL_MAX` overrides the default in both cases, and the explicit `options.max` wins over everything.
- **Timeouts** (`packages/db/src/client.ts:14-15`): idle connections are closed after 10 s and connection attempts fail after 10 s, so a stalled database surfaces as a fast error instead of a hung request.
- **Schema binding** (`packages/db/src/client.ts:17`): `drizzle(pool, { schema })` attaches the full schema for relational queries and `db.query.*` access.
- **Two handles returned** (`packages/db/src/client.ts:18`): callers get both `db` (Drizzle query builder) and `pool` (raw `pg.Pool`) from the same object. Raw pool access matters for two things in this codebase: session-level PostgreSQL advisory locks (see below) and `migrate.ts` applying raw SQL files.
- **Zero-Config In-Process PGlite** (`packages/db/src/client.ts`): when `connectionString === "local"` or starts with `pglite:` or `memory:`, `createDb` provisions an in-process PostgreSQL 16 engine powered by `@electric-sql/pglite` via `createPgConfig()`. Persistent storage defaults to `~/.sayabot/data/db` (or custom data directory / memory). The returned `pool` and `db` conform 100% to node-postgres and Drizzle ORM, supporting full relational queries and `pg_advisory_lock` operations without running a separate PostgreSQL daemon.

`requireDatabaseUrl()` (`packages/db/src/client.ts:24-28`) reads `process.env.DATABASE_URL` and throws `"DATABASE_URL is not set"` when missing — it is the standard guard used by server entrypoints. In local zero-config mode, setting `SAYABOT_LOCAL=true` defaults `DATABASE_URL` to `"local"`.

### Advisory locks and why raw pool access matters

Room turns are serialized with **session-level** advisory locks, which are connection-scoped. `apps/orchestrator/src/db.ts:29-37` implements `withRoomLock()` by checking a dedicated client out of the pool (`pool.connect()`), running `select pg_advisory_lock(hashtext($1)::bigint)` with key `mesh:room:<roomId>`, executing the turn, unlocking, and releasing the client in a `finally` block. This is exactly why `createDb` exposes the raw `pool`: advisory locks issued via anonymous pooled queries (`pool.query`) could land on different physical connections and would never unlock. Per AGENTS.md Golden Rule 2, every turn in `apps/orchestrator/src/coordinator/index.ts` runs inside this lock.

---

## Migration pipeline (`src/migrate.ts`)

`pnpm db:migrate` runs `tsx src/migrate.ts`, a two-phase migrator (`packages/db/src/migrate.ts:15-32`):

**Phase 1 — Drizzle snapshot migrations** (`packages/db/src/migrate.ts:19`): `migrate(db, { migrationsFolder: .../migrations })` applies the drizzle-kit–generated SQL in `packages/db/migrations/` (files `0000_conscious_natasha_romanoff.sql` through `0003_gigantic_the_call.sql`), tracked in the `__drizzle_migrations` table so each runs exactly once. This phase creates the base tables (`orgs`, `profiles`, `org_members`, `provider_keys`, `agents`, `org_tool_configs`, `agent_api_keys`, `rooms`, `room_members`, `room_agents`, `messages`, `turn_sessions`, `agent_runs`, `canvases`, `canvas_versions`, `mcp_servers`, `tool_calls`, `webhook_deliveries`, `usage_events`, `audit_logs`, `model_pricing`), the `room_reads`/`meetings`/`room_schedules`/`tasks`/`task_comments` additions, `push_subscriptions`, and `agent_reads`.

**Phase 2 — raw SQL migrations** (`packages/db/src/migrate.ts:21-31`): the runner lists every `*.sql` file in `packages/db/sql/`, **sorts the filenames lexically** (`readdirSync(...).filter(...).sort()`), and executes each with `pool.query(text)` — the whole file in one statement batch. There is **no applied-migrations ledger for this phase**: files are re-executed on every run, which is why every file in `sql/` must be idempotent (`create table if not exists`, `add column if not exists`, `drop policy if exists` before `create policy`, `create or replace function`, `alter type ... add value if not exists`). The numbering (`0001_functions.sql` … `0035_model_choice.sql`) exists purely to make the lexical sort deterministic — it is dependency ordering, not "apply once" tracking.

Consequences worth knowing:

- A file that is not idempotent will break the next `pnpm db:migrate`, because phase 2 replays everything.
- `alter type ... add value` cannot run inside a transaction, so `0029_mcp_stdio_enum.sql` contains exactly that one statement (`packages/db/sql/0029_mcp_stdio_enum.sql:4`) and relies on the pool client running it outside an explicit transaction.
- Errors abort the run with a non-zero exit code (`packages/db/src/migrate.ts:33-38`); `pool.end()` always runs in `finally`.
- `DATABASE_URL` is loaded from the **repository root** `.env` (`packages/db/src/migrate.ts:7`) and the run exits immediately if it is unset (`packages/db/src/migrate.ts:9-13`).

### Where each table comes from

| Origin                                                                                                                                                                                                           | Tables                                                                                                                                                     |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drizzle snapshots (`migrations/0000`–`0003`)                                                                                                                                                                     | Core identity, agents, rooms, messages, canvas, tools, ops tables (full list above)                                                                        |
| `sql/0005_ia.sql`                                                                                                                                                                                                | RLS + realtime for `tasks`, `task_comments`, `room_reads`, `meetings`, `room_schedules`                                                                    |
| `sql/0007_agent_reads.sql`                                                                                                                                                                                       | RLS lockdown for `agent_reads`                                                                                                                             |
| `sql/0008_task_integrity.sql`                                                                                                                                                                                    | `task_events` table plus task integrity columns/trigger                                                                                                    |
| `sql/0009_bot_platform.sql`                                                                                                                                                                                      | `agent_templates`, `vault_secrets`, `agent_secret_grants`, `org_quotas`, `agent_computers`, `room_invites`, `oauth_clients`, `oauth_codes`, `oauth_tokens` |
| `sql/0010_engine.sql`                                                                                                                                                                                            | `run_steps`, `run_transcripts`, `skills`                                                                                                                   |
| `sql/0011_memory.sql`                                                                                                                                                                                            | `memories`                                                                                                                                                 |
| `sql/0014_routines.sql`                                                                                                                                                                                          | `routines`, `routine_runs`                                                                                                                                 |
| `sql/0016_cognitive_memory.sql`                                                                                                                                                                                  | `memory_sources`, `open_loops`, `memory_links`                                                                                                             |
| `sql/0017_vector_providers.sql`                                                                                                                                                                                  | `vector_providers`                                                                                                                                         |
| `sql/0018_workspace_connectors.sql`                                                                                                                                                                              | `workspace_connectors`, `agent_connector_grants`                                                                                                           |
| `sql/0019_owner_facts.sql`                                                                                                                                                                                       | `owner_facts`                                                                                                                                              |
| `sql/0020_bot_invites.sql`                                                                                                                                                                                       | `bot_invites`                                                                                                                                              |
| `sql/0021_device_pairings.sql`, `0024_desktop_hosts.sql`, `0026_mobile_push_and_files.sql`, `0030_local_apps_inbound.sql`, `0031_guest_account_merge.sql`, `0033_cloud_plans.sql`, `0034_computer_placement.sql` | devices/desktop/push/local-apps/merge-tickets/cloud-plans/computer-placement tables                                                                        |

The full per-file catalog lives in [Migrations catalog](./migrations-catalog.md).

---

## drizzle-kit config (`drizzle.config.ts`)

`pnpm db:generate` runs `drizzle-kit generate` with this config (`packages/db/drizzle.config.ts:7-16`):

| Setting              | Value                            | Meaning                                                                                                                            |
| :------------------- | :------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- |
| `dialect`            | `"postgresql"`                   | Target database.                                                                                                                   |
| `schema`             | `"./src/schema/index.ts"`        | drizzle-kit reads the barrel file, so **every new schema module must be re-exported there** or it will be invisible to generation. |
| `out`                | `"./migrations"`                 | Snapshot SQL + `meta/` journal land here; phase 1 of `migrate.ts` applies them.                                                    |
| `dbCredentials.url`  | `process.env.DATABASE_URL ?? ""` | Only needed for `drizzle-kit pull/push`; `generate` works offline. Loaded from the repo-root `.env` (`drizzle.config.ts:5`).       |
| `strict` / `verbose` | `true`                           | Generation asks for confirmation and prints the full diff.                                                                         |

The intended workflow (AGENTS.md Rule 3): edit `src/schema/*.ts`, re-export from `src/schema/index.ts`, run `pnpm db:generate`, then hand-write a numbered idempotent `sql/00NN_*.sql` for anything Drizzle cannot express — RLS policies, grants, triggers, SQL functions, partial/expressional indexes, enum value additions, and views.

---

## Shared pg enums (`src/schema/enums.ts`)

All PostgreSQL enum types are defined once here and imported by the domain modules. `pnpm db:generate` turns `pgEnum("name", [...])` into `create type public.<name> as enum (...)` in the snapshot migrations; the raw SQL files then extend some of them with `alter type ... add value if not exists`.

### Identity, rooms, and turns

| Enum (`path:line`)                                               | Values                                                                                                        | Used by                                                      |
| :--------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ | :----------------------------------------------------------- |
| `orgRoleEnum` — `org_role` (`enums.ts:3`)                        | `owner`, `admin`, `member`                                                                                    | `org_members.role`                                           |
| `roomMemberRoleEnum` — `room_member_role` (`enums.ts:4`)         | `admin`, `member`                                                                                             | `room_members.role`                                          |
| `roomKindEnum` — `room_kind` (`enums.ts:5`)                      | `public`, `private`, `dm`                                                                                     | `rooms.kind`                                                 |
| `turnModeEnum` — `turn_mode` (`enums.ts:6`)                      | `mentions`, `debate`, `moderated`                                                                             | `rooms.turn_mode`                                            |
| `agentKindEnum` — `agent_kind` (`enums.ts:7`)                    | `llm`, `external`                                                                                             | `agents.kind`                                                |
| `agentVisibilityEnum` — `agent_visibility` (`enums.ts:103`)      | `private`, `org`                                                                                              | `agents.visibility`                                          |
| `senderTypeEnum` — `sender_type` (`enums.ts:16`)                 | `human`, `agent`, `system`                                                                                    | `messages.sender_type`                                       |
| `messageStatusEnum` — `message_status` (`enums.ts:17-22`)        | `streaming`, `complete`, `error`, `halted`                                                                    | `messages.status`                                            |
| `turnSessionStateEnum` — `turn_session_state` (`enums.ts:23-28`) | `active`, `complete`, `halted`, `superseded`                                                                  | `turn_sessions.state`                                        |
| `agentRunStatusEnum` — `agent_run_status` (`enums.ts:29-35`)     | `running`, `complete`, `error`, `halted`, `waiting` (the `waiting` value is added by `sql/0010_engine.sql:6`) | `agent_runs.status`                                          |
| `turnRoleEnum` — `turn_role` (`enums.ts:36-42`)                  | `responder`, `producer`, `critic`, `summarizer`, `moderator`                                                  | `agent_runs.role`, turn queue items                          |
| `providerEnum` — `provider` (`enums.ts:8-15`)                    | `openai`, `anthropic`, `google`, `groq`, `cerebras`, `openai-compatible`                                      | `provider_keys.provider`, `agent_templates.default_provider` |

### Canvas, tools, and ops

| Enum (`path:line`)                                           | Values                                                                    | Used by                                          |
| :----------------------------------------------------------- | :------------------------------------------------------------------------ | :----------------------------------------------- |
| `canvasKindEnum` — `canvas_kind` (`enums.ts:43`)             | `markdown`, `code`, `svg`, `html`                                         | `canvases.kind`                                  |
| `mcpTransportEnum` — `mcp_transport` (`enums.ts:44`)         | `http`, `sse`, `stdio` (`stdio` added by `sql/0029_mcp_stdio_enum.sql:4`) | `mcp_servers.transport`                          |
| `toolCallStatusEnum` — `tool_call_status` (`enums.ts:45-52`) | `pending_approval`, `approved`, `rejected`, `running`, `done`, `error`    | `tool_calls.status` (human-approval gate states) |
| `builtinToolEnum` — `builtin_tool` (`enums.ts:53-57`)        | `web_search`, `github_bridge`, `postgres_inspector`                       | tool call classification                         |

### Meetings and tasks

| Enum (`path:line`)                                        | Values                                                                            | Used by                                                           |
| :-------------------------------------------------------- | :-------------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| `meetingKindEnum` — `meeting_kind` (`enums.ts:58`)        | `meeting`, `checkin`                                                              | `meetings.kind`                                                   |
| `meetingStatusEnum` — `meeting_status` (`enums.ts:59-64`) | `scheduled`, `active`, `ended`, `canceled`                                        | `meetings.status`                                                 |
| `taskKindEnum` — `task_kind` (`enums.ts:65`)              | `task`, `request`                                                                 | `tasks.kind`                                                      |
| `taskStatusEnum` — `task_status` (`enums.ts:66`)          | `open`, `in_progress`, `stuck`, `done`                                            | `tasks.status`                                                    |
| `unblockNeedsEnum` — `unblock_needs` (`enums.ts:67-74`)   | `human_answer`, `another_agent`, `credential`, `external_access`, `time`, `other` | typed mirror of `tasks.unblock_needs`                             |
| `outcomeKindEnum` — `outcome_kind` (`enums.ts:75-82`)     | `artifact`, `submission`, `external_change`, `decision`, `none`, `legacy`         | typed mirror of `tasks.outcome_kind` / `task_events.outcome_kind` |
| `checkinModeEnum` — `checkin_mode` (`enums.ts:83`)        | `stream`, `digest`                                                                | typed mirror of `room_schedules.checkin_mode`                     |

Note: `tasks.unblock_needs`, `tasks.outcome_kind`, and `room_schedules.checkin_mode` are **`text` columns with CHECK constraints** in the SQL migration (`packages/db/sql/0008_task_integrity.sql:17-27`), not native enums — `unblockNeedsEnum`/`outcomeKindEnum`/`checkinModeEnum` exist in TypeScript so Drizzle rows are typed, but drizzle-kit never emits a `create type` for them.

### Vault, computers, memory, routines

| Enum (`path:line`)                                                     | Values                                                                           | Used by                                           |
| :--------------------------------------------------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------ |
| `vaultSecretKindEnum` — `vault_secret_kind` (`enums.ts:85-91`)         | `api_token`, `basic_auth`, `password`, `header_set`, `github_app`                | `vault_secrets.kind`                              |
| `secretInjectEnum` — `secret_inject` (`enums.ts:92`)                   | `header`, `basic`, `query`, `body`                                               | secret injection modes (vault slots / connectors) |
| `computerStatusEnum` — `computer_status` (`enums.ts:93-101`)           | `none`, `stopped`, `starting`, `running`, `stopping`, `error`, `over_quota`      | `agent_computers.status`                          |
| `computerProfileEnum` — `computer_profile` (`enums.ts:102`)            | `standard`, `browser`                                                            | computer profile selection                        |
| `memoryScopeEnum` — `memory_scope` (`enums.ts:105`)                    | `agent`, `room`, `org`                                                           | `memories.scope`                                  |
| `memoryKindEnum` — `memory_kind` (`enums.ts:106-112`)                  | `fact`, `preference`, `decision`, `procedure`, `episode`                         | `memories.kind`                                   |
| `memorySourceEnum` — `memory_source` (`enums.ts:113-119`)              | `agent`, `human`, `compaction`, `consolidation`, `import`                        | `memories.source`                                 |
| `epistemicStatusEnum` — `epistemic_status` (`enums.ts:121-127`)        | `hypothesis`, `belief`, `verified`, `withdrawn`, `superseded`                    | `memories.epistemic_status`                       |
| `openLoopStatusEnum` — `open_loop_status` (`enums.ts:129-135`)         | `open`, `in_progress`, `blocked`, `resolved`, `dropped`                          | `open_loops.status`                               |
| `memoryLinkTypeEnum` — `memory_link_type` (`enums.ts:137-144`)         | `relates_to`, `depends_on`, `caused_by`, `contradicts`, `supersedes`, `supports` | `memory_links.relationship`                       |
| `routineStatusEnum` — `routine_status` (`enums.ts:146-151`)            | `idle`, `running`, `success`, `failed`                                           | `routines.last_status`, `routine_runs.status`     |
| `vectorProviderKindEnum` — `vector_provider_kind` (`enums.ts:153-156`) | `vector_db`, `embedding`                                                         | `vector_providers.kind`                           |

---

## Cross-cutting SQL behaviors

Three things apply to nearly every table and are easier to state once here:

- **`updated_at` triggers**: `set_updated_at()` (`packages/db/sql/0001_functions.sql:3-11`) is attached via a `before update` trigger to `rooms`, `agents`, `messages`, `turn_sessions`, `tool_calls`, `canvases`, `mcp_servers`, `model_pricing`, and `org_tool_configs` (`0001_functions.sql:13-25`). For these tables `updatedAt` is maintained by the database even though the Drizzle column defaults to `now()`.
- **Profile auto-provisioning**: `handle_new_user()` (`packages/db/sql/0001_functions.sql:32-60`) is a `security definer` trigger on Supabase `auth.users` that inserts/updates a matching `profiles` row, deriving `display_name` from `full_name` → `name` → `user_name` → email local part → `"member"` and `avatar_url` from metadata.
- **Realtime publication**: `messages`, `tool_calls`, and `canvases` are added to the `supabase_realtime` publication with `replica identity full` for `messages`, guarded by a room-membership policy on `realtime.messages` (`packages/db/sql/0003_realtime.sql:6-40`); `task_events` joins the publication in `0008_task_integrity.sql:92-102`. See [RLS & Realtime](./rls-and-realtime.md).

RLS conventions also apply package-wide: tenant tables are gated by helper predicates (`public.is_org_member(org_id)`, `public.can_read_room(room_id)`, `public.shares_org_with(user_id)` defined in `0001_functions.sql`/`0002_rls.sql`), secret-bearing tables (`provider_keys`, `agent_api_keys`, `org_tool_configs`, `vector_providers`, `bot_invites`, `workspace_invites`, `account_merge_tickets`, `oauth_*`) deliberately ship **no client policies** and are revoked from `anon`/`authenticated` so only the service role can touch them.

---

## Related docs

- [Identity & invites schemas](./schema-identity-and-invites.md)
- [Agents & templates schemas](./schema-agents-and-templates.md)
- [Rooms, messages & canvas schemas](./schema-rooms-messages-canvas.md)
- [Tasks & owner facts schemas](./schema-tasks-and-facts.md)
- [Memory schemas](./schema-memory.md)
- [Routines & meetings schemas](./schema-routines-and-meetings.md)
- [Migrations catalog](./migrations-catalog.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Seed script](./seed.md)
