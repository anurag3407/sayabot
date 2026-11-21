# Turn Lifecycle

A "turn" is one coordinated burst of agent activity triggered by a single message. The Turn Coordinator converts each eligible trigger message into a deterministic queue of agent turns, executes them serially under a room-wide PostgreSQL advisory lock, and applies circuit breakers, interruption and repetition guards so multi-agent rooms can neither race nor loop forever.

Source files: `apps/orchestrator/src/coordinator/index.ts`, `apps/orchestrator/src/coordinator/interrupt.ts`, `packages/core/src/turns.ts`, `packages/core/src/mentions.ts`, `packages/core/src/breakers.ts`, `apps/orchestrator/src/db.ts`, `apps/orchestrator/src/engine/index.ts`, `apps/orchestrator/src/engine/run.ts`, `apps/orchestrator/src/tools/audited.ts`

---

## 🎬 Step 0 — Message ingestion

Everything starts when a message row exists:

- **Humans**: the web app inserts the row through Supabase (RLS applies), computes `mentions` with `extractHandles()` (`apps/web/src/lib/message-send.ts:59`), then calls the orchestrator's internal endpoint `POST /internal/room-message { roomId, messageId }` with the `x-internal-secret` header (`apps/web/src/lib/orchestrator.ts:34-36`). The endpoint re-validates that the message exists, matches the room, and is a `senderType: "human"` message before interrupting and enqueuing (`apps/orchestrator/src/http.ts:122-137`).
- **Bots over HTTP/MCP**: `POST /v1/rooms/:roomId/messages` authenticates an agent API key, checks `isAgentInRoom()`, and posts via `postAgentMessage()` (`apps/orchestrator/src/bot/routes.ts:72-104`).
- **Streaming bots**: `POST /v1/rooms/:roomId/messages/stream` accepts NDJSON/SSE bodies, inserts the `messages` row as `streaming`, broadcasts redacted `message.delta` events as chunks arrive, and persists the growing content to the database about once a second (`apps/orchestrator/src/bot/routes.ts:106-229`).
- **Inbound chat platforms** (Telegram/WhatsApp): `POST /internal/inbound` parses connector payloads into events (`apps/orchestrator/src/http.ts:139-158`).

The orchestrator's worker pulls the trigger message off the `room.message` pg-boss queue (`batchSize: 1, localConcurrency: 4`) and calls `processRoomMessage()` (`apps/orchestrator/src/jobs/index.ts:48-62`).

---

## 🧠 Step 1 — Who may trigger a session?

`processRoomMessage(roomId, messageId)` opens with the supersede logic, then decides eligibility (`apps/orchestrator/src/coordinator/index.ts:335-361`):

| Trigger             | Condition                                                                              | Effect                                                                                           |
| :------------------ | :------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| Human message       | `senderType === "human"`                                                               | First calls `interruptRoom()` — see [Interruption](#-interruption-steering-vs-abort)             |
| Agent-to-agent wake | `senderType === "agent"` **and** `metadata.agentTrigger === true` and room is not a DM | `collab/postAgentMessage` sets this flag so MCP/webhook bots posting later can pull teammates in |
| Task wake           | `senderType === "system"` and `metadata.taskWake` present                              | Queue is restricted to the task's `agentIds`, filtered to agents actually in the room            |

Any other agent/system message returns silently — an agent cannot start a session just by talking; it must mention a teammate outside its own turn.

The entire remaining coordination runs inside `withRoomLock(roomId, …)`, a session-level advisory lock on a dedicated pool client (`apps/orchestrator/src/db.ts:29-42`), so two orchestrator instances can never coordinate the same room at once.

---

## 📋 Step 2 — Planning the queue

A `turnSessions` row is created (`botTurnsUsed: 0, state: "active", queue: []`), and the room's agents are loaded. If there are none, the session completes immediately. Queue planning depends on the room (`room.turnMode` is one of `"mentions" | "debate" | "moderated"`, `packages/core/src/types.ts:3-4`):

| Situation               | Planner                                               | Result                                                                     |
| :---------------------- | :---------------------------------------------------- | :------------------------------------------------------------------------- |
| Task wake               | inline filter                                         | `responder` turns for allowed agents                                       |
| Agent-triggered         | `planMentionsTurn` with `excludeAgentIds: [senderId]` | mentioned teammates, minus the sender                                      |
| DM room                 | inline                                                | single turn for `agentDmAgentId`                                           |
| `turnMode: "mentions"`  | `planMentionsTurn`                                    | every tagged agent in mention order; `@all_bots` expands to the whole room |
| `turnMode: "debate"`    | `planDebateTurns`                                     | producer → critics → summarizer, ordered by `debateOrder`                  |
| `turnMode: "moderated"` | `planModeratedMentions`                               | explicit mentions win; otherwise the moderator LLM picks (below)           |

All planners live in `packages/core/src/turns.ts`:

```typescript
// turns.ts:22 — tagged agents in mention order; the hard cap is the breaker's job
export function planMentionsTurn(input: MentionsPlanInput): PlannedTurn[]

// turns.ts:36 — bots mentioned by another bot, never the sender itself
export function planBotFollowUps(input: FollowUpPlanInput): PlannedTurn[]

// turns.ts:66 — producer -> critic(s) -> summarizer; <3 participants skips the middle stage
export function planDebateTurns(input: DebatePlanInput): PlannedTurn[]

// turns.ts:92 — hallucinated moderator choices fall back to "human"
export function validateModeratorChoice(choice: string, roomAgents: AgentRef[])
```

Mention resolution itself is `resolveMentions()` in `packages/core/src/mentions.ts:27` — handles are matched case-insensitively, duplicates collapse, `@all_bots` expands in room order, and mentions inside fenced/inline code are ignored (`extractHandles` strips ` ``` ` blocks first, `mentions.ts:8-21`).

A `PlannedTurn` is `{ agentId, role, reason? }` where `TurnRole` is `"responder" | "producer" | "critic" | "summarizer" | "moderator"`. Debate roles get injected instructions via `debateRoleInstruction()` (producer pushes a concrete proposal, critic must disagree, summarizer reconciles without new arguments, `turns.ts:102-113`).

---

## 🔁 Step 3 — The coordination loop

The `while (true)` loop at `apps/orchestrator/src/coordinator/index.ts:428` repeats until the session ends. Each iteration:

1. **Re-read session state.** If a concurrent human message marked the session `superseded`, exit.
2. **Empty queue?** In `moderated` rooms with no explicit mentions, one moderator decision is requested instead of finishing. Otherwise the session is `complete`.
3. **Circuit breakers** (`breakerTrip`, `coordinator/index.ts:154-187` → `checkPreTurnBreakers` in `packages/core/src/breakers.ts:24`). Checked in priority order, and all counters are measured live:
   - `turn_cap` — `botTurnsUsed >= room.turnCap` (task wakes use the task's `budgetTurns`, default 12). A tripped task budget also marks the task `stuck` with `unblockNeeds: "human_answer"`.
   - `rpm_limit` — agent runs for this room in the last 60 seconds vs `room.rpmLimit` (nullable).
   - `daily_budget` — sum of `usageEvents.costUsd` since UTC midnight vs `room.dailyBudgetUsd` (nullable).
   - Any trip calls `halt()`: session → `halted`, queue cleared, a redacted system message with status `halted` is posted, and `turn.state` is broadcast.
4. **Moderator pick (moderated rooms).** `decideModerator()` calls the room's `moderatorAgentId` agent with `generateObject` (temperature 0, 60 s timeout) and the schema `{ next: string, also: string[], reason: string }`. A model that ignores the schema is retried as plain text with the JSON parsed out; if that fails too, the lead answers itself rather than halting. `validateLeadPlan` drops unknown ids and falls back to `"human"` when none are left, so a hallucinated agent can never wedge the room. The moderator's cost is recorded as a `usageEvents` row of kind `"moderator"` and an `agentRuns` row with `role: "moderator"`. Choosing `"human"` completes the session; a moderator error posts a system message and halts. In the UI this agent is the room's **lead agent**. It sees each agent's job (bio or instructions) and whether invited apps are open (`leadAgentListPrompt`). It may hand one message to up to three agents in order (schema `{ next, also, reason }`, checked by `validateLeadPlan`). When it hands the floor to other agents, a system message `@lead asked @a and @b to take this: …` that mentions them is posted (reason `lead_handoff`), so MCP-connected apps find it in their inbox.
5. **Run the turn.** Shift the next `PlannedTurn`, broadcast `turn.state` (so UIs show the active agent and remaining queue), then dispatch:
   - `kind === "external"` → `runExternalTurn()`: builds a `WebhookPayload` (event `message.created`, sender, mentions, 30-message `context_snapshot`) and enqueues a `webhook.deliver` job. Pull-based bots may return `deferred`, which **refunds the turn** (`botTurnsUsed -= 1`) so external polling does not consume the room budget (`coordinator/index.ts:578-583`).
   - `kind === "llm"` → `startAgentTurn()` (see [Agent execution](#-agent-execution-engine-router)).
6. **Post-run checks** (in order):
   - run threw → `halt` with redacted `agent_error`.
   - session state no longer `active` → exit with that state.
   - `result.aborted` → halt with "Generation stopped. Human input is required to continue." (`reason: "stopped"`).
   - `result.error` → halt with redacted agent error.
   - `result.deferred` → refund. If the app hasn't called in for 15 minutes (`agents.last_seen_at`), post "@handle's app isn't open right now…" (`reason: "agent_app_offline"`). A lead-routed deferred turn with nothing else queued completes the session; otherwise continue.
   - `result.timedOut` → post the quiet-bot notice ("@handle didn't answer within 60 seconds, so the turn moved on.") and continue to the next queued agent.
   - Success → `recentBotReplies()` (last 4 complete agent messages in the same thread scope) and `detectRepetition()`; a repetition trip halts with `REPETITION_HALT_MESSAGE` ("the agents started repeating each other", `packages/core/src/breakers.ts:49-50`).
7. **Follow-ups.** Only in `mentions` rooms: `planBotFollowUps()` appends agents the replying bot tagged (excluding itself) to the queue, so a bot can hand work to a teammate mid-session.

Finally the session is persisted with its terminal state and an empty queue, and a final `turn.state` event clears the UI.

### Session states

`turnSessions.state` ∈ `active | complete | halted | superseded`:

| State        | Set by                                                                          |
| :----------- | :------------------------------------------------------------------------------ |
| `active`     | session creation and after each turn                                            |
| `complete`   | queue drained, moderator chose human, no room agents                            |
| `halted`     | breaker trip, agent error, stop, repetition, moderator failure                  |
| `superseded` | a newer human message (`interruptRoom` flips all `active` sessions of the room) |

---

## 🛑 Interruption: steering vs abort

`interruptRoom(roomId, incoming)` (`apps/orchestrator/src/coordinator/interrupt.ts:15`) implements two behaviours:

1. **Steer (Engine v2 only).** If the incoming human message mentions an agent that has an active run with `engine === "v2"`, the message is queued as a `RunInterrupt` on that run (`addRunInterrupt`) and delivered at the next step boundary; the session is **not** superseded. All _other_ runs in the room are aborted (`apps/orchestrator/src/engine/interrupts.ts:23-60`).
2. **Abort otherwise.** All `active` sessions in the room become `superseded`, in-process `AbortController`s fire (`abortRoomRuns`, `apps/orchestrator/src/active-runs.ts:46-55`), and `pg_notify('mesh_room_interrupt', { roomId })` tells other orchestrator instances to do the same (`apps/orchestrator/src/db.ts:44-46`, consumed at `apps/orchestrator/src/index.ts:30-46`). A `/internal/runs/:runId/stop` endpoint and `mesh_stop_run` channel implement single-run stops.
3. **Side notes (`/btw`).** A human message with `metadata.command === "btw"` never interrupts: `processRoomMessage` calls `deliverSideNote` (`coordinator/interrupt.ts`), which queues it as a `RunInterrupt` on every active `v2` run in the room (`roomRuns`, `active-runs.ts`) and returns without starting a session. Agents that can't take notes mid-run read it in the transcript on their next turn, so a running `/goal` keeps going.

## 🎯 Goals (`/goal`)

A human message with `metadata.command === "goal"` (`goalOf`, `coordinator/goal.ts`) makes the session iterative. The queue is planned as usual (the DM bot, or the agents mentioned); then every round:

- The agent is run against the **goal message** itself (not its own last reply), with `goalDirective(goal, round)` appended to `room.systemDirective` for that turn, so the server engine and Mac/CLI runs (both read the directive) get: round N of up to `GOAL_MAX_ROUNDS = 20`, the goal, "plan, act, check, fix", and the two finish lines.
- After a successful reply, `goalOutcome(reply)` reads the last 400 characters: `GOAL COMPLETE` or `GOAL BLOCKED: …` ends that agent's goal; otherwise the agent is pushed back onto the queue. At 20 rounds a system message (`goal_paused`) says "paused the goal after 20 rounds. Send /goal again to keep going."
- **A goal that needs a person waits instead of dying.** `goalDirective` tells the agent to settle anything only a human can decide with `request_human_decision` — one question, 2–6 short options — and then end with `GOAL BLOCKED: <the question>`. On that outcome `markAskJoinsGoal` (`coordinator/index.ts`) finds the agent's newest open request created after the goal message and stamps it with `metadata.goal`; `goalQuestionOf` extracts the question and a system message with reason `goal_waiting` says what is being waited on. When the person answers (Inbox, room question card, or phone), the answer message is written with `metadata.command = "goal"` and `metadata.goal`, `goalOf` returns that carried goal, and the next turn runs as a goal round again rather than a plain reply. Round numbering restarts at 1 inside the same `GOAL_MAX_ROUNDS` cap.
- The turn-cap breaker is raised to `GOAL_MAX_ROUNDS × agents` for the session; the RPM and daily-budget breakers, the repetition guard, Stop and new human messages all still end it. Everything runs inside the same session under `withRoomLock`.

---

## 🤖 Agent execution (engine router)

`startAgentTurn()` (`apps/orchestrator/src/engine/index.ts:13-39`) routes one turn through runners in priority order:

1. **Room model override** — `applyRoomModel()` lets a chat pin a different model for this bot.
2. **Local Mac runner** — if the agent's params configure a paired Mac, `macPlan` decides `local` / `wait` / `server`.
3. **Default Mac** — `defaultMacRunner` when Sayabot for Mac is the configured default and the agent has no key.
4. **Plan admission** — `admitServerTurn(orgId)`; on Sayabot Cloud it atomically bumps the month's server-turn counter via `bump_server_turns()` and returns a friendly limit message when exhausted (`apps/orchestrator/src/plans.ts:35-59`). `planLimitTurn()` posts that message as a normal agent reply with `metadata.planLimit: true`.
5. **CLI runners** — Claude Code / Codex signed in on the server's computer.
6. **Engine selection** — `params.engine ?? "v2"`: `v1` → `runLlmTurn`, `v2` → `runFittingTheModel(args, runEngineTurn)`; anything else throws.

### Inside an Engine v2 turn (`runEngineTurn`)

`apps/orchestrator/src/engine/run.ts:79` does the bookkeeping that makes turns durable and observable:

- Inserts `agentRuns` (`status: "running", engine: "v2"`) and the agent's `messages` row (`status: "streaming"`, metadata with agent name/handle/role/model/provider), links them, and seeds `runTranscripts`.
- Registers the run in the in-process run registry and starts a **10-second heartbeat** updating `agentRuns.heartbeatAt`.
- Streams model output: deltas are scrubbed through the per-run scrubber (real provider key + pattern redaction) before `message.delta` broadcasts; the DB message is finalized as `complete`/`error`/`halted` with redacted content and a `harness` metadata blob (cache metrics, verification, compactions).
- Context is assembled from conversation, canvas state, task context and memory; tool specs come from `buildTools()` filtered by the agent's parsed capabilities, wrapped by `toAuditedTools()`.
- `maxSteps` defaults to 60, clamped to 1–200 (`run.ts:99`).

### Tool calls and approvals

Every tool call, dangerous or not, goes through `toAuditedTools()` (`apps/orchestrator/src/tools/audited.ts:84-223`):

1. Persist a `tool_calls` row — `pending_approval` when `dangerous` (boolean or `(args) => boolean`) says so, else `running`; args are redacted and truncated at 120 KB.
2. Broadcast `tool.started` (and `tool.approval_requested` + a push notification + inbound-chat notice when dangerous).
3. Dangerous calls wait on `waitForApproval()`: LISTEN/NOTIFY on `tool_call_resolved` is the fast path, a 2 s DB poll is the fallback, and the default timeout is **5 minutes — expiry counts as rejection** (`apps/orchestrator/src/tools/approvals.ts:6-8, 74-105`). An aborted run also resolves to `rejected`.
4. On approval, execute with the abort signal; results are redacted and stored (`done`), failures become `{ ok: false, error }` tool results instead of killing the stream (`error`). Every terminal state broadcasts `tool.finished`.

Decisions arrive via `POST /v1/tools/:toolCallId/approve { approved }` from the web app, which updates the row and notifies both the channel and any in-process waiter (`apps/orchestrator/src/http.ts:331-360`).

---

## 🩹 Recovery

Crashes and restarts are handled by `apps/orchestrator/src/engine/resume.ts`:

- `parkRun(runId, reason)` — parks a v2 run waiting on external input (`approval` | `ask_card` | `quota`) with `status: "waiting"` + a `run.status` broadcast (`waiting:approval` / `waiting:answer`).
- `recoverStaleRuns()` — on boot, v2 runs still `running` with a heartbeat older than 60 s (or null) are flipped to `waiting` (`waitingReason: "stale_heartbeat"`) and re-enqueued on the `run.resume` queue.
- `resumeRun()` flips them back to `running` and broadcasts `thinking`.

---

## 🧪 Test coverage

| Behaviour                                                                                          | Test file                                                    |
| :------------------------------------------------------------------------------------------------- | :----------------------------------------------------------- |
| Mention-order queues, `@all_bots`, empty queue without mentions                                    | `packages/core/src/turns.test.ts` (`planMentionsTurn`)       |
| Follow-ups never include the sender                                                                | `packages/core/src/turns.test.ts` (`planBotFollowUps`)       |
| Debate roles follow `debateOrder`; mentions narrow the cast; single-agent debate is one `producer` | `packages/core/src/turns.test.ts` (`planDebateTurns`)        |
| Unknown debate-order ids go last, room order preserved                                             | `packages/core/src/turns.test.ts` (`orderDebateAgents`)      |
| Moderated mentions; moderator choice validation → `"human"` on hallucination; role instructions    | `packages/core/src/turns.test.ts` (moderated mode block)     |
| Breaker priority, messages, nullable limits                                                        | `packages/core/src/breakers.test.ts`                         |
| Mention extraction, code-fence skipping, `@all_bots`                                               | `packages/core/src/mentions.test.ts`                         |
| Steering into v2 runs vs aborting others                                                           | `apps/orchestrator/src/engine/interrupts.test.ts`            |
| Stale-run rescue + resume                                                                          | `apps/orchestrator/src/engine/resume.test.ts`                |
| Approval flow end to end (UI)                                                                      | `e2e/approval.spec.ts`; turn queue UI in `e2e/turns.spec.ts` |

---

## Related docs

- [System Overview](./system-overview.md) — where the coordinator sits in the service map.
- [Realtime & Events](./realtime-and-events.md) — the `turn.state`, `message.delta`, `tool.*` events this loop emits.
- [Security Model](./security-model.md) — redaction scrubbing wrapped around every tool result and reply.
- [Auth & Authorization](./auth-and-authorization.md) — who is allowed to trigger `/internal/room-message` and bot message routes.
