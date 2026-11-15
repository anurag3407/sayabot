# Tasks & Owner Facts Schemas

This reference documents Sayabot's "board of record" — the durable task tracker agents and humans share (`tasks`, `task_events`, `task_comments`) — and `owner_facts`, the table of things workspace owners have already told their bots so nobody gets asked the same question twice. Tasks are integrity-enforced at the database level: a trigger makes titles immutable and forces `completed_at` + `outcome_kind` before a task can be marked `done`.

Source files: `packages/db/src/schema/tasks.ts`, `packages/db/src/schema/facts.ts`, `packages/db/src/schema/enums.ts`, `packages/db/migrations/0001_amusing_tarot.sql`, `packages/db/sql/0005_ia.sql`, `packages/db/sql/0008_task_integrity.sql`, `packages/db/sql/0019_owner_facts.sql`

---

## Tasks (`tasks`)

Defined at `packages/db/src/schema/tasks.ts:33`. Base columns come from the Drizzle snapshot (`migrations/0001_amusing_tarot.sql`); the integrity migration `packages/db/sql/0008_task_integrity.sql:2-15` added the deadline/unblock/outcome/ask-queue columns. A task can be a plain `task` or a `request` (a `task_kind` of a bot asking a human).

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Task id. |
| `number` | `serial` | NOT NULL | Human-friendly increasing board number (`#12`) alongside the uuid. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `room_id` | `uuid` | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE` | Room the task lives in (tasks are per-room, org aggregates by join). |
| `kind` | `task_kind` enum | NOT NULL, default `"task"` | `task` (work item) or `request` (bot → human ask) (`enums.ts:65`). |
| `title` | `text` | NOT NULL | Title. **Immutable after creation** — enforced by the `tasks_enforce_integrity` trigger (`0008_task_integrity.sql:50-52`). |
| `description` | `text` | NOT NULL, default `""` | Details / acceptance criteria. |
| `status` | `task_status` enum | NOT NULL, default `"open"` | `open`, `in_progress`, `stuck`, `done` (`enums.ts:66`). |
| `assignee_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human assignee. |
| `assignee_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Bot assignee (atomic claims via the `tasks:*` tools). |
| `lead_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Coordinating bot for multi-agent work (subagent delegation). |
| `parent_task_id` | `uuid` | nullable | Parent for subtask trees. **No FK** — plain uuid so deletion of a parent doesn't cascade into work records. |
| `budget_turns` | `integer` | nullable | Turn budget for the task; the coordinator stops spending past it. |
| `budget_usd` | `numeric(10,4)` | nullable | Dollar budget. |
| `turns_used` | `integer` | NOT NULL, default `0` | Spend counter against `budget_turns`. |
| `cost_usd` | `numeric(10,4)` | NOT NULL, default `"0"` | Spend counter against `budget_usd` (note: string default in Drizzle for numeric fidelity, `tasks.ts:59`). |
| `requested_by_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | For `kind = "request"`: the bot that asked. |
| `requested_from_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | For `kind = "request"`: the human being asked. |
| `created_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human creator. |
| `due_at` | `timestamptz` | nullable | Deadline (`0008_task_integrity.sql:4`). |
| `status_changed_at` | `timestamptz` | NOT NULL, default `now()` | Last status transition; powers "stuck for N hours" check-in logic (`0008_task_integrity.sql:5-6`). |
| `completed_at` | `timestamptz` | nullable | Completion time; **required (with `outcome_kind`) when `status = 'done'`** per the trigger (`0008_task_integrity.sql:54-58`). |
| `unblock_needs` | `text` | nullable, TS-typed `UnblockNeeds` | Why the task is stuck: `human_answer`, `another_agent`, `credential`, `external_access`, `time`, `other`. Enforced by SQL CHECK (`0008_task_integrity.sql:7-9`); typed in TS via `tasks.ts:17-23`, not a native enum. |
| `unblock_detail` | `text` | nullable | Free-text explanation accompanying `unblock_needs`. |
| `blocked_by` | `uuid[]` | NOT NULL, default `[]` | Array of task ids this task waits on; array (not FK rows) keeps blocking lightweight and cycle-tolerant (`tasks.ts:74`). |
| `outcome_kind` | `text` | nullable, TS-typed `OutcomeKind` | What completing produced: `artifact`, `submission`, `external_change`, `decision`, `none`, `legacy` — SQL CHECK enforced (`0008_task_integrity.sql:10-12`), typed at `tasks.ts:25-31`. |
| `outcome_ref` | `text` | nullable | Pointer to the outcome (canvas id, PR URL, …). |
| `fold_key` | `text` | nullable | Deduplication key for repeated asks; same `fold_key` folds into one task instead of spamming new ones (`0008_task_integrity.sql:13`). |
| `asked_count` | `integer` | NOT NULL, default `1` | How many times the ask has been raised; bumped instead of re-asking (`0008_task_integrity.sql:14`). |
| `expires_at` | `timestamptz` | nullable, default `now() + interval '72 hours'` | TTL so abandoned asks expire rather than haunting the board (`0008_task_integrity.sql:15`). |
| `metadata` | `jsonb` | NOT NULL, default `{}` | Extensions. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps. |

Indexes (`tasks.ts:84-90`): `tasks_room_status_idx` on `(room_id, status)`, `tasks_org_status_idx` on `(org_id, status)`, `tasks_assignee_agent_idx` on `(assignee_agent_id)`, `tasks_lead_agent_idx` on `(lead_agent_id)`, `tasks_parent_task_idx` on `(parent_task_id)`.

**Integrity trigger** (`0008_task_integrity.sql:44-70`): `tasks_enforce_integrity` runs `before update` and (1) rejects any change to `title` ("title is immutable after creation") and (2) rejects `status = 'done'` unless `completed_at` and `outcome_kind` are both set ("done tasks require completed_at and outcome_kind").

**RLS** (`packages/db/sql/0005_ia.sql:34-38`): `tasks_select` via `public.can_read_room(room_id)`. Client writes are not granted; all mutations flow through the orchestrator task tools (service role), which are the audited path.

**Used by**: the task board (`apps/web/src/app/(workspace)/[org]/tasks/page.tsx`), agent/bot pages showing assigned work, orchestrator task tools and service (`apps/orchestrator/src/collab/tasks-service.ts`, `apps/orchestrator/src/collab/index.ts`), engine context building (`apps/orchestrator/src/engine/run.ts`), and check-in classification (`apps/orchestrator/src/collab/classify-checkin.ts`).

---

## Task events (`task_events`)

Defined at `packages/db/src/schema/tasks.ts:93` (created `packages/db/sql/0008_task_integrity.sql:39-54`). Append-only audit trail of every status transition and outcome declaration. `actor_type` carries a SQL CHECK (`human`, `agent`, `system`).

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Event id. |
| `task_id` | `uuid` | NOT NULL, FK → `tasks.id`, `ON DELETE CASCADE` | The task. |
| `actor_type` | `text` | NOT NULL, TS-typed `"human" \| "agent" \| "system"` (`tasks.ts:100`) | Who acted; CHECK-enforced in SQL. |
| `actor_id` | `uuid` | nullable | Polymorphic actor id (profile or agent); no FK. |
| `from_status` | `text` | nullable | Previous status; null on creation events. |
| `to_status` | `text` | NOT NULL | New status. |
| `reason` | `text` | nullable | Why the transition happened. |
| `outcome_kind` | `text` | nullable, TS-typed `OutcomeKind` | Outcome declared on completion (same value set as `tasks.outcome_kind`). |
| `outcome_ref` | `text` | nullable | Pointer to the outcome. |
| `metadata` | `jsonb` | NOT NULL, default `{}` | Extensions. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Event time. |

Indexes (`tasks.ts:110-113`): `task_events_task_idx` on `(task_id, created_at)` (the per-task history) and `task_events_to_status_idx` on `(to_status, created_at)` (e.g. "recently completed" queries).

**RLS** (`0008_task_integrity.sql:74-89`): `task_events_select` — readable when the parent task's room is readable (`exists (select 1 from public.tasks t where t.id = task_id and public.can_read_room(t.room_id))`). `insert, update, delete` are revoked from `anon`/`authenticated` and only `select` is granted — the audit trail is immutable to clients.

**Realtime**: `task_events` is added to the `supabase_realtime` publication (`0008_task_integrity.sql:92-102`) so boards update live.

**Used by**: task tools/service (`apps/orchestrator/src/collab/tasks-service.ts`, `apps/orchestrator/src/collab/index.ts`), meeting summaries (`apps/orchestrator/src/scheduler/meetings.ts`), and check-in classification (`apps/orchestrator/src/collab/classify-checkin.ts`).

---

## Task comments (`task_comments`)

Defined at `packages/db/src/schema/tasks.ts:116` (created in `migrations/0001_amusing_tarot.sql`). Discussion thread attached to a task.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Comment id. |
| `task_id` | `uuid` | NOT NULL, FK → `tasks.id`, `ON DELETE CASCADE` | The task. |
| `author_type` | `text` | NOT NULL, default `"human"` | `"human"` / `"agent"` / `"system"` (free text, not CHECK-enforced). |
| `author_id` | `uuid` | nullable | Polymorphic author id; no FK. |
| `content` | `text` | NOT NULL | Comment body. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Posted at. |

Indexes: `task_comments_task_idx` on `(task_id, created_at)` (`tasks.ts:128`).

**RLS** (`packages/db/sql/0005_ia.sql:40-47`): `task_comments_select` — readable when the parent task's room is readable. Writes are server-side.

**Used by**: task tools and service (`apps/orchestrator/src/collab/tasks-service.ts`, `apps/orchestrator/src/collab/index.ts`) and runner context assembly (`apps/orchestrator/src/runner/context.ts`), which includes recent comments in the bot's task briefing.

---

## Owner facts (`owner_facts`)

Defined at `packages/db/src/schema/facts.ts:15` (created `packages/db/sql/0019_owner_facts.sql`). Per the doc comment (`facts.ts:10-14`): "Things the people in a workspace have already told their bots ('start date', 'CGPA', 'LinkedIn URL'). Bots read these before asking, so nobody answers the same question twice. `room_id` null = every room in the workspace; otherwise only bots in that room can read it."

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Fact id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Workspace. |
| `room_id` | `uuid` | nullable, FK → `rooms.id`, `ON DELETE CASCADE` | Scope: null = workspace-wide, otherwise room-local. |
| `key` | `text` | NOT NULL | Canonical fact key (e.g. `start_date`). |
| `label` | `text` | NOT NULL | Human label shown in UI (e.g. "Start date"). |
| `value` | `text` | NOT NULL | The answer itself (plaintext — this is a fact, not a credential). |
| `source` | `text` | NOT NULL, default `"answer"`, TS-typed `OwnerFactSource` | `answer` (given in reply to a bot's ask), `manual`, or `agent` (`facts.ts:8`). |
| `source_task_id` | `uuid` | nullable, FK → `tasks.id`, `ON DELETE SET NULL` | The `kind = "request"` task that solicited the answer. |
| `source_agent_id` | `uuid` | nullable, FK → `agents.id`, `ON DELETE SET NULL` | The bot that asked. |
| `note` | `text` | nullable | Extra context. |
| `updated_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Last human editor. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps (`updated_at` maintained by the `set_updated_at` trigger attached in `0019_owner_facts.sql:26-28`). |

Indexes (`facts.ts:34-41`): the interesting one is **unique `owner_facts_scope_key_idx`** on `(org_id, coalesce(room_id, '00000000-0000-0000-0000-000000000000'::uuid), key)` — an expressional unique index that maps null `room_id` to a sentinel uuid, so "workspace-wide fact with this key" and "room fact with this key" both enforce one-row-per-key while remaining distinguishable. Plus `owner_facts_org_idx` on `(org_id)` for scans.

**RLS** (`0019_owner_facts.sql:30-44`): `owner_facts_select` — workspace-wide facts (`room_id is null`) readable by org members; room facts require `can_read_room(room_id)`. Writes: `revoke all` from `anon`/`public`, `revoke insert, update, delete` from `authenticated`, `grant all` to `service_role` — "writes go through the server (service role) so every change is audited."

**Used by**: the facts service and ask/response loop (`apps/orchestrator/src/collab/facts.ts`), engine context assembly so bots don't re-ask (`apps/orchestrator/src/engine/run.ts`), the memory service surfacing owner facts alongside memories (`apps/orchestrator/src/memory/service.ts`), and the memory search tool, which describes them as "what the owner already told you (owner facts)" (`apps/orchestrator/src/memory/tools.ts:114`).

---

## The ask queue and expiry semantics

`packages/db/sql/0008_task_integrity.sql` describes its own scope as "Board of Record: Task integrity, check-in discipline, and ask queue deduplication". Three `tasks` columns implement the ask-queue half:

- **`fold_key`**: when a bot is about to re-raise an ask (e.g. "need the API credential" a third time), it computes the same `fold_key` instead of creating a new `kind = "request"` task. The existing row is reused, keeping the board readable.
- **`asked_count`**: each re-raise bumps this counter (default `1`) rather than inserting a duplicate row, so urgency escalates as a number instead of as spam.
- **`expires_at`**: defaults to `now() + interval '72 hours'` (`0008_task_integrity.sql:15`) so an abandoned ask quietly expires; nothing prunes it automatically — the value is the contract that tools and UI use to filter stale asks.

Integrity rules enforced by the `tasks_enforce_integrity` trigger (`0008_task_integrity.sql:44-70`):

| Situation | Result |
| :--- | :--- |
| `update` changes `title` | Rejected: `title is immutable after creation`. |
| `status` set to `done` without `completed_at` or `outcome_kind` | Rejected: `done tasks require completed_at and outcome_kind`. |
| Any other valid update | Passes through; `status_changed_at` is maintained by application code, not the trigger. |

Blocking and subtasks are intentionally loose: `blocked_by` is a `uuid[]` of task ids and `parent_task_id` a bare uuid, both without FKs, so a deleted parent/blocking task never cascades into surviving work records (see `tasks.ts:55,74`).

---

## Discrepancy notes (code vs AGENTS.md)

- AGENTS.md's example table snippet shows `org_id` as mandatory on every tenant table; `owner_facts` follows it, but its room scoping (`room_id` null = workspace-wide) plus the `coalesce`-based unique index is a pattern AGENTS.md does not describe — the code is more expressive than the manual's example.
- `tasks.blocked_by` and `tasks.parent_task_id` intentionally have **no foreign keys** (plain `uuid`/`uuid[]`), so blocking relations and subtask links survive parent deletion; AGENTS.md's blanket "references with onDelete cascade" examples should not be read as applying to these self-referential columns.
- `tasks.unblock_needs` / `tasks.outcome_kind` are `text` + CHECK constraints in SQL (with TS union types), not native pg enums, even though `unblockNeedsEnum`/`outcomeKindEnum` exist in `packages/db/src/schema/enums.ts:67-82` — those enum objects are typed helpers only; drizzle-kit will not emit `create type` for them.

---

## Related docs

- [Database reference overview](./overview.md)
- [Rooms, messages & canvas schemas](./schema-rooms-messages-canvas.md)
- [Memory schemas](./schema-memory.md)
- [Routines & meetings schemas](./schema-routines-and-meetings.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Migrations catalog](./migrations-catalog.md)
