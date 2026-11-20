# Routines & Meetings Schemas

This reference documents `packages/db/src/schema/routines.ts` — the Hermes cron scheduler's `routines` and `routine_runs` tables — and `packages/db/src/schema/meetings.ts`, which holds both `meetings` (scheduled or check-in sessions in a room) and `room_schedules` (the per-room working-hours/check-in configuration the scheduler uses to generate them). Routines are the persistence behind agents that run on a schedule; meetings formalize time-boxed multi-participant sessions, including the automatic daily "meeting" and periodic "checkin" kinds derived from `room_schedules`.

Source files: `packages/db/src/schema/routines.ts`, `packages/db/src/schema/meetings.ts`, `packages/db/src/schema/enums.ts`, `packages/db/sql/0005_ia.sql`, `packages/db/sql/0008_task_integrity.sql`, `packages/db/sql/0014_routines.sql`

---

## Routines (`routines`)

Defined at `packages/db/src/schema/routines.ts:16` (created `packages/db/sql/0014_routines.sql`). One row per scheduled agent job: a cron-style expression plus a prompt the orchestrator turns into a turn in the bound room. `room_id` is nullable — a routine can be roomless (its output goes only to run history) — and unlike most FKs in the package it uses `ON DELETE SET NULL` rather than cascade (`routines.ts:23`).

| Column                      | SQL type              | Constraints / Default                              | Description                                                                                                    |
| :-------------------------- | :-------------------- | :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- |
| `id`                        | `uuid`                | PK, default `gen_random_uuid()`                    | Routine id.                                                                                                    |
| `org_id`                    | `uuid`                | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`      | Owning workspace.                                                                                              |
| `room_id`                   | `uuid`                | nullable, FK → `rooms.id`, `ON DELETE SET NULL`    | Room where the prompt runs; null = no room context.                                                            |
| `agent_id`                  | `uuid`                | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE`    | The bot that executes the routine.                                                                             |
| `name`                      | `text`                | NOT NULL                                           | Display name.                                                                                                  |
| `description`               | `text`                | nullable                                           | Longer explanation shown in the cron UI.                                                                       |
| `schedule_expr`             | `text`                | NOT NULL                                           | The schedule expression (cron syntax or interval string, interpreted per `schedule_kind`).                     |
| `schedule_kind`             | `text`                | NOT NULL, default `"cron"`                         | Expression dialect; free-form text, not an enum.                                                               |
| `timezone`                  | `text`                | NOT NULL, default `"UTC"`                          | IANA timezone the expression is evaluated in.                                                                  |
| `prompt`                    | `text`                | NOT NULL                                           | The instruction handed to the agent on each run.                                                               |
| `enabled`                   | `boolean`             | NOT NULL, default `true`                           | Pause switch; disabled routines are skipped by the scheduler.                                                  |
| `next_run_at`               | `timestamptz`         | nullable                                           | Computed next fire time; the scheduler's scan key (null until initialized or after a disabled/finished cycle). |
| `last_run_at`               | `timestamptz`         | nullable                                           | Most recent fire time.                                                                                         |
| `last_status`               | `routine_status` enum | NOT NULL, default `"idle"`                         | `idle`, `running`, `success`, `failed` (`enums.ts:146-151`).                                                   |
| `last_error`                | `text`                | nullable                                           | Error text when the last run failed.                                                                           |
| `run_count`                 | `integer`             | NOT NULL, default `0`                              | Lifetime fire counter.                                                                                         |
| `metadata`                  | `jsonb`               | NOT NULL, default `{}`                             | Extensions (e.g. originating message or tool context).                                                         |
| `created_by_user_id`        | `uuid`                | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human creator.                                                                                                 |
| `created_by_agent_id`       | `uuid`                | nullable, FK → `agents.id`, `ON DELETE SET NULL`   | Bot creator (agents may create their own routines via the cron tool).                                          |
| `created_at` / `updated_at` | `timestamptz`         | NOT NULL, default `now()`                          | Timestamps.                                                                                                    |

Indexes (`routines.ts:49-54`): `routines_org_idx` on `(org_id, enabled)` (the workspace routine list), `routines_next_run_idx` on `(enabled, next_run_at)` (the scheduler's "what fires next" scan), `routines_agent_idx` on `(agent_id)`, and `routines_room_idx` on `(room_id)`.

**RLS** (`packages/db/sql/0014_routines.sql:55-76`): four policies on `routines` (`routines_select_policy`, `routines_insert_policy`, `routines_update_policy`, `routines_delete_policy`), all `public.is_org_member(org_id)` — org members may manage their own workspace's routines directly. Writes in practice go through the web API routes and the orchestrator cron tool (service role), which also enforce capability checks (`cron` capability flag on the agent).

**Used by**: the Hermes scheduler loop (`apps/orchestrator/src/scheduler/routines.ts`, which initializes missing `next_run_at` for enabled idle routines at lines 182-200 and fires them), the cron management page (`apps/web/src/app/(workspace)/[org]/cron/page.tsx`) and API (`apps/web/src/app/api/workspaces/[org]/routines/**`), the room page and composer (`apps/web/src/app/(workspace)/[org]/r/[roomId]/page.tsx`, `apps/web/src/components/room/composer.tsx`), and desktop snapshots (`apps/web/src/app/api/desktop/workspace-snapshot/route.ts`).

---

## Routine runs (`routine_runs`)

Defined at `packages/db/src/schema/routines.ts:57` (created `packages/db/sql/0014_routines.sql`). One row per fire of a routine — the run history users see in the cron UI.

| Column        | SQL type              | Constraints / Default                             | Description                                               |
| :------------ | :-------------------- | :------------------------------------------------ | :-------------------------------------------------------- |
| `id`          | `uuid`                | PK, default `gen_random_uuid()`                   | Run id.                                                   |
| `routine_id`  | `uuid`                | NOT NULL, FK → `routines.id`, `ON DELETE CASCADE` | The routine that fired.                                   |
| `org_id`      | `uuid`                | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`     | Denormalized workspace for fast org-wide history queries. |
| `status`      | `routine_status` enum | NOT NULL, default `"running"`                     | `running` on insert; ends as `success` or `failed`.       |
| `started_at`  | `timestamptz`         | NOT NULL, default `now()`                         | Fire time.                                                |
| `finished_at` | `timestamptz`         | nullable                                          | Completion time; null while `running`.                    |
| `output`      | `text`                | nullable                                          | Summary of what the run produced (agent's final output).  |
| `error`       | `text`                | nullable                                          | Error text when `status = "failed"`.                      |

Indexes: `routine_runs_routine_idx` on `(routine_id, started_at)` (per-routine history) and `routine_runs_org_idx` on `(org_id, started_at)` (`routines.ts:73-76`).

**RLS** (`0014_routines.sql:77-84`): `routine_runs_select_policy` and `routine_runs_insert_policy`, both `is_org_member(org_id)`. Updates/deletes have no client policies — a finished run's record is immutable to clients; the scheduler (service role) finalizes it.

**Used by**: the scheduler writes runs as they fire (`apps/orchestrator/src/scheduler/routines.ts`) and the results renderer serves history to clients (`apps/orchestrator/src/scheduler/routine-results.ts`).

---

## Room schedules (`room_schedules`)

Defined at `packages/db/src/schema/meetings.ts:16`. One row per room (PK = FK to `rooms.id`) holding the working-hours windows that drive automatic meetings and the check-in discipline configuration. All minute-of-day fields are interpreted in the row's `timezone`.

| Column                      | SQL type      | Constraints / Default                                         | Description                                                                                                                                                                                                                    |
| :-------------------------- | :------------ | :------------------------------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `room_id`                   | `uuid`        | PK, FK → `rooms.id`, `ON DELETE CASCADE`                      | The configured room; one schedule row per room, upserted with `on conflict (room_id) do nothing` (`0005_ia.sql:80-82`).                                                                                                        |
| `timezone`                  | `text`        | NOT NULL, default `"UTC"`                                     | Timezone for all minute-of-day fields.                                                                                                                                                                                         |
| `morning_start_minutes`     | `integer`     | NOT NULL, default `540` (09:00)                               | Start of the automatic morning meeting window.                                                                                                                                                                                 |
| `morning_end_minutes`       | `integer`     | NOT NULL, default `570` (09:30)                               | End of the morning window.                                                                                                                                                                                                     |
| `evening_start_minutes`     | `integer`     | NOT NULL, default `1020` (17:00)                              | Start of the evening window.                                                                                                                                                                                                   |
| `evening_end_minutes`       | `integer`     | NOT NULL, default `1050` (17:30)                              | End of the evening window.                                                                                                                                                                                                     |
| `checkins_enabled`          | `boolean`     | NOT NULL, default `false`                                     | Master switch for periodic bot check-ins.                                                                                                                                                                                      |
| `checkin_interval_minutes`  | `integer`     | NOT NULL, default `60`                                        | How often check-ins fire within the window.                                                                                                                                                                                    |
| `checkin_start_minutes`     | `integer`     | NOT NULL, default `540`                                       | Start of the daily check-in window.                                                                                                                                                                                            |
| `checkin_end_minutes`       | `integer`     | NOT NULL, default `1050`                                      | End of the daily check-in window.                                                                                                                                                                                              |
| `checkin_duration_minutes`  | `integer`     | NOT NULL, default `10`                                        | How long each check-in session may run.                                                                                                                                                                                        |
| `checkin_mode`              | `text`        | NOT NULL, default `"stream"`, TS-typed `"stream" \| "digest"` | `stream` (one live session) or `digest` (batched summary); CHECK-constrained in SQL (`0008_task_integrity.sql:20-21`), typed via `meetings.ts:30` — the `checkinModeEnum` in `enums.ts:83` is a TS-only mirror, not a pg type. |
| `digest_at`                 | `integer`     | nullable                                                      | Minute-of-day for digest delivery (used when `checkin_mode = "digest"`; added by `0008_task_integrity.sql:22`).                                                                                                                |
| `last_checkin_at`           | `timestamptz` | nullable                                                      | Most recent check-in fire, for interval scheduling.                                                                                                                                                                            |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()`                                     | Timestamps.                                                                                                                                                                                                                    |

**RLS** (`packages/db/sql/0005_ia.sql:28-33`): `room_schedules_select` via `public.can_read_room(room_id)`. Writes go through room settings (server-side).

**Used by**: the meeting/check-in scheduler (`apps/orchestrator/src/scheduler/meetings.ts`) and check-in classification (`apps/orchestrator/src/collab/classify-checkin.ts`), which compares `agent_reads.last_reported_at` against these windows.

---

## Meetings (`meetings`)

Defined at `packages/db/src/schema/meetings.ts:37` (created in `packages/db/migrations/0001_amusing_tarot.sql`). One row per time-boxed session in a room: human-scheduled meetings, auto-generated morning/evening meetings derived from `room_schedules`, or periodic check-ins (`kind = "checkin"`).

| Column                      | SQL type              | Constraints / Default                              | Description                                                                       |
| :-------------------------- | :-------------------- | :------------------------------------------------- | :-------------------------------------------------------------------------------- |
| `id`                        | `uuid`                | PK, default `gen_random_uuid()`                    | Meeting id.                                                                       |
| `org_id`                    | `uuid`                | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`      | Workspace (denormalized for org-wide calendars).                                  |
| `room_id`                   | `uuid`                | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE`     | Room the meeting happens in.                                                      |
| `kind`                      | `meeting_kind` enum   | NOT NULL, default `"meeting"`                      | `meeting` (planned session) or `checkin` (periodic status round) (`enums.ts:58`). |
| `title`                     | `text`                | NOT NULL                                           | Display title.                                                                    |
| `agenda`                    | `text`                | NOT NULL, default `""`                             | Agenda text injected into participants' context.                                  |
| `starts_at`                 | `timestamptz`         | NOT NULL                                           | Absolute start (resolved from the schedule windows at creation).                  |
| `ends_at`                   | `timestamptz`         | NOT NULL                                           | Absolute end.                                                                     |
| `status`                    | `meeting_status` enum | NOT NULL, default `"scheduled"`                    | `scheduled`, `active`, `ended`, `canceled` (`enums.ts:59-64`).                    |
| `created_by`                | `uuid`                | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Human creator (null for scheduler-generated meetings).                            |
| `prompt_message_id`         | `uuid`                | nullable, FK → `messages.id`, `ON DELETE SET NULL` | The room message that kicked the meeting off (links the session to its trigger).  |
| `summary`                   | `text`                | nullable                                           | Post-meeting summary written by the summarizer role.                              |
| `metadata`                  | `jsonb`               | NOT NULL, default `{}`                             | Extensions.                                                                       |
| `created_at` / `updated_at` | `timestamptz`         | NOT NULL, default `now()`                          | Timestamps.                                                                       |

Indexes (`meetings.ts:62-66`): `meetings_room_start_idx` on `(room_id, starts_at)`, `meetings_org_start_idx` on `(org_id, starts_at)`, `meetings_status_idx` on `(status, starts_at)` — the last one is the scheduler's "activate scheduled meetings whose time has come" scan.

**RLS** (`packages/db/sql/0005_ia.sql:24-27`): `meetings_select` via `public.can_read_room(room_id)`. Lifecycle transitions (`scheduled → active → ended/canceled`) are performed by the scheduler (service role).

**Realtime**: `meetings` is added to the `supabase_realtime` publication alongside `tasks` and `task_comments` (`0005_ia.sql:86-96`), so clients see the calendar update live.

**Used by**: the scheduler that generates/activates/summarizes meetings (`apps/orchestrator/src/scheduler/meetings.ts`), the meetings page (`apps/web/src/app/(workspace)/[org]/meetings/page.tsx`), room settings showing the schedule (`apps/web/src/app/(workspace)/[org]/r/[roomId]/settings/page.tsx`), and the workspace shell calendar badge (`apps/web/src/components/workspace-shell.tsx`).

---

## Scheduling semantics

How the columns above are actually driven, from the scheduler's use of them:

- **Routine scan**: the Hermes loop's candidate set is `enabled = true` ordered by `next_run_at` (served by `routines_next_run_idx`). On startup it initializes any `enabled` routine whose `last_status = "idle"` and `next_run_at` is null, computing and persisting the first fire time (`apps/orchestrator/src/scheduler/routines.ts:182-200`) — so a routine inserted without `next_run_at` is picked up automatically, and a failed (`last_status = "failed"`) routine stays inert until re-enabled or repaired.
- **Status machine**: `routines.last_status` and `routine_runs.status` walk `idle → running → success | failed`. A fire inserts a `routine_runs` row with `status = "running"`, sets `routines.last_status = "running"` / `last_run_at`, and on completion writes `finished_at`, `output` or `error`, and the terminal status. `run_count` accumulates every fire regardless of outcome.
- **Meeting generation**: `room_schedules` windows are evaluated in the row's `timezone`; when a window opens the scheduler creates a `meetings` row (`kind = "meeting"` for morning/evening windows, `kind = "checkin"` for check-in intervals) with absolute `starts_at`/`ends_at` resolved from the minute-of-day fields, then drives it `scheduled → active → ended` via the `meetings_status_idx` scan. `last_checkin_at` prevents double-firing within `checkin_interval_minutes`.
- **Check-in discipline**: check-in classification compares an agent's `agent_reads.last_reported_at` against the room's check-in window and per-task status ages (`apps/orchestrator/src/collab/classify-checkin.ts`), which is why `agent_reads.last_reported_at` (added by `packages/db/sql/0008_task_integrity.sql:36-37`) lives with the read cursors rather than in this file.

---

## Discrepancy notes (code vs AGENTS.md)

- AGENTS.md attributes "Hermes cron scheduler" to the orchestrator, which matches `apps/orchestrator/src/scheduler/`; nothing in the schema contradicts it. However, AGENTS.md's Rule 4 lists "modifying cron routines" as a dangerous tool — the `routines` table itself has no danger marker (that concept lives on tool specs, not tables), and org members technically have client-side RLS insert/update/delete policies on `routines` (`0014_routines.sql:58-76`), broader than the strict service-role-only pattern used for invites and secrets in this package.
- `checkin_mode` is a `text` column with a CHECK constraint plus a TS `$type<>` mirror (`meetings.ts:30`), not a native pg enum — `checkinModeEnum` (`packages/db/src/schema/enums.ts:83`) is a TypeScript convenience only; regenerating the table from Drizzle alone would not reproduce the SQL CHECK.
- `room_schedules` was placed in `meetings.ts` (not `rooms.ts` as the module naming might suggest), and its `roomId` doubles as the primary key — a 1:1 extension of `rooms`.

---

## Related docs

- [Database reference overview](./overview.md)
- [Rooms, messages & canvas schemas](./schema-rooms-messages-canvas.md)
- [Tasks & owner facts schemas](./schema-tasks-and-facts.md)
- [Agents & templates schemas](./schema-agents-and-templates.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Migrations catalog](./migrations-catalog.md)
