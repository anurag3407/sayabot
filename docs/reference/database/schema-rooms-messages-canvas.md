# Rooms, Messages & Canvas Schemas

This reference documents the collaboration core: `rooms` and its membership/subscription tables (`room_members`, `room_agents`, `room_reads`, `agent_reads`), the conversation layer (`messages`, `turn_sessions`, `agent_runs`), and the shared Yjs canvas (`canvases`, `canvas_versions`). Rooms are the unit of serialization — every turn executes under a `withRoomLock()` advisory lock keyed by `room_id` — and most RLS policies in the package resolve through `public.can_read_room(room_id)`.

Two clarifications up front, since the file names can mislead: `tool_calls` is **not** in `messages.ts` — it lives in `packages/db/src/schema/tools.ts:49` (see [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)); and there is no `attachments` table in the Drizzle schema — message payloads carry everything in `metadata` jsonb. Room-level schedules (`room_schedules`) are defined in `packages/db/src/schema/meetings.ts:16` and covered in [Routines & meetings schemas](./schema-routines-and-meetings.md).

Source files: `packages/db/src/schema/rooms.ts`, `packages/db/src/schema/messages.ts`, `packages/db/src/schema/canvas.ts`, `packages/db/src/schema/enums.ts`, `packages/db/migrations/0000_conscious_natasha_romanoff.sql`, `packages/db/sql/0002_rls.sql`, `packages/db/sql/0003_realtime.sql`, `packages/db/sql/0005_ia.sql`, `packages/db/sql/0007_agent_reads.sql`, `packages/db/sql/0008_task_integrity.sql`

---

## Rooms (`rooms`)

Defined at `packages/db/src/schema/rooms.ts:34`. One row per conversation — a team room, a private room, or a 1:1 human↔bot DM. The turn-discipline knobs (`turn_mode`, `turn_cap`, `rpm_limit`, `daily_budget_usd`, `moderator_agent_id`, `debate_order`) are read by the turn coordinator before each turn.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Room id used in URLs and realtime topics (`room:<uuid>`). |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace. |
| `name` | `text` | NOT NULL | Display name. |
| `kind` | `room_kind` enum | NOT NULL, default `"private"` | `public` (whole org), `private` (invited members), or `dm` (1:1). |
| `turn_mode` | `turn_mode` enum | NOT NULL, default `"mentions"` | `mentions` (bots answer only when mentioned), `debate` (fixed speaking order), or `moderated` (moderator decides). |
| `system_directive` | `text` | nullable | Room-level instructions injected into every agent's context. |
| `turn_cap` | `integer` | NOT NULL, default `3` | Max consecutive bot turns per `turn_sessions`; CHECK `rooms_turn_cap_check` restricts it to `between 1 and 10` (`rooms.ts:62`). |
| `rpm_limit` | `integer` | nullable | Per-room requests-per-minute cap; null = unlimited. |
| `daily_budget_usd` | `numeric(12,6)` | nullable, mode `"number"` | Soft daily spend ceiling for the room. |
| `moderator_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Moderator bot for `turn_mode = "moderated"`. |
| `debate_order` | `uuid[]` | NOT NULL, default `[]` | Agent ids in speaking order for `turn_mode = "debate"`. |
| `timezone` | `text` | NOT NULL, default `"UTC"` | IANA timezone used to interpret schedules in this room. |
| `agent_dm_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human side of a `dm` room. |
| `agent_dm_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Bot side of a `dm` room. |
| `execution_mode` | `text` | not null, default `'ask_risky'`, check `rooms_execution_mode_check` (`ask_risky`, `review_all`), typed `RoomExecutionMode` | How bots here ask before acting: risky tools only, or every tool (added by `packages/db/sql/0036_room_execution_mode.sql`). |
| `created_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Creator. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps (`updated_at` maintained by trigger, `0001_functions.sql:13-25`). |

Indexes/constraints (`rooms.ts:59-63`): `rooms_org_idx` on `(org_id)`; unique `rooms_agent_dm_idx` on `(agent_dm_user_id, agent_dm_agent_id)` so a human↔bot pair has at most one DM room; the `rooms_turn_cap_check` CHECK.

**RLS** (`packages/db/sql/0002_rls.sql:124-128`): `rooms_select` via `public.can_read_room(id)` (org public rooms, rooms the user is a member of, and their own DMs). Writes are server-side.

**Used by**: room pages and settings (`apps/web/src/app/(workspace)/[org]/r/[roomId]/*`), the orchestrator coordinator's lock + turn loop (`apps/orchestrator/src/coordinator/index.ts`), authorization (`apps/orchestrator/src/authz.ts`), and the SSE/collab server (`apps/orchestrator/src/collab/index.ts`).

---

## Room members (`room_members`)

Defined at `packages/db/src/schema/rooms.ts:66`. Humans in the room. Composite PK `(room_id, user_id)`.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE`, part of PK | The room. |
| `user_id` | `uuid` | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE`, part of PK | The human member. |
| `role` | `room_member_role` enum | NOT NULL, default `"member"` | `admin` (can edit room settings) or `member` (`enums.ts:4`). |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | When the member was added. |

**RLS** (`packages/db/sql/0002_rls.sql:130-133`): `room_members_select` via `can_read_room(room_id)`. This table is a key input to the `can_read_room()` helper itself.

**Used by**: room settings UI (`apps/web/src/app/(workspace)/[org]/r/[roomId]/settings/page.tsx`), push fan-out and authorization (`apps/orchestrator/src/push.ts`, `apps/orchestrator/src/authz.ts`).

---

## Room agents (`room_agents`)

Defined at `packages/db/src/schema/rooms.ts:81`. Bots in the room, with their speaking position and an optional per-room model override. Composite PK `(room_id, agent_id)`.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE`, part of PK | The room. |
| `agent_id` | `uuid` | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE`, part of PK | The bot. |
| `position` | `integer` | NOT NULL, default `0` | Sort order in the room's agent roster. |
| `model_override` | `jsonb` | nullable, typed `RoomModelOverride \| null` | "Only this chat" model override (added by `packages/db/sql/0035_model_choice.sql:16`). |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | When the bot joined. |

The override shape (`rooms.ts:25-32`) carries both what the picker showed and what the turn actually applies:

```typescript
export interface RoomModelOverride {
  keyId: string | null        // picker's provider key choice
  model: string | null        // picker's model
  effort: string | null       // thinking effort
  providerKeyId: string | null // resolved provider key applied to the bot
  agentModel: string | null   // resolved model applied to the bot
  runner: Record<string, unknown> | null // runner options
}
```

Null `model_override` means "follow the bot's default". `providerKeyId`/`agentModel`/`runner` are resolved and permission-checked at save time (`apps/orchestrator/src/runner/room-model.ts`).

Indexes: composite PK plus `room_agents_agent_idx` on `(agent_id)` (`rooms.ts:97`).

**RLS** (`packages/db/sql/0002_rls.sql:134-138`): `room_agents_select` via `can_read_room(room_id)`.

**Used by**: room page roster and chat panel (`apps/web/src/components/room/chat-panel.tsx`, `room-workspace.tsx`), mobile home (`apps/web/src/app/api/mobile/home/route.ts`), and the orchestrator when building the per-turn model config (`apps/orchestrator/src/runner/room-model.ts`, `apps/orchestrator/src/runner/llm.ts`).

---

## Human read state (`room_reads`)

Defined at `packages/db/src/schema/rooms.ts:101`. Per-user-per-room unread tracking plus pin/mute/archive. Composite PK `(user_id, room_id)`.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `user_id` | `uuid` | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE`, part of PK | The reader. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE`, part of PK | The room. |
| `last_read_at` | `timestamptz` | NOT NULL, default `now()` | Everything before this is read; drives unread badges. |
| `pinned` | `boolean` | NOT NULL, default `false` | Room pinned to top of the sidebar. |
| `muted_until` | `timestamptz` | nullable | Notifications suppressed until this time. |
| `archived` | `boolean` | NOT NULL, default `false` | Room moved to archive. |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Last touch. |

Indexes: composite PK plus `room_reads_room_idx` on `(room_id)` (`rooms.ts:118`).

**RLS** (`packages/db/sql/0005_ia.sql:42-63`): `room_reads_select`/`room_reads_insert`/`room_reads_update` — a user may read/insert/update **only their own** rows, and inserts additionally require `can_read_room(room_id)`.

**Used by**: the web queries layer computing unread counts (`apps/web/src/lib/queries.ts:122`) and workspace-invite redemption, which auto-joins invitees by upserting `room_reads` (`apps/web/src/lib/actions/workspace-invites.ts:206`).

---

## Agent read cursors (`agent_reads`)

Defined at `packages/db/src/schema/rooms.ts:126` (table created in `packages/db/migrations/0003_gigantic_the_call.sql`, RLS locked down in `packages/db/sql/0007_agent_reads.sql`). Per-agent-per-room cursor so pull-based bots (MCP-connected) only see what is new since their last look. Composite PK `(agent_id, room_id)`.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `agent_id` | `uuid` | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE`, part of PK | The pulling bot. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE`, part of PK | The room being watched. |
| `last_read_at` | `timestamptz` | NOT NULL, default `now()` | Advanced by `get_inbox` / `get_room_messages` so repeats only return fresh messages. |
| `last_reported_at` | `timestamptz` | nullable | Last check-in report time; used by check-in classification (added by `packages/db/sql/0008_task_integrity.sql:36-37`). |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Last touch. |

**RLS** (`packages/db/sql/0007_agent_reads.sql:2-5`): RLS enabled with **no policies** and `revoke all` from `anon`/`authenticated` — "written only by the orchestrator (service role)" and invisible to client roles. This is a deliberate lockdown, unlike most tables which get at least a select policy.

**Used by**: the collab/MCP layer (`apps/orchestrator/src/collab/index.ts`) and check-in classification (`apps/orchestrator/src/collab/classify-checkin.ts`).

---

## Messages (`messages`)

Defined at `packages/db/src/schema/messages.ts:27`. Every chat line — human, agent, or system — including streamed agent output (status transitions from `streaming` to `complete`/`error`/`halted`). There is no attachments table; file references ride in `metadata`.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Message id. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE` | Containing room. |
| `thread_root_id` | `uuid` | nullable | Set to the root message id for thread replies (no FK by design — root may be any row in this table). |
| `sender_type` | `sender_type` enum | NOT NULL | `human`, `agent`, or `system` (`enums.ts:16`). |
| `sender_id` | `uuid` | nullable | The sender's id — `profiles.id` or `agents.id` depending on `sender_type`. **No FK**: polymorphic by design so one row shape covers both sender kinds. |
| `content` | `text` | NOT NULL, default `""` | Message body (streamed incrementally while `status = "streaming"`). |
| `status` | `message_status` enum | NOT NULL, default `"complete"` | `streaming`, `complete`, `error`, `halted` (`enums.ts:17-22`). |
| `mentions` | `text[]` | NOT NULL, default `[]` | Extracted agent handles that were `@`-mentioned; drives `turn_mode = "mentions"` dispatch. |
| `run_id` | `uuid` | nullable | Links an agent message to its `agent_runs` row. |
| `metadata` | `jsonb` | NOT NULL, default `{}` | Extensions (canvas references, push payload bits, file pointers). |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps (`updated_at` maintained by trigger). |

Indexes (`messages.ts:45-49`): `messages_room_created_idx` on `(room_id, created_at)` (the feed query), `messages_thread_idx` on `(thread_root_id)`, `messages_run_idx` on `(run_id)`.

**RLS** (`packages/db/sql/0002_rls.sql:140-153`): `messages_select` via `can_read_room(room_id)`; `messages_insert_human` lets an authenticated human insert only rows with `sender_type = 'human'`, `sender_id = auth.uid()`, and `status = 'complete'` — clients cannot fabricate agent/system messages or partial streams; those are written by the orchestrator (service role).

**Realtime** (`packages/db/sql/0003_realtime.sql:7-40`): `messages` is added to the `supabase_realtime` publication, gets `replica identity full`, and `realtime.messages` is guarded by a `mesh_room_read` policy so only room members receive events on `room:<uuid>` topics.

**Used by**: the room feed and composer across `apps/web/src/components/room/*`, orchestrator streaming + persistence in the coordinator (`apps/orchestrator/src/coordinator/index.ts`), push notifications, and MCP message tools.

---

## Turn sessions (`turn_sessions`)

Defined at `packages/db/src/schema/messages.ts:52`. One row per conversational "turn event" (a trigger message kicking off one round of bot activity). Tracks the queue of bot speakers and how many of the room's `turn_cap` bot turns were consumed.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Session id; `agent_runs.session_id` points here. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE` | The room. |
| `thread_root_id` | `uuid` | nullable | Thread the turn belongs to, mirroring `messages.thread_root_id`. |
| `trigger_message_id` | `uuid` | nullable | The message that started this turn (no FK — messages may be trimmed independently). |
| `task_id` | `uuid` | nullable, FK → `tasks.id`, `ON DELETE SET NULL` | Task being worked on, when the turn is task-scoped. |
| `bot_turns_used` | `integer` | NOT NULL, default `0` | Counts against `rooms.turn_cap` (max 10 per the CHECK). |
| `state` | `turn_session_state` enum | NOT NULL, default `"active"` | `active`, `complete`, `halted`, `superseded` (`enums.ts:23-28`). |
| `queue` | `jsonb` | NOT NULL, default `[]` | Typed `TurnQueueItem[]` — `{ agentId, role }` pairs (`messages.ts:22-25`); the deterministic speaking order the coordinator drains. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps. |

Indexes: `turn_sessions_room_idx` on `(room_id, created_at)` (`messages.ts:68`).

**RLS** (`packages/db/sql/0002_rls.sql:155-159`): `turn_sessions_select` via `can_read_room(room_id)`; all writes are orchestrator-side.

**Used by**: the turn coordinator creates/advances/interrupts sessions (`apps/orchestrator/src/coordinator/index.ts`, `apps/orchestrator/src/coordinator/interrupt.ts`).

---

## Agent runs (`agent_runs`)

Defined at `packages/db/src/schema/messages.ts:71`. One row per single bot invocation (one step of one role inside one turn session) — the audit and cost-attribution record the coordinator writes as it runs.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Run id; `messages.run_id` links outputs back here. |
| `session_id` | `uuid` | nullable, FK → `turn_sessions.id`, `ON DELETE SET NULL` | Parent turn session. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE` | Room (denormalized for fast per-room queries). |
| `task_id` | `uuid` | nullable, FK → `tasks.id`, `ON DELETE SET NULL` | Task cost attribution (added by `packages/db/sql/0008_task_integrity.sql:31-33`). |
| `agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Executing bot; null for system-level runs. |
| `message_id` | `uuid` | nullable, FK → `messages.id`, `ON DELETE SET NULL` | The reply message produced. |
| `step` | `integer` | NOT NULL, default `0` | Agent-loop step index within the run. |
| `role` | `turn_role` enum | NOT NULL, default `"responder"` | `responder`, `producer`, `critic`, `summarizer`, or `moderator` (`enums.ts:36-42`). |
| `status` | `agent_run_status` enum | NOT NULL, default `"running"` | `running`, `complete`, `error`, `halted`, `waiting` (`enums.ts:29-35`; the `waiting` value is added by `packages/db/sql/0010_engine.sql:6`). |
| `finish_reason` | `text` | nullable | Why the run ended (model stop reason or orchestrator decision). |
| `steps` | `integer` | nullable | Total loop steps taken. |
| `engine` | `text` | NOT NULL, default `"v1"` | Agent-loop version tag (`v1`/`v2`). |
| `heartbeat_at` | `timestamptz` | nullable | Liveness heartbeat; stale heartbeats let supervisors reclaim stuck runs. |
| `parent_run_id` | `uuid` | nullable | Subagent delegation chain (no FK — self-reference kept soft). |
| `waiting_reason` | `text` | nullable | Why the run is `waiting` (e.g. approval gate, ask-for-human). |
| `input_tokens` / `output_tokens` | `integer` | nullable | Token usage of the LLM call. |
| `cost_usd` | `numeric(12,6)` | NOT NULL, default `0`, mode `"number"` | Computed call cost. |
| `ttft_ms` / `latency_ms` | `integer` | nullable | Time-to-first-token and total latency. |
| `error` | `text` | nullable | Error text when `status = "error"`. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Run start. |

Indexes (`messages.ts:99-103`): `agent_runs_room_created_idx` on `(room_id, created_at)`, `agent_runs_session_idx` on `(session_id)`, `agent_runs_task_idx` on `(task_id)` (created in `0008_task_integrity.sql:35`).

**RLS** (`packages/db/sql/0002_rls.sql:161-164`): `agent_runs_select` via `can_read_room(room_id)`.

**Used by**: coordinator bookkeeping (`apps/orchestrator/src/coordinator/index.ts`), plans/usage (`apps/orchestrator/src/plans.ts`, `apps/orchestrator/src/usage.ts`), every runner backend (`apps/orchestrator/src/runner/local.ts`, `runner/cli.ts`, `runner/external.ts`), and the HTTP layer exposing run status (`apps/orchestrator/src/http.ts`).

---

## Canvases (`canvases`)

Defined at `packages/db/src/schema/canvas.ts:12`. The shared real-time document per room. Content lives twice: `ydoc_state` holds the raw Yjs binary update log (source of truth for live collaboration), and `snapshot_text` holds a plain-text/markdown snapshot for cheap reads, search, and version history.

The `bytea` column is declared with a Drizzle custom type (`canvas.ts:6-10`):

```typescript
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType() { return "bytea" } })
```

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Canvas id. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE` | Owning room. |
| `kind` | `canvas_kind` enum | NOT NULL, default `"markdown"` | `markdown`, `code`, `svg`, or `html` (`enums.ts:43`). |
| `title` | `text` | NOT NULL | Display title. |
| `language` | `text` | nullable | Programming language for `kind = "code"`. |
| `ydoc_state` | `bytea` | nullable | Raw Yjs document state (binary `Buffer`). |
| `snapshot_text` | `text` | NOT NULL, default `""` | Latest rendered snapshot; agent tools read/write this. |
| `created_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Creator. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps (`updated_at` maintained by trigger). |

Indexes: `canvases_room_idx` on `(room_id)` (`canvas.ts:28`).

**RLS** (`packages/db/sql/0002_rls.sql:166-169`): `canvases_select` via `can_read_room(room_id)`. Edits go through the collab Yjs server and agent canvas tools (service role), not direct client writes.

**Realtime**: `canvases` is added to the `supabase_realtime` publication (`packages/db/sql/0003_realtime.sql:7-18`) alongside `messages` and `tool_calls`.

**Used by**: the Yjs Monaco collaboration server (`apps/orchestrator/src/collab/index.ts`), canvas tools (`apps/orchestrator/src/canvas/tools.ts`), MCP server (`apps/orchestrator/src/mcp/server.ts`), storage accounting (`apps/web/src/app/(workspace)/[org]/settings/storage/page.tsx`), and the OAuth authorize page listing readable canvases (`apps/web/src/app/oauth/authorize/page.tsx`).

---

## Canvas versions (`canvas_versions`)

Defined at `packages/db/src/schema/canvas.ts:31`. Append-only version history: every significant write (agent publish, human save, restore) snapshots `snapshot_text` here before mutating the live canvas.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Version id. |
| `canvas_id` | `uuid` | NOT NULL, FK → `canvases.id`, `ON DELETE CASCADE` | The versioned canvas. |
| `author_type` | `text` | NOT NULL | Free-form author kind (e.g. `"agent"`, `"human"`, `"computer"`). |
| `author_id` | `uuid` | nullable | Polymorphic author id (profile or agent); no FK by design. |
| `snapshot_text` | `text` | NOT NULL | Full snapshot at this version. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Version time. |

Indexes: `canvas_versions_canvas_idx` on `(canvas_id, created_at)` (`canvas.ts:43`) — the history-timeline query.

**RLS** (`packages/db/sql/0002_rls.sql:171-179`): `canvas_versions_select` — readable when the parent canvas's room is readable (`exists (select 1 from public.canvases c where c.id = canvas_id and public.can_read_room(c.room_id))`). Writes are server-side.

**Used by**: canvas tools and computer publishes (`apps/orchestrator/src/canvas/tools.ts`, `apps/orchestrator/src/tools/builtins/computer.ts`) and the MCP server (`apps/orchestrator/src/mcp/server.ts`).

---

## Discrepancy notes (code vs AGENTS.md / task brief)

- AGENTS.md describes `tool_calls` as part of the audited tool flow; the table is defined in `packages/db/src/schema/tools.ts:49` (with `tool_call_status` values including `pending_approval`), not in `messages.ts` as the documentation brief assumed. It is covered in [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md).
- There is **no `attachments` table** anywhere in `packages/db/src/schema/`. Message file references live in `messages.metadata` jsonb; the only file-adjacent SQL table is `mobile_push_tokens` (`packages/db/sql/0026_mobile_push_and_files.sql:5`).
- `room_schedules` is not in `rooms.ts`; it is defined in `packages/db/src/schema/meetings.ts:16` and documented with meetings.
- AGENTS.md's example RLS predicate (`org_id in (select org_id from org_members where user_id = auth.uid())`) is implemented in this area as `public.can_read_room(room_id)`, which resolves room visibility through `rooms.kind`, `room_members`, and `org_members`.

---

## Related docs

- [Database reference overview](./overview.md)
- [Agents & templates schemas](./schema-agents-and-templates.md)
- [Tasks & owner facts schemas](./schema-tasks-and-facts.md)
- [Routines & meetings schemas](./schema-routines-and-meetings.md)
- [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
