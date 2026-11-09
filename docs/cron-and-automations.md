# Hermes-Class Cron & Automations Engine

Sayabot provides a state-of-the-art background automation system inspired by Nous Research's Hermes Agent, supercharged with an interactive **n8n-styled visual workflow canvas**.

Agents in Sayabot are not limited to reactive conversation. They can autonomously schedule recurring routines, monitor external APIs, summarize daily activities, and deliver rich reports directly into rooms or external messaging platforms.

---

## 🌟 Key Capabilities

- **Dual-Mode Scheduling**: Accepts both standard 5-field Unix cron syntax (`0 9 * * 1-5`) and human natural language shorthands (`daily at 9am`, `every 2h`, `in 30m`).
- **Interactive n8n Visual Canvas (`/[org]/cron`)**: Full visual workflow builder featuring Trigger Nodes, Agent Brain Nodes, Delivery Nodes, animated signal flows, parameter inspectors, and live test runs.
- **Agent Autonomous Self-Scheduling**: Agents can create, list, pause, update, and remove their own routines using the built-in `cronjob` tool.
- **Chat Slash Command (`/cron`)**: Create and manage scheduled jobs directly from the room composer with inline command syntax or quick modal dialogs.
- **Distributed & Fail-Safe Engine**: Backed by PostgreSQL advisory locks (`pg_try_advisory_lock`), per-job timeout limits, catch-up execution windows, and failure nudge alerts.

---

## ⏰ Syntax & Expression Support

The Sayabot cron engine (`packages/core/src/cron.ts`) parses both standard cron expressions and natural language formats into deterministic Unix timestamps.

### 1. Natural Language Shorthand

| Shorthand Example | Equivalent 5-Field Cron | Meaning |
| :--- | :--- | :--- |
| `hourly` | `0 * * * *` | At minute 0 of every hour |
| `daily` / `daily at 9am` | `0 9 * * *` | Every day at 09:00 UTC |
| `daily at 18:30` | `30 18 * * *` | Every day at 18:30 UTC |
| `weekly on monday` | `0 9 * * 1` | Every Monday at 09:00 UTC |
| `monthly` | `0 0 1 * *` | On day 1 of every month at 00:00 UTC |
| `every 15m` / `every 15 min` | `*/15 * * * *` | Every 15 minutes |
| `every 2h` / `every 2 hours` | `0 */2 * * *` | Every 2 hours |
| `in 30m` / `in 2 hours` | *One-shot ISO timestamp* | Runs once after the specified duration |

### 2. Standard 5-Field Cron Expressions

Standard 5-field syntax is fully supported:
```
┌───────────── Minute (0 - 59)
│ ┌─────────── Hour (0 - 23)
│ │ ┌───────── Day of Month (1 - 31)
│ │ │ ┌─────── Month (1 - 12)
│ │ │ │ ┌───── Day of Week (0 - 6, 0 = Sunday)
│ │ │ │ │
* * * * *
```

#### Common Patterns:
- `0 9 * * 1-5`: Monday through Friday at 09:00 UTC.
- `*/10 * * * *`: Every 10 minutes.
- `0 0 * * 0`: Every Sunday at midnight.
- `15 14 1 * *`: First day of each month at 14:15 UTC.

Sayabot provides pure helper functions in `@sayabot/core`:
```typescript
import { parseCronExpression, getNextCronRun, humanizeSchedule } from "@sayabot/core"

// Validate and parse expression
const schedule = parseCronExpression("0 9 * * 1-5")

// Calculate next run date
const nextDate = getNextCronRun("0 9 * * 1-5", new Date())

// Get human description for UI
const text = humanizeSchedule("0 9 * * 1-5") // "At 09:00, Monday through Friday"
```

---

## 🎨 The n8n-Style Visual Workflow Canvas

Navigate to `/[org]/cron` in your Sayabot web dashboard to access the visual workflow editor.

```
┌────────────────────────────────────────────────────────────────────────┐
│  ⚡ Sayabot Routines Canvas                              [+ New Routine] │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   ┌─────────────────┐        ┌─────────────────┐        ┌────────────┐  │
│   │ ⏱ Trigger Node  │───────>│ 🧠 Agent Node   │───────>│ 📬 Deliver │  │
│   │ Schedule / Cron │   ●    │ Pocket Saya     │   ●    │ Room / Web │  │
│   │ daily at 9am    │   │    │ "Summarize PRs" │   │    │ Slack #dev │  │
│   └─────────────────┘   │    └─────────────────┘   │    └────────────┘  │
│                         └─animated signal──────────┘                   │
│                                                                        │
│  [Test Run]  [Edit Parameters]  [View Runs]                            │
└────────────────────────────────────────────────────────────────────────┘
```

### 1. Canvas Node Architecture
Every routine on the canvas is composed of three interconnected nodes:
1. **Trigger Node**: Defines when the routine runs. Configurable as:
   - **Schedule**: Cron expression or natural language schedule.
   - **Interval**: Fixed timer (e.g. every 30 minutes).
   - **Webhook**: Inbound HTTP trigger URL.
2. **Agent Brain Node**: Defines the autonomous agent that handles the routine:
   - Selects target agent (e.g. `Pocket Saya`, `Research Agent`, `Security Bot`).
   - Prompt instructions with template variables (e.g. `Summarize today's commits`).
   - Model and reasoning temperature pins.
   - Enabled toolsets (Web Search, Linux Shell, Postgres Inspector).
3. **Delivery Node**: Defines where the completed report is dispatched:
   - **Room Origin**: Posts back into the designated Sayabot multiplayer room.
   - **External Webhooks**: Dispatches JSON payloads to custom endpoints.
   - **Connected Platforms**: Integrates with Slack, Discord, or Telegram gateways.

### 2. Animated Flow Signals
When viewing active routines, SVG connection curves display animated glowing pulses indicating the active pipeline state.

### 3. Parameter Inspector & Instant Test Run
Clicking any node opens the slide-out **Parameter Inspector**:
- Update schedules, agent prompts, and delivery channels without writing code.
- Hit **Run Test** to trigger an immediate out-of-band execution.
- View real-time status output and execution duration directly in the inspector.

---

## 🤖 Autonomous Agent Scheduling (`cronjob` Tool)

Sayabot gives agents native capability to self-schedule background routines during chat conversations. When an agent has the `cron` capability enabled, the `cronjob` tool is injected into its reasoning loop.

### Supported Actions

| Action | Description | Required Parameters |
| :--- | :--- | :--- |
| `create` | Creates a new routine | `name`, `schedule`, `prompt` |
| `list` | Lists all active routines for the current room/org | *(None)* |
| `update` | Modifies an existing routine's schedule or prompt | `routineId` |
| `pause` | Temporarily halts a routine | `routineId` |
| `resume` | Unpauses a suspended routine | `routineId` |
| `run` | Triggers an immediate execution of a routine | `routineId` |
| `remove` | Permanently deletes a routine | `routineId` |

### Conversation Example

> **User**: *"@saya, check our production API health endpoint every 2 hours and let us know if the latency is over 500ms."*
>
> **Agent Thought**: The user wants a recurring background health check. I should create a routine with the `cronjob` tool.
>
> **Tool Call**:
> ```json
> {
>   "action": "create",
>   "name": "Production API Health Check",
>   "schedule": "every 2h",
>   "prompt": "Fetch https://api.example.com/health using web_fetch, measure response time, and report in room if latency > 500ms or status is not 200."
> }
> ```
>
> **Agent Response**: *"I've created the routine 'Production API Health Check' scheduled for `every 2h`. You can review or edit it anytime on the [Visual Cron Canvas](/[org]/cron)."*

### Infinite Recursion Safeguards
To prevent recursive agent explosion, routines running in the background execute with `cron.allow_agent_scheduling: false` by default. Scheduled agent runs cannot spawn additional cron jobs unless explicitly permitted in org policy.

---

## 💬 Chat Slash Command (`/cron`)

Team members can quickly manage routines directly from the room chat input:

```
/cron [action] [options]
```

### Quick Commands

- `/cron`: Opens the interactive Routine Creator modal dialog.
- `/cron list`: Displays a list of all active routines in the current room with status indicators and next run dates.
- `/cron pause <routine-id>`: Temporarily suspends execution of a routine.
- `/cron run <routine-id>`: Dispatches an immediate test run.

---

## ⚙️ Distributed Background Scheduler Architecture

Sayabot's cron engine is built for production environments where multiple orchestrator instances run in parallel.

### 1. Database Schema
Routines and execution histories are tracked in PostgreSQL:

- **`routines`**: Stores routine metadata (`name`, `schedule`, `prompt`, `agent_id`, `room_id`, `org_id`, `status`, `next_run_at`, `failure_count`).
- **`routine_runs`**: Stores individual execution records (`routine_id`, `status`, `started_at`, `completed_at`, `duration_ms`, `error`, `output`).

### 2. Distributed Advisory Locking
The background scheduler loop in `apps/orchestrator/src/scheduler/routines.ts` ticks every 60 seconds:
```typescript
// Acquire distributed scheduler lock
const [lock] = await db.execute(sql`SELECT pg_try_advisory_lock(hashtext('sayabot_routines_scheduler')) as locked`)
if (!lock.locked) {
  // Another orchestrator worker is currently handling this tick
  return
}
try {
  // Query due routines where next_run_at <= now() and status = 'active'
  const dueRoutines = await fetchDueRoutines()
  for (const routine of dueRoutines) {
    await executeRoutine(routine)
  }
} finally {
  await db.execute(sql`SELECT pg_advisory_unlock(hashtext('sayabot_routines_scheduler'))`)
}
```

### 3. Fail-Safe Windows & Nudge Thresholds
- **Catch-up Window**: If an orchestrator was offline during a routine's scheduled slot, it checks if the missed run was within the last 15 minutes and executes it.
- **Failure Nudge Threshold**: If a routine encounters errors 3 consecutive times, Sayabot automatically flags the routine as `stuck` and posts an urgent blocker notification into the origin room for human intervention.
