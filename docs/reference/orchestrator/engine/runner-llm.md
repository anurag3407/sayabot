# LLM Runner

The LLM runner is the legacy (Engine v1) turn path plus the model-resolution layer every runner shares. `resolveAgentModel` / `resolveAgentCheapModel` pick a model for an agent — CLI runner, Saya AI alias, provider key, or the server's dev fallback — and `applyRoomModel` applies a per-room "only this chat" override. `runLlmTurn` executes a v1 turn: flat transcript prompt, single `streamAgentText` streaming call with a tool loop, streamed deltas, and the same finalize/persistence contract as Engine v2.

Source files: `apps/orchestrator/src/runner/llm.ts`, `apps/orchestrator/src/runner/stream-agent.ts`, `apps/orchestrator/src/runner/room-model.ts`, `apps/orchestrator/src/runner/context.ts`, `apps/orchestrator/src/runner/local-events.ts`

---

## 🧭 Model Resolution (`src/runner/llm.ts`)

### Types

```typescript
export interface ResolvedModel {
  model: LanguageModel
  provider: string
  modelName: string
  apiKey?: string
}
```

`RunLlmTurnArgs` / `TurnResult` (the coordinator↔engine contract) are defined here (`src/runner/llm.ts:28-52`) — see [engine-loop.md](./engine-loop.md) for the full listing.

### `resolveAgentModel(agent)` — primary model

Priority order (`src/runner/llm.ts:155-213`):

1. **CLI runner**: `agentCliRunner(agent)` (Claude Code / Codex / Cursor signed in on the host) → `createCliLanguageModel(cli, agent.handle)`, `provider: cli.app`, `modelName: cli.model ?? cli.app`, no API key.
2. **Saya AI** (`isSayaModel(agent.model)`): `sayaModelConfig(agent.model)` resolves the alias against the *server's env on every turn* (operators can swap the endpoint/model behind an alias). Missing config → throws `"@<handle> uses Saya AI, but this server has no Saya AI model set up. Ask the server admin to set SAYA_AI_BASE_URL, SAYA_AI_API_KEY and SAYA_AI_MODELS, or pick another model on the Agents page."`
3. **Provider key** (`agent.providerKeyId`): loads the `provider_keys` row (deleted → `"Provider key for @<handle> was deleted"`; missing model → `"@<handle> has no model configured"`), decrypts via `providerKeyToApiKey(key, getEnv().MESH_KEK)` and builds `createLanguageModel({ provider, apiKey, model: agent.model, baseUrl: key.baseUrl })`. This is the only branch that returns `apiKey` (used to build the per-run scrubber).
4. **Dev fallback**: `devModelConfig()` (`DEV_OPENAI_COMPAT_*` env) — `agent.model ?? dev.model`.
5. Otherwise throws `"@<handle> has no model yet. Pick one with \"Switch model\": your Mac's Claude Code or Codex through Sayabot for Mac (no key needed), or an API key."`

### `resolveAgentCheapModel(agent)` — background/critic/subagent model

Same ladder with cheaper defaults (`src/runner/llm.ts:81-138`):

1. CLI runner → `cheapCliModel(cli, customCheap)` (the app's fast model, no key).
2. Saya AI or **no key at all** → `sayaModelConfig(agent.model, process.env, "fast")`; `customCheap` (`params.cheapModel`) wins over the fast model name.
3. Provider key → `getCheapModelName(key.provider, customCheap)`:
   | Provider | Default cheap model |
   | :--- | :--- |
   | `anthropic` | `claude-haiku-5-5` |
   | `openai` | `gpt-4o-mini` |
   | `google` | `gemini-2.0-flash` |
   | `deepseek` | `deepseek-chat` |
   | `openrouter` | `openai/gpt-4o-mini` |
   | `groq` | `openai/gpt-oss-20b` |
   | default | `gpt-4o-mini` |
4. Dev fallback → cheap variant of the dev provider.
5. Last resort: `resolveAgentModel(agent)`.

### `resolveEffortLevel`

```typescript
export function resolveEffortLevel(params: {
  configuredEffort?: string
  hasTask: boolean
  isSubagent?: boolean
}): EffortLevel | undefined
```

`params.effort` values accepted by `isEffortLevel` pass through; `"auto"` (the default) maps to `"low"` for subagents, `"high"` when the turn is task-bound, `"low"` otherwise; unrecognized values yield `undefined` (provider default). The engine then clamps to the model's supported levels via `clampEffort`/`modelEffortLevels`.

### Helpers

- **`serverCanAnswer(agent)`** — true when the server itself can answer for a bot whose Mac is off: a provider key, a resolvable Saya model, a dev model, or a server-side CLI runner (checked with the runner param stripped).
- **`withoutRunner(params)`** — shallow copy with `params.runner` deleted ("the bot's params without its Mac").

---

## 🏠 Per-Room Model Override (`src/runner/room-model.ts`)

"Only this chat": a bot can answer in one room with a different model than its default. The override lives in `room_agents.model_override` and is applied per turn by `applyRoomModel(roomId, agent)` — called at the very top of `startAgentTurn` so it wins over the agent default.

- **`parseRoomModelOverride(value)`** — defensively parses `{ keyId?, model?, effort?, providerKeyId?, agentModel?, runner? }` (all strings optional; `runner` must be a plain object); returns `null` for garbage.
- **`withModelOverride(agent, override)`** — returns the agent with `providerKeyId`, `model` (`agentModel`), `params.runner` and `params.effort` replaced/cleared.
- **`stillValid(agent, override)`** — re-checks at *apply* time that the referenced resources still belong to the bot's workspace and owner: the `provider_keys` row must exist with the same `orgId`; any `runner.hostId` must exist in `desktop_hosts`, not be revoked, and belong to `agent.ownerUserId`. Stale overrides are ignored with a `[room-model] ignoring a stale model for @handle in room <id>` warning and the default model answers.

DB tables touched: `room_agents` (read `model_override`), `provider_keys`, `desktop_hosts` (validation).

---

## 📜 Prompt & Context Building (`src/runner/context.ts`)

Shared row types: `RoomRow`, `AgentRow`, `MessageRow`, `CanvasRow` (Drizzle `$inferSelect`), `RoomAgentRow = { agent, position }`, and `ContextMessage = { id, senderType, senderId, senderName, senderHandle, content, status, createdAt }`.

### Loaders

| Function | Behaviour |
| :--- | :--- |
| `loadRoomAgents(roomId)` | Joins `room_agents`×`agents`, ordered by position then handle. |
| `loadRoom(roomId)` / `loadMessage(messageId)` | Single-row fetches. |
| `loadConversation({ roomId, threadRootId, limit? })` | Default `limit: 40`. Threaded: root + replies ordered ascending (cap 200), trimmed to the most recent `limit` while always keeping the root. Unthreaded: last `limit` top-level messages (no `threadRootId`), oldest-first. Sender names resolved in bulk from `profiles` (humans) and `agents`. |
| `loadTaskContext(roomId)` | Up to 15 non-done tasks, newest activity first, rendered as `MESH-<number> [<kind>] <title> (<status>, <owner>) id=<id>` where owner is `held by @handle` / `held by a human` / `unclaimed` / `waiting for a human`. |
| `loadCanvasContext(roomId)` | All room canvases ordered by creation, each wrapped in `<canvas id="…" title="…" kind="…" language="…">` with text sliced to 6,000 chars and a shared 12,000-char budget. |
| `loadTaskBriefContext(taskId)` | `ACTIVE TASK BRIEF` block: status, description, blocker requirement, parent/sibling subtasks (≤ 8), last 10 task comments, and the completion rule (`call update_task with status="done"` and a valid outcome kind). |

### Renderers

- **`renderTranscript(messages)`** — `[Label](still streaming)?: content` lines joined by blank lines; per-message content cut at `MESSAGE_CHAR_LIMIT = 4_000`; oldest lines are dropped until the transcript fits `TRANSCRIPT_CHAR_LIMIT = 60_000`. Labels: `System`, `Name (@handle) (agent)`, `Name (human)`.
- **`buildSystemPrompt({ room, agent, role })`** (v1) — identity + shared-transcript rules + tool/mention guidance + markdown note; capability blocks for `computer` (persistent workspace, Secret Broker placeholders, HTTPS-only egress, `computer_publish`) and `cron` (Hermes `cronjob`); room directive; agent instructions; `replyStyleInstruction` when `params.replyStyle` is `"conversational"`; `debateRoleInstruction(role)`.
- **`buildUserPrompt({ transcript, canvases, tasks?, agent, extra? })`** — canvases, tasks, `Conversation so far:`, extra (task brief), `Write your next message as @<handle>.`
- **`toWebhookContext(messages)`** — last 20 messages as `{ sender, content ≤ 4000 }` for external webhook payloads.
- **`agentListPrompt(roomAgentRows)`** — `- <id>: @<handle> (<displayName>)` lines for the moderator prompt.

---

## 🌊 `streamAgentText` — the AI SDK streaming contract (`src/runner/stream-agent.ts`)

```typescript
export interface StreamAgentOptions {
  model: LanguageModel
  system: string
  prompt: string
  tools?: ToolSet
  abortSignal?: AbortSignal
  maxSteps?: number          // default 20
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  onDelta: (delta: string) => void | Promise<void>
}

export interface StreamAgentResult {
  text: string
  usage: LanguageModelUsage | null
  ttftMs: number | null
  latencyMs: number
  aborted: boolean
  error: string | null
  finishReason: string | null
  steps: number
}
```

"Single place that owns the AI SDK streaming contract. Text is forwarded as it arrives; tool execution happens inside streamText's step loop." Implementation notes:

- `streamText({ ..., stopWhen: stepCountIs(options.maxSteps ?? 20) })`; optional `temperature`/`topP`/`maxOutputTokens` only when defined.
- Iterates `result.fullStream`. `text-delta` is forwarded as answer text. `reasoning-delta` is folded into a `<think>` block via `appendThinking` (`@sayabot/core`) and forwarded through the same `onDelta`, so the chat can hide it behind a click. An open block is closed before the call returns. `ttftMs` is captured on the first forwarded chunk.
- Metrics come from `result.totalUsage` (sums every step of the tool loop — `usage` alone is only the last step), `result.finishReason`, and `result.steps.length`.
- **Never throws**: catch-path returns `{ usage: null, steps: 0, error }` with `aborted` true when the signal aborted or the error is an `AbortError` (in which case `error: null`).

---

## 🔁 `runLlmTurn` — the Engine v1 turn (`src/runner/llm.ts:224-473`)

v1 is a single streaming call with a flat prompt, unlike v2's structured multi-pass loop:

1. `resolveAgentModel(agent)`; `loadConversation` (default 40 messages) → `renderTranscript`; parallel `loadCanvasContext` / `loadTaskContext` / `loadTaskBriefContext` (task sessions only).
2. `buildSystemPrompt({ room, agent, role })` + `buildUserPrompt({ transcript, canvases, tasks, agent, extra: taskBrief })`.
3. Inserts `agent_runs` (`status: "running"`, no `engine` field — finalize writes `"v1"` or the param value) and the streaming `messages` row (metadata `{ agentName, agentHandle, role }` — no model/provider lines).
4. `registerRun(run.id, room.id)` — **without** `engine: "v2"`, which is exactly why mid-run steering never targets v1 runs (see [engine-interrupts-and-recovery.md](./engine-interrupts-and-recovery.md)).
5. `buildTools(...)` with the same runtime context; failure becomes a `Tools unavailable for this turn: …` warning rather than a hard error.
6. `streamAgentText` with `maxSteps` defaulting to `30` for task turns / `20` otherwise, and `temperature`/`topP`/`maxOutputTokens` from numeric params. `onDelta` batches: realtime `message.delta` flush every 40 ms (redacted), `messages` content persist every 1,000 ms.
7. `finalize()` mirrors v2: redacted content + status (`halted`/`error`/`complete`) on the message; `recordUsageEvent({ kind: "llm", ttftMs, latencyMs })` via `tokensFrom(usage)`; `agent_runs` final status/finishReason/steps/engine/tokens/cost; `tasks.turns_used`/`cost_usd` increments for task sessions; `message.done` broadcast; `deliverInboundReply` and `recordRoutineResult` side effects. No memory extraction, verification, transcript persistence, or harness metadata — those are v2-only.
8. Returns `TurnResult` without `errorKind`/`modelKey`/`leanLimit` (v1 has no lean retry).

DB tables touched: `agent_runs`, `messages`, `tasks`, `usage_events`. Realtime: `message.delta`, `message.done`.

---

## 🖥️ Local (Mac) Tool Events & Approvals (`src/runner/local-events.ts`)

Live tool activity for agents that run on their owner's Mac: the Mac reports what Claude Code / Codex is doing (keyed by the app's own tool-use id) and each step appears as the same tool cards a server run gets.

```typescript
export const MAC_APPROVAL_TIMEOUT_MS = 5 * 60_000
export type MacToolEvent =
  | { type: "started"; key: string; toolName: string; args: Record<string, unknown> }
  | { type: "finished"; key: string; ok: boolean; result?: string }

export interface MacMarker {
  key: string; jobId: string; hostId: string; hostName: string
  ownerId: string   // the Mac's owner: the only person who can answer its approvals
  agentId: string
}
```

- **`recordMacToolEvents(jobId, hostId, events)`** — validates the job via `runningJob()` (`local_runner_jobs` joined to `agents`/`desktop_hosts`; wrong host → 404 `LocalJobError`, non-running job → 409). Processes up to 50 events; keys validated against `^[\w.:-]{1,120}$`. A `started` event inserts a `tool_calls` card (`status: "running"`) with `_mac` marker embedded in args (idempotent per key via `findByKey`), broadcasts `tool.started`; a `finished` event closes the card (`done`/`error`, redacted result ≤ 4,000 chars, `resolvedAt`), broadcasts `tool.finished` with `durationMs`. Cards already `pending_approval`/`approved`/rejected are left alone.
- **`requestMacApproval(jobId, hostId, { key, toolName, args })`** — turns a card into `pending_approval` (creating it if needed; an already-pending card is returned as-is), broadcasts `tool.approval_requested`, sends `notifyHumansNeeded({ kind: "approval", detail: "<tool> on <host>" })` push, and registers `waitForApproval(toolCallId, MAC_APPROVAL_TIMEOUT_MS)` — rejection (including the 5-minute timeout) closes the card as `rejected` with error `"Refused, or nobody answered in time"` and broadcasts `tool.approval_resolved`.
- **`storedArgs(args)`** — what's stored and shown: keys starting with `_` dropped, ≤ 30 entries, strings redacted and cut at `MAX_ARG_TEXT = 2_000` chars, non-strings JSON-ified (re-parsed when still valid JSON).
- `LocalJobError extends Error` with an HTTP `status` (default 400), thrown as 404/409/500 by the internal job routes (`/internal/local-jobs/:jobId/events|approval`).

DB tables touched: `local_runner_jobs`, `tool_calls`, `agents`, `desktop_hosts` (reads); `tool_calls` writes. Realtime: `tool.started`, `tool.finished`, `tool.approval_requested`, `tool.approval_resolved`.

---

## 🧪 Tests

| Test file | Covers |
| :--- | :--- |
| `src/runner/stream-agent.test.ts` | `streamAgentText` metrics, abort handling, multi-step usage. |
| `src/runner/room-model.test.ts` | Override parsing, staleness checks, application. |
| `src/runner/local-events.test.ts` | Tool card lifecycle, approval timeout/rejection, arg scrubbing. |
| `src/runner/cli-agent.test.ts`, `src/runner/cli-model.test.ts`, `src/runner/default-mac.test.ts`, `src/runner/mac-plan.test.ts` | The CLI/local resolution branches called by the model ladders. |

`runner/llm.ts` and `runner/context.ts` have no dedicated test files; they are exercised via `engine/run.test.ts`, `engine/harness.test.ts`, and route-level tests.

---

## Related docs

- [Engine loop (the v2 turn that shares this resolution layer)](./engine-loop.md)
- [Coordinator (who calls runLlmTurn / startAgentTurn)](./coordinator.md)
- [Runner external & local (agentCliRunner, runLocalTurn, macPlan)](./runner-external-and-local.md)
- [Tool system (tool_calls cards and approvals)](../tools/tool-system.md)
