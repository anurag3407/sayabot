# Engine Interrupts & Recovery

Engine v2 turns survive process crashes, absorb human steering mid-run, and recover from provider failures. This page covers the four mechanisms: mid-run steering interrupts (`interrupts.ts` + the `active-runs` registry), stale-run recovery and parking (`recovery.ts` / `resume.ts`), provider-error classification and retry (`recovery.ts`), and the deterministic between-step controller (`loop-control.ts`) that injects steering, reminders, doom-loop nudges, and output caps.

Source files: `apps/orchestrator/src/engine/interrupts.ts`, `apps/orchestrator/src/engine/recovery.ts`, `apps/orchestrator/src/engine/resume.ts`, `apps/orchestrator/src/engine/loop-control.ts`, `apps/orchestrator/src/active-runs.ts` (registry)

---

## 🎯 Mid-Run Steering (`src/engine/interrupts.ts`)

Engine v2 lets a human message fold into a running agent instead of killing it:

```typescript
export interface MessageInterruptCheck {
  id: string
  content: string
  senderType: string
  mentions?: string[]
}

export interface InterruptResult {
  steered: boolean
  steeredRunIds: string[]
  abortedCount: number
}

export function handleMidRunInterrupt(
  roomId: string,
  incoming: MessageInterruptCheck,
): InterruptResult
```

Semantics (`src/engine/interrupts.ts:23-68`):

- Non-human messages never steer: `{ steered: false, steeredRunIds: [], abortedCount: 0 }`.
- For each agent handle in `incoming.mentions`, `findActiveRunForAgent(roomId, agentId)` looks up the in-memory run registry; only runs with `engine === "v2"` qualify.
- Each qualifying run gets `{ messageId, content }` appended to `pendingInterrupts` via `addRunInterrupt(runId, interrupt)` — delivered at the run's next step boundary (`prepareStep`) or after the final step (late steering).
- If at least one run was steered, **only the other runs in the room are aborted** (`abortRoomRuns(roomId, steeredId)` for each steered run id); the steered runs keep going, and the session is _not_ marked superseded (see `interruptRoom` in [coordinator.md](./coordinator.md)).
- If no active v2 agent was mentioned, all room runs are aborted (`abortRoomRuns(roomId)`) and the caller supersedes active sessions.

The consumed interrupts become `<steering>` user messages built by `steeringMessage()` (below).

### Delivery points in the engine loop

| Point                                    | Mechanism                                                                                                                                                           |
| :--------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Before each step                         | `prepareStep` passes `consumeRunInterrupts(run.id)` into `decidePrepareStep`, which appends the steering message                                                    |
| After a pass's final step                | `consumeRunInterrupts(run.id)` — a non-empty result pushes `steeringMessage(late)` into `runMessages` and continues the pass loop (see `src/engine/run.ts:772-783`) |
| Budget exhausted with pending interrupts | post-loop check sets `error = "A new instruction arrived after the execution budget was exhausted. A follow-up turn is required."`                                  |

---

## 🛟 Stale-Run Recovery & Parking (`src/engine/resume.ts`)

```typescript
export interface StaleRecoveryResult {
  recoveredCount: number
  runIds: string[]
}
```

- **`parkRun(runId, reason: "approval" | "ask_card" | "quota")`** — parks a running v2 turn that is waiting on external input (approvals over 30 s, ask cards): sets `agent_runs.status = "waiting"`, `waitingReason = reason`, refreshes `heartbeatAt`, and broadcasts `run.status` with `"waiting:approval"` (approval) or `"waiting:answer"` (ask_card).
- **`resumeRun(runId): Promise<boolean>`** — flips a `waiting` **or** `running` run back to `status: "running"`, clears `waitingReason`, refreshes the heartbeat, and broadcasts `run.status` `"thinking"`. Returns false when the run doesn't exist or is in any other state. Invoked by the pg-boss `run.resume` queue worker (`src/jobs/index.ts:88-101`), which retries up to 3 times.
- **`recoverStaleRuns(olderThanSeconds = 60): Promise<StaleRecoveryResult>`** — boot-time rescue. Selects `agent_runs` rows where `engine = "v2"`, `status = "running"`, and `heartbeatAt` is older than the cutoff (or null — i.e. the orchestrator died mid-turn; the 10-second heartbeat in `runEngineTurn` is what stops). Each stale run is set to `waiting` with `waitingReason: "stale_heartbeat"` and enqueued via `enqueueRunResume(r.id, "stale_recovery")`. Called dynamically from the boot sequence in `src/index.ts:49-54`; the result logs `[recovery] rescued N stale runs`.

DB tables touched: `agent_runs` (status, `waiting_reason`, `heartbeat_at` reads/writes). Realtime events: `run.status` (`waiting:approval` / `waiting:answer` / `thinking`).

`buildToolIdempotencyKey(runId, stepIdx, callIdx)` returns `` `${runId}:${stepIdx}:${callIdx}` `` — a deterministic key so a resumed run doesn't re-execute an already-applied tool call.

---

## 🚦 Error Classification & Retry (`src/engine/recovery.ts`)

### `classifyEngineError(error): EngineErrorClassification`

```typescript
export type EngineErrorCategory =
  | "rate_limit"
  | "server_error"
  | "network"
  | "context_overflow"
  | "quota_exhausted"
  | "auth_error"
  | "refusal"
  | "request_too_large"
  | "no_model"
  | "unknown"

export interface EngineErrorClassification {
  category: EngineErrorCategory
  retryable: boolean
  retryAfterMs?: number
  resetTime?: Date
  message: string
  limitTokens?: number // request_too_large: provider-reported token limit
}
```

Substring-based classification, evaluated in priority order (`src/engine/recovery.ts:32-164`):

| Priority | Matches (lowercased)                                                                                           | Category            | Retryable | Extra                                                                                               |
| :------- | :------------------------------------------------------------------------------------------------------------- | :------------------ | :-------- | :-------------------------------------------------------------------------------------------------- |
| 0        | `has no model yet`, `has no model configured`, `no saya ai model set up`                                       | `no_model`          | no        | raw message                                                                                         |
| 1        | `request too large`, `reduce your message size`, `request entity too large`, `tokens per minute` + `requested` | `request_too_large` | no        | `limitTokens` from `limit 12345` regex; message `"Request is larger than this model's plan allows"` |
| 2        | `context_length_exceeded`, `maximum context length`, `prompt is too long`, `too many tokens`                   | `context_overflow`  | no        |                                                                                                     |
| 3        | `invalid api key`, `authentication error`, `unauthorized`, `401`, `forbidden`, `403`                           | `auth_error`        | no        |                                                                                                     |
| 4        | `insufficient_quota`, `quota exceeded`, `credit balance is too low`, `billing account`                         | `quota_exhausted`   | no        |                                                                                                     |
| 5        | `rate_limit`, `rate limit`, `429`                                                                              | `rate_limit`        | yes       | `retryAfterMs` parsed from `retry after N s`                                                        |
| 6        | `500`, `502`, `503`, `504`, `internal server error`, `overloaded`, `bad gateway`                               | `server_error`      | yes       |                                                                                                     |
| 7        | `econnreset`, `econnrefused`, `etimedout`, `fetch failed`, `network error`                                     | `network`           | yes       |                                                                                                     |
| 8        | `refused to respond`, `content policy`, `safety check`                                                         | `refusal`           | no        |                                                                                                     |
| 9        | anything else                                                                                                  | `unknown`           | no        | raw message                                                                                         |

### `executeWithRecovery(fn, options?)`

Generic retry wrapper for retryable categories (rate limit, 5xx, network): defaults `maxRetries: 5`, `baseDelayMs: 1000`, `maxDelayMs: 30_000`. Delay = provider `retryAfterMs` when present, else exponential backoff `min(maxDelayMs, baseDelayMs * 2^(attempt-1))` plus up to 30% jitter. `onRetry(attempt, delayMs, classification)` observes retries; `sleepFn` is injectable for tests. Non-retryable classifications or exhausted retries rethrow the original error.

### Human-facing error text

- **`scrubProviderIds(text)`** removes provider account identifiers (`org_…`, `organization_…`, `proj_…`, `project_…`, `user_…`, `acct_…` followed by 8+ alphanumerics) → `[account]`.
- **`userFacingError(classified, raw, modelName?)`** turns a classification into plain words with a next step, e.g.:
  - `request_too_large`: ``This chat is too big for `model` on its current plan (N tokens at a time), even shortened. Switch this bot to a bigger model, or start a new chat.``
  - `context_overflow`: `This chat is longer than <model> can read. Start a new chat, or switch to a model with a bigger context.`
  - `auth_error`: points at Settings → API keys; `quota_exhausted`: add credit or switch model; `rate_limit` / `server_error` / `network`: try again shortly; `refusal`: `The model declined this request.`
  - `no_model` and `unknown`: `scrubProviderIds(raw).slice(0, 600)`.

In `runEngineTurn`, the classification's `category` becomes `TurnResult.errorKind` (the coordinator and `runFittingTheModel` key retry decisions off it) and the friendly text becomes the stored/streamed error.

---

## 🎛️ Between-Step Control (`src/engine/loop-control.ts`)

Pure, deterministic helpers driving what happens between model steps ("Everything in here is deterministic so it can be unit tested without a model or database").

### Reminders and steering messages

```typescript
export function systemReminder(text: string): UserModelMessage
// { role: "user", content: "<system-reminder>\n…\n</system-reminder>" }

export function steeringMessage(interrupts: RunInterrupt[]): UserModelMessage
// "<steering>\nA human in the room sent this while you were working. Take it into
//  account from this step on; it overrides earlier instructions where they
//  conflict.\n\n<joined contents>\n</steering>"
```

### Doom-loop and plan detection

- **`detectRepeatedToolCalls(steps, threshold = REPEAT_THRESHOLD (3))`** — a doom loop is the same set of tool calls (each `toolName:JSON(input)` signature, sorted, joined) in each of the last N steps. Returns the repeated tool name or `null`.
- **`hasPlan(steps)`** — true once `update_plan` has been called in this run.
- **`estimateTokens(messages)`** — re-exports `estimateMessageTokens` from budget.ts.

### `decidePrepareStep(input)` — the step preprocessor

```typescript
export interface PrepareStepInput {
  messages: ModelMessage[]
  steps: StepLike[]
  stepNumber: number
  maxSteps: number
  interrupts: RunInterrupt[]
  contextBudgetTokens: number
  planToolAvailable: boolean
  sentReminders: Set<string> // each reminder fires at most once (except doom-loop)
}

export interface PrepareStepDecision {
  messages?: ModelMessage[] // present only when something changed
  reminders: string[]
  steered: boolean
  elidedCount: number
}
```

In order (`src/engine/loop-control.ts:104-163`):

1. **Steering**: non-empty `interrupts` appends `steeringMessage(interrupts)`; `steered: true`.
2. **Pre-elision**: when `estimateTokens(messages) > contextBudgetTokens * 0.7`, `elideOldToolResults(messages, 6)` runs early to keep transcript growth under control (the heavier `summarizeForBudget` ladder runs afterwards in `run.ts`).
3. **Doom loop**: `detectRepeatedToolCalls` → reminder `"You have called <tool> with identical input 3 times in a row and got the same result. Stop repeating it. Change your approach, read the error carefully, or explain to the room what is blocking you."` (fires every time it matches — not gated by `sentReminders`).
4. **Plan nudge**: when `planToolAvailable` and `stepNumber > 8` and no `update_plan` yet and not already sent → one-time `"This task is taking many steps. Call update_plan with a short checklist of the remaining work so progress stays visible to the room."` (marks `sentReminders` with `"plan"`).
5. **Step-budget warning**: when `remaining = maxSteps - stepNumber` is in `[0, 2]` and not already sent → one-time `"You have N step(s) left in this turn. Wrap up now: finish the current action, then write a final reply summarising what was done and what remains."` (marks `"budget"`).
6. Any reminders are joined into a single `systemReminder` appended to the messages; `messages` is returned only when something changed.

### Output capping

- **`MODEL_OUTPUT_CHAR_LIMIT = 40_000`**, `STRING_FIELD_LIMIT = 16_000`.
- **`foldOutput(value, limit)`** — bounds a single string while preserving diagnostics: within a 35% diagnostic budget it collects error/traceback-like lines (`DIAGNOSTIC_LINE` regex: `error`, `exception`, `traceback`, `panic`, `fatal`, `failed`, `assertionerror`, `expected`, `received`, and stack-frame lines) plus one line of surrounding context each; then keeps 65% head / remainder tail of ordinary text around a `[... characters truncated from N-character output ...]` marker.
- **`truncateDeep(value, limit, depth)`** — deep-truncates objects/arrays (arrays capped at 200 items with a `[... N more items truncated ...]` suffix, nesting depth 6 → `"[nested output omitted]"`, strings via `foldOutput`).
- **`capToolOutputForModel(value, limit = MODEL_OUTPUT_CHAR_LIMIT)`** — bounds what a tool result can cost in context: serialized size ≤ limit passes through; otherwise deep-truncate and re-check; otherwise binary-search the largest `foldOutput` preview that fits inside `{ truncated: true, originalChars, preview }`. Unserializable values become `{ error: "Tool output was not serializable" }`. `limit < 128` throws.

### Misc

- **`needsStepSeparator(previous, next)`** — true when `previous` doesn't end in whitespace and `next` doesn't start with whitespace; the engine inserts a `\n\n` so consecutive steps' prose doesn't concatenate (`"Let me check"` + `"Found it."` → two paragraphs).

---

## 🧪 Tests

| Test file                         | Covers                                                                                                                                     |
| :-------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/interrupts.test.ts`   | `handleMidRunInterrupt` steering vs. abort routing against the run registry.                                                               |
| `src/engine/recovery.test.ts`     | `classifyEngineError` categories/`limitTokens` parsing, retry backoff, `userFacingError` text.                                             |
| `src/engine/resume.test.ts`       | Resume/recovery DB flows (mocked `getDb`).                                                                                                 |
| `src/engine/loop-control.test.ts` | `decidePrepareStep` reminder/steering/elision decisions, doom-loop detection, `capToolOutputForModel`, `foldOutput`, `needsStepSeparator`. |

---

## Related docs

- [Engine loop (where these helpers are called)](./engine-loop.md)
- [Coordinator (interruptRoom entry, supersede flow)](./coordinator.md)
- [Budget & compaction (elideOldToolResults, budgets)](./engine-budget-and-compaction.md)
- [Service overview (LISTEN channels that fan out interrupts)](./service-overview.md)
- [Tool system (approval gates that park runs)](../tools/tool-system.md)
