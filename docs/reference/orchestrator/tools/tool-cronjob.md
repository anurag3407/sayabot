# Cronjob Tool (`cronjob`)

The `cronjob` tool lets an agent manage its own and its org's scheduled routines (Hermes-compatible cron jobs): create, list, update, pause, resume, run-now, and remove. Routines are rows in the `routines` table; the Hermes scheduler picks them up by `nextRunAt` and re-enters the room as a normal agent turn. The tool itself is `dangerous: false` — every action succeeds or fails as an ordinary audited call.

Source files: `apps/orchestrator/src/tools/builtins/cronjob.ts`, `apps/orchestrator/src/scheduler/routines.ts:42-54`, `apps/orchestrator/src/tools/builtins/cronjob.test.ts`

---

## 🎛️ Registration

Registered when the agent has the `cron` capability (default `true`, `src/tools/index.ts:389-397`):

```typescript
cronjobTool({ orgId, agentId, roomId })
```

Tool name: `cronjob`. Description: *"Manage autonomous scheduled routines and cron jobs (Hermes-compatible). Actions: create, list, update, pause, resume, run, remove. Allows scheduling agents to execute recurring tasks."*

## 📥 Schema (`cronjob.ts:20-55`)

One flat object; which fields are required depends on `action` (validated at execute time, not by Zod):

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `action` | enum `create \| list \| update \| pause \| resume \| run \| remove` | The routine operation to perform |
| `id` | string, optional | Routine ID; required for `update`, `pause`, `resume`, `run`, `remove` |
| `name` | string, optional | Human-readable title (e.g. `'Daily Standup Summary'`, `'Hourly Monitor'`); required for `create` |
| `schedule` | string, optional | Cron expression (`'0 9 * * 1-5'`, `'*/15 * * * *'`) or natural shorthand (`'daily at 9am'`, `'every 2h'`, `'weekdays at 10:00'`); required for `create` |
| `prompt` | string, optional | Exact task instructions given to the agent when triggered; required for `create` |
| `description` | string, optional | Purpose of the routine |
| `timezone` | string, optional | IANA zone (`'UTC'`, `'America/New_York'`, `'Asia/Kolkata'`); defaults to `UTC` |
| `targetRoomId` | string, optional | Room to post results into; defaults to the current room |
| `targetAgentId` | string, optional | Agent that executes the routine; defaults to the current agent |

## ⚙️ Actions (`cronjob.ts:64-267`)

All actions are scoped to `options.orgId`; a wrong-org routine id simply returns "not found".

### `create` (`cronjob.ts:69-123`)

1. Validates presence of `name`, `schedule`, `prompt` — each missing field returns `{ error: "Missing required '<field>' …" }`.
2. `normalizeCronExpression(schedule)` converts shorthand to a standard 5-part cron, then `isValidCron` validates it. Invalid schedules return `"Invalid cron schedule '<schedule>'. Use standard 5-part cron (e.g. '0 9 * * 1-5') or natural shorthand ('daily at 9am', 'every 30m')."` — the test's `"every 500 hours and bananas"` is rejected this way (`cronjob.test.ts:63-69`).
3. Computes `nextRunAt = getNextCronRun(normExpr, now, timezone)` and inserts into `routines`:

```typescript
{
  orgId, roomId: targetRoom, agentId: targetAgent,
  name, description ?? null,
  scheduleExpr: normExpr, scheduleKind: "cron", timezone,
  prompt, enabled: true, nextRunAt,
  createdByAgentId: options.agentId,     // routines created by bots are traceable
}
```

4. Returns `{ success: true, routine: { id, name, schedule, humanSchedule, timezone, nextRunAt, prompt } }` where `humanSchedule` comes from `humanReadableCron` (e.g. `"Daily at 09:00"`).

### `list` (`cronjob.ts:125-154`)

Returns up to 50 most recent routines for the org, ordered by `createdAt` desc, each enriched with `humanSchedule`:

```typescript
{ routines: [{ id, name, description, scheduleExpr, timezone, enabled, nextRunAt,
               lastRunAt, lastStatus, runCount, agentId, roomId, humanSchedule }] }
```

### `update` (`cronjob.ts:156-207`)

Requires `id`. Loads the routine (org-scoped), applies provided `name`/`description`/`prompt`/`timezone`; a new `schedule` is normalized and validated (error `"Invalid cron schedule '<schedule>'"` on failure). When schedule or timezone changed, `nextRunAt` is recomputed. Returns `{ success: true, routine: { id, name, schedule, humanSchedule, nextRunAt } }`.

### `pause` / `resume` (`cronjob.ts:209-245`)

- `pause`: `UPDATE routines SET enabled = false` (org-scoped) → `{ success: true, message: "Routine '<name>' paused." }`.
- `resume`: reloads the routine, recomputes `nextRunAt` from its existing `scheduleExpr`/`timezone`, sets `enabled: true` → `{ success: true, message: "Routine '<name>' resumed. Next run at <ISO>" }`.

### `run` (`cronjob.ts:247-251`)

Requires `id`; delegates to `runRoutineNow(routineId)` (`src/scheduler/routines.ts:42-54`), which loads the routine and triggers an immediate run. Returns the scheduler's `{ success, runId?, error? }` — the test asserts `{ success: true, runId: "run-abc-123" }` (`cronjob.test.ts:112-117`).

### `remove` (`cronjob.ts:253-262`)

Requires `id`; `DELETE` (org-scoped, returning the row) → `{ success: true, message: "Routine '<name>' removed." }`.

### Unknown action

`default:` returns `{ error: "Unsupported action '<action>'" }` (`cronjob.ts:264-266`).

## 🗃️ Tables and downstream effects

| Table | Access |
| :--- | :--- |
| `routines` | INSERT (create), SELECT (list/update/resume), UPDATE (update/pause/resume), DELETE (remove) |

The tool never executes the prompt itself; it only schedules. When the scheduler fires, the routine posts into `roomId` and runs like any agent turn (see [../engine/coordinator.md](../engine/coordinator.md)); `notifyRoutineFinished` (`src/push.ts`) alerts the routine's creator or the room approvers when the scheduled turn ends. Realtime events specific to `cronjob` are none beyond the standard audit events.

## 🧪 Examples (from `cronjob.test.ts`)

```typescript
const tool = cronjobTool({ orgId: "org-1", agentId: "agent-1", roomId: "room-1" })

// Natural-language schedule normalizes to cron (cronjob.test.ts:54-61)
const res = await tool.execute({
  action: "create",
  name: "Daily Standup",
  schedule: "daily at 9am",
  prompt: "Summarize previous day and outline focus tasks.",
  timezone: "UTC",
})
// res.routine.schedule     → "0 9 * * *"
// res.routine.humanSchedule → "Daily at 09:00"

// Invalid shorthand rejected (cronjob.test.ts:63-69)
await tool.execute({ action: "create", name: "Bad Schedule", schedule: "every 500 hours and bananas", prompt: "test" })
// → { error: "Invalid cron schedule 'every 500 hours and bananas'…" }

// Pause / resume / run / remove by id (cronjob.test.ts:83-123)
await tool.execute({ action: "pause",  id: "routine-test-123" })  // success, "paused."
await tool.execute({ action: "resume", id: "routine-test-123" })  // success, "resumed. Next run at …"
await tool.execute({ action: "run",    id: "routine-test-123" })  // { success: true, runId: "run-abc-123" }
await tool.execute({ action: "remove", id: "routine-test-123" })  // success, "removed."
```

## ⚠️ Notes

1. **Org-wide visibility.** `list` returns every routine in the org (not only the calling agent's); agents can pause/resume/remove routines created by teammates or humans. There is no per-agent filter in the tool — scope is the org.
2. **Shorthand parsing is best effort.** Anything `normalizeCronExpression` cannot map to a valid 5-field expression is rejected with the "Invalid cron schedule" error; there is no silent fallback.
3. **No approval gate.** Modifying schedules is not `dangerous` in the current code, so routine changes are audited but not human-gated — the agent could, for example, create a routine that posts into any room of the org via `targetRoomId`.

Related docs: [./tool-system.md](./tool-system.md) · [./tool-tasks.md](./tool-tasks.md) · [../engine/coordinator.md](../engine/coordinator.md) · [../../cron-and-automations.md](../../../cron-and-automations.md) · [../../database/schema-routines-and-meetings.md](../../database/schema-routines-and-meetings.md)
