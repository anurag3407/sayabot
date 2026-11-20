# Task Board Tools

The `tasks` capability exposes the room's shared task board to the agent: listing, creating, atomically claiming, updating with guardrails (done requires an outcome, stuck requires an unblock reason), planning subtask graphs, assigning, requesting human decisions with fold-able dedup, agent-to-agent votes, timed self-follow-ups, and check-in reporting. All tools delegate to the `collab` layer, which enforces the same invariants as the MCP task server — an in-room bot and an external ChatGPT bot see identical rules. Every tool is `dangerous: false`; `CollabError` rejections become `{ error: "<message>" }` tool results instead of aborting the run.

Source files: `apps/orchestrator/src/tools/builtins/tasks.ts`, `apps/orchestrator/src/collab/index.ts`, `apps/orchestrator/src/collab/tasks-service.ts`, `apps/orchestrator/src/collab/classify-checkin.ts`

---

## 🎛️ Registration (`src/tools/index.ts:355-362`)

```typescript
taskTools({ roomId, orgId, agentId, handle: args.agent.handle })
```

Registered when `caps.tasks` is true (default). All tools bind to the **current room** — there is no cross-room task access via these tools. The shared suffix in descriptions: _"To get a teammate to act on it during this turn, also mention them with @handle in your reply."_ (`tasks.ts:56-57`)

## 📋 Tool reference

### `list_tasks` (`tasks.ts:59-67`)

| Parameter | Type                                                  | Description                              |
| :-------- | :---------------------------------------------------- | :--------------------------------------- |
| `status`  | enum `open \| in_progress \| stuck \| done`, optional | Filter by status                         |
| `mine`    | boolean, optional                                     | Only tasks assigned to the calling agent |

Returns up to 40 tasks ordered by `updatedAt` desc (`collab/index.ts:492-517`):

```typescript
{ id, ref: "MESH-<number>", kind: "task" | "request", title,
  description: <first 1000 chars>, status, assigned_to_me, assigned, updated_at }
```

### `create_task` (`tasks.ts:68-87`)

| Parameter      | Type                       | Description                                                                                                        |
| :------------- | :------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| `title`        | string (2–120)             | Task title                                                                                                         |
| `description`  | string (≤ 4,000), optional | Details                                                                                                            |
| `assign_to_me` | boolean, optional          | `false` leaves the task unassigned (`open`) for a teammate to claim; default assigns to the caller (`in_progress`) |

`createTask` (`collab/index.ts:519-541`) calls `applyTaskCreate` with `metadata: { source: "agent", createdByAgent: agentId }`. Returns `{ id, ref: "MESH-<n>", title, status }`.

### `claim_task` — the atomic claim (`tasks.ts:123-130`)

| Parameter | Type          | Description   |
| :-------- | :------------ | :------------ |
| `task_id` | string (uuid) | Task to claim |

`claimTask` (`collab/index.ts:543-600`) runs a single transaction with a conditional `UPDATE … WHERE id = task AND status != 'done' AND assignee_user_id IS NULL AND (assignee_agent_id IS NULL OR assignee_agent_id = me)` — two agents racing get exactly one winner; the loser receives:

```typescript
{ claimed: false, reason: "task is already done" | "already claimed by @<handle>" | "already claimed by a human" }
```

The winner gets `{ claimed: true, id, ref, title }`, plus a `taskEvents` row (`reason: "claimed"`) and a `taskComments` entry `"@<handle> claimed this task."`. Requests (kind `request`) cannot be claimed (`"requests cannot be claimed"`).

### `update_task` — guarded mutations (`tasks.ts:168-226`)

| Parameter        | Type                                                                                                | Description                                                       |
| :--------------- | :-------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------- |
| `task_id`        | string (uuid)                                                                                       | Task to update                                                    |
| `status`         | enum `open \| in_progress \| stuck \| done`, optional                                               | New status                                                        |
| `note`           | string (≤ 4,000), optional                                                                          | Progress note (becomes a `task_comments` row)                     |
| `ask_help_from`  | string, optional                                                                                    | `@handle` to ping for help when going stuck (default `@all_bots`) |
| `release`        | boolean, optional                                                                                   | Release the task back to unassigned (`open`)                      |
| `due_at`         | string, optional                                                                                    | Due date                                                          |
| `unblock_needs`  | enum `human_answer \| another_agent \| credential \| external_access \| time \| other`, optional    | Required when status = `stuck`                                    |
| `unblock_detail` | string (≤ 1,000), optional                                                                          | What exactly is blocking                                          |
| `form_ref`       | string, optional                                                                                    | Form evidence when claiming a `human_answer` blocker              |
| `blocked_by`     | uuid[], optional                                                                                    | Dependency task ids (same room only)                              |
| `outcome`        | `{ kind: artifact \| submission \| external_change \| decision \| none \| legacy, ref? }`, optional | Required when status = `done`                                     |
| `reason`         | string, optional                                                                                    | Required when moving to `in_progress` with unresolved blockers    |

Server-side invariants enforced by `applyTaskMutation` (`collab/tasks-service.ts:55-230`):

1. Title is immutable (`"title is immutable after creation"`).
2. `done` requires an outcome; agents cannot close with `kind: "none"` (`"agents cannot close tasks with outcome 'none'; an artifact, submission, external_change, or decision is required"`).
3. `stuck` requires `unblock_needs` (`"marking a task stuck requires unblock_needs"`).
4. A `stuck` + `human_answer` claim requires form evidence: a `form_ref`, prior form read, or an `unblock_detail` (≥ 15 chars) citing the form/field (`"cannot claim a human-fact blocker before reading the form that would ask for it…"`, `tasks-service.ts:105-166`).
5. `in_progress` with unresolved `blocked_by` requires a non-empty `reason` (`tasks-service.ts:178-190`).

Ownership: a task held by another agent can only be touched when it is `stuck` (helping); otherwise `"this task belongs to another agent; claim it first"` (`collab/index.ts:691-693`). Requests route to `"use the Inbox flow for requests"`.

**Stuck flow** (`collab/index.ts:708-727`): setting status `stuck` posts a room message pinging `@<ask_help_from>` (or `@all_bots`) with the MESH-ref and unblock need, and calls `notifyHumansNeeded({ kind: "request", detail: "Stuck on MESH-<n>: <title>" })` — the human Inbox path ([./approvals.md](./approvals.md)). Returns `{ id, ref, status, eventId, asked_for_help? }`.

### `schedule_followup` (`tasks.ts:88-122`)

| Parameter    | Type                          | Description                           |
| :----------- | :---------------------------- | :------------------------------------ |
| `in_minutes` | int 1–10,080 (1 min – 7 days) | Delay before the wake-up              |
| `title`      | string (2–120)                | Short title (prefixed `[Follow-up] `) |
| `note`       | string (≤ 2,000)              | What to check when awakened           |

Implementation: creates a task assigned to self with `unblockNeeds: "time"` and `dueAt = now + in_minutes`, then `{ ok: true, taskId, scheduledFor, inMinutes, message }`. The wake-up is driven by the scheduler's due-follow-up pass (`src/scheduler/meetings.ts:355-400`): open tasks with `unblockNeeds = "time"` and `dueAt <= now` are claimed (`in_progress`, unblock fields cleared) and the assigned agent's handle is mentioned in the room, which starts a new turn. (`enqueueTaskWake` fires immediately for assignment/unblock events, not on the timer — the due pass is what honors `in_minutes`.)

### `report_checkin` (`tasks.ts:131-167`)

| Parameter   | Type                                             | Description                          |
| :---------- | :----------------------------------------------- | :----------------------------------- |
| `summary`   | string (≤ 1,000), optional                       | Free-text progress summary           |
| `changed`   | `{ task_ref?, task_id?, event_id? }[]`, optional | Cited task-event ids proving changes |
| `no_change` | boolean, optional                                | Nothing changed since last check-in  |

`classifyAndRecordCheckin` (`collab/classify-checkin.ts:43-121`) verifies cited `event_id`s against `task_events` created after the agent's last check-in cursor (`agent_reads.lastReportedAt`). Room `roomSchedules.checkinMode` decides delivery: `"digest"` mode keeps no-change reports quiet (rolled into the daily digest); `"stream"` mode posts them with `metadata.quiet = true` for client collapsing. Claims of change without valid events are flagged `manufacturedTrivia`. Requests/auto-moot closing runs first (`autoCloseMootRequests`).

### `request_human_decision` (`tasks.ts:227-250`)

| Parameter  | Type                                  | Description                                          |
| :--------- | :------------------------------------ | :--------------------------------------------------- |
| `task_id`  | string (uuid), optional               | Task the question is about                           |
| `question` | string (4–120)                        | Short question                                       |
| `details`  | string (≤ 4,000), optional            | Context                                              |
| `options`  | string[] (each 1–60), max 6, optional | Tap-able answers                                     |
| `fold_key` | string (≤ 64), optional               | Dedup key; repeated asks fold instead of duplicating |

Behavior (`collab/index.ts:765-880+`): asks on `done` tasks are rejected as moot (`"cannot request decision on MESH-<n>: task is already done; this ask is moot"`); an open request with the same computed fold key absorbs repeats (increments `askedCount`, records a `taskEvents` row, returns `{ folded: true, status: "waiting_for_human", asked_count }`); otherwise a `kind: "request"` row is inserted with `expiresAt = now + 72 h` and the humans are notified. The decision card lives in the human Inbox ([./approvals.md](./approvals.md)).

### `start_vote` / `cast_vote` (`tasks.ts:251-274`)

**`start_vote`**: `question` (4–300 chars) + `options` (2–8, each ≤ 120). Creates a room message whose `metadata.vote` holds a `VoteState` (`collab/index.ts:1122-1136`) and pings `@all_bots`. Returns `{ vote_id, options, woke }`.

**`cast_vote`**: `vote_id` (uuid), `option` (by text or 1-based number), optional `reason` (≤ 500). Ballots are stored with a `jsonb_set` update keyed by agent id so concurrent ballots never clobber each other (`collab/index.ts:1165-1180`); broadcasts `message.done` and returns `{ vote_id, your_vote, ...tally, voters }`. Errors: `"vote not found"`, `"this vote is closed"`, `"unknown option; choose one of: …"`.

### `plan_task` (`tasks.ts:275-298`)

| Parameter  | Type                                                                                                           | Description   |
| :--------- | :------------------------------------------------------------------------------------------------------------- | :------------ |
| `task_id`  | string (uuid)                                                                                                  | Parent task   |
| `subtasks` | array 1–12 of `{ key (≤32), title (≤200), description? (≤4,000), assignee?, blockedBy?, budgetTurns? (1–20) }` | Subtask graph |

`applyTaskPlan` (`collab/tasks-service.ts:639-710+`) rejects > 12 subtasks and detects dependency cycles via `hasDependencyCycle` (`"cyclic dependency detected in subtask plan"`); unblocked assignees are woken.

### `assign_task` (`tasks.ts:299-309`)

| Parameter  | Type           | Description                               |
| :--------- | :------------- | :---------------------------------------- |
| `task_id`  | string (uuid)  | Task                                      |
| `assignee` | string (min 1) | Agent `@handle` or `human:<display name>` |

Human assignment matches display names among people who can read the room (`collab/index.ts:617-660+`).

## 🗃️ Tables and events

| Table                                       | Used by                                                                                                                                                         |
| :------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`                                     | list/create/claim/update/plan/assign; `kind` distinguishes `task` vs `request`; `foldKey`, `askedCount`, `unblockNeeds`, `blockedBy`, `outcomeKind/Ref` columns |
| `task_events`                               | audit trail per mutation (from/to status, reason, outcome, metadata); check-in verification reads it                                                            |
| `task_comments`                             | notes, claim comments                                                                                                                                           |
| `agent_reads`                               | `lastReportedAt` check-in cursor                                                                                                                                |
| `room_schedules`                            | `checkinMode` (stream/digest)                                                                                                                                   |
| `messages`                                  | vote state (`metadata.vote`), stuck-help and vote posts                                                                                                         |
| `profiles` / `org_members` / `room_members` | human assignee resolution                                                                                                                                       |

Realtime: vote casting broadcasts `message.done`; the collab layer posts regular messages (which trigger the standard message events). All calls are audited in `tool_calls` by the wrapper.

## 🧪 Example flow

```jsonc
// 1. See what's open
{ "tool": "list_tasks", "args": { "status": "open" } }

// 2. Claim before working — atomic
{ "tool": "claim_task", "args": { "task_id": "<uuid>" } }
// loser: { "claimed": false, "reason": "already claimed by @tea" }

// 3. Blocked on a human answer — must cite form evidence
{ "tool": "update_task", "args": { "task_id": "<uuid>", "status": "stuck",
  "unblock_needs": "human_answer", "unblock_detail": "login form field 'api key' on the portal page",
  "ask_help_from": "tea" } }

// 4. Escalate a high-stakes choice (folds repeats by fold_key)
{ "tool": "request_human_decision", "args": { "task_id": "<uuid>", "question": "Ship v2 or delay?",
  "options": ["Ship v2", "Delay one week"], "fold_key": "v2-ship" } }

// 5. Close with evidence
{ "tool": "update_task", "args": { "task_id": "<uuid>", "status": "done",
  "outcome": { "kind": "artifact", "ref": "/home/bot/report.md" } } }
```

## ⚠️ Notes

1. **Room-scoped.** Unlike `cronjob` (org-wide), task tools operate strictly on the current room's board.
2. **Errors are values.** `friendly()` (`tasks.ts:36-43`) converts `CollabError` into `{ error: "<message>" }` so the agent can retry or escalate; unexpected exceptions still propagate to the audit layer as `status: "error"`.
3. **AGENTS.md names `tasks_stuck` as a tool; the code implements stuck as a transition on `update_task`** (`status: "stuck"` + `unblock_needs`), not a separate tool.

Related docs: [./tool-system.md](./tool-system.md) · [./approvals.md](./approvals.md) · [./tool-cronjob.md](./tool-cronjob.md) · [../../database/schema-tasks-and-facts.md](../../database/schema-tasks-and-facts.md) · [../engine/coordinator.md](../engine/coordinator.md)
