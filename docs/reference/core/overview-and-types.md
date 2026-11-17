# @sayabot/core: Package Overview & Shared Types

`packages/core` is the zero-infrastructure heart of Sayabot: pure TypeScript functions and Zod schemas that every other workspace imports to agree on one vocabulary — turn planning, capability flags, mention extraction, the ask/response protocol, cron parsing, cost math, and the realtime room-event wire format. It holds **no database client, no HTTP server, and no LLM calls**; its only runtime dependencies are `zod` and `fastest-levenshtein` (`packages/core/package.json:16-19`). Everything here is deliberately side-effect-free so the orchestrator, the Next.js web app, and the desktop companion can share one rulebook without sharing a runtime.

Source files: `packages/core/src/index.ts`, `packages/core/src/types.ts`, `packages/core/package.json` (tests: adjacent `*.test.ts` per module)

---

## 📦 Package entry points

`@sayabot/core` exposes **four** subpath exports (`packages/core/package.json:6-11`):

| Import path | Resolves to | Contents |
| :--- | :--- | :--- |
| `@sayabot/core` | `src/index.ts` | The 30-module public surface (below) |
| `@sayabot/core/mascot` | `src/mascot.ts` | Saya mascot geometry only (also in the root index). Lets the landing site and mobile import it without the rest of core — see [./mascot.md](./mascot.md) |
| `@sayabot/core/server` | `src/server/index.ts` | Server-only helpers: agent key derivation, SSRF checks, webhook payload signing — see [./platform-utilities.md](./platform-utilities.md) |
| `@sayabot/core/scanner` | `src/scanner/index.ts` | Local CLI usage scanner — see [./scanner.md](./scanner.md) |

The `scanner` and `server` subtrees are intentionally **not** re-exported from the root index, so apps that only need pure types never pull in `node:sqlite`, `fs`, or `node:crypto` transitively.

## 🧾 The root export surface (`index.ts`)

`packages/core/src/index.ts` is a flat list of 30 wildcard re-exports, in rough groups:

| Group | Modules |
| :--- | :--- |
| **Types & wire format** | `types`, `clients` |
| **Turn pipeline** | `mentions`, `turns`, `repetition`, `breakers`, `patch`, `fold-key`, `asks`, `thinking` |
| **Security** | `redact`, `hosts` |
| **Scheduling & money** | `schedule`, `cron`, `cost` |
| **Agent config** | `capabilities`, `commands`, `engine`, `computers`, `reply-style` |
| **Platform / companion** | `invite`, `bot-invite`, `pairing`, `remote`, `saya-ai`, `edition`, `cloud-handoff`, `workspace-copy`, `mac-apps` |
| **Brand** | `mascot` |

Because every module is `export *`-ed, the effective API is the union of all of them; the reference docs in this directory walk through each module individually.

### Module map

Every root export and where it is documented:

| Module | One-liner | Reference |
| :--- | :--- | :--- |
| `types` | Room/message/tool-call vocabulary and realtime + webhook Zod schemas | this page |
| `clients` | Desktop/mobile client capability metadata | [./invites-pairing-and-remote.md](./invites-pairing-and-remote.md) |
| `mentions` | `@handle` extraction and resolution to room agents | [./capabilities-and-mentions.md](./capabilities-and-mentions.md) |
| `turns` | Turn queue planning for mentions/debate/moderated modes | [./turns.md](./turns.md) |
| `repetition` | Levenshtein-based repeated-reply detection (uses `fastest-levenshtein`) | [./redact-and-breakers.md](./redact-and-breakers.md) |
| `breakers` | Pre-turn circuit breakers (session caps) | [./redact-and-breakers.md](./redact-and-breakers.md) |
| `patch` | Canvas patch planning from instructions | [./patch-and-fold-key.md](./patch-and-fold-key.md) |
| `fold-key` | Question fold keys for answer folding | [./patch-and-fold-key.md](./patch-and-fold-key.md) |
| `asks` | Structured bot→human questions and owner facts | [./asks.md](./asks.md) |
| `thinking` | Fold model reasoning into `<think>` blocks and split it back out for the chat | [./thinking.md](./thinking.md) |
| `redact` | Secret redaction before storage/model input | [./redact-and-breakers.md](./redact-and-breakers.md) |
| `hosts` | Secret broker host patterns | [./invites-pairing-and-remote.md](./invites-pairing-and-remote.md) |
| `commands` | Destructive shell-command classifier | [./commands.md](./commands.md) |
| `schedule` | Minutes-of-day and window helpers | [./cron-and-schedule.md](./cron-and-schedule.md) |
| `cron` | Cron parse/validate/next-run/humanize | [./cron-and-schedule.md](./cron-and-schedule.md) |
| `cost` | Token/cost math and formatters | [./cost-and-plan-limits.md](./cost-and-plan-limits.md) |
| `capabilities` | Agent capability flags, defaults, lenient parser | [./capabilities-and-mentions.md](./capabilities-and-mentions.md) |
| `engine` | Engine budget & plan limits for the agent loop | [./engine-and-computers.md](./engine-and-computers.md) |
| `computers` | Computer placement and desktop guidance | [./engine-and-computers.md](./engine-and-computers.md) |
| `reply-style` | Default vs conversational reply instruction | [./engine-and-computers.md](./engine-and-computers.md) |
| `invite` / `bot-invite` / `pairing` / `remote` | Human-invites, approval-gated bot invites, device pairing, remote desktop rules | [./invites-pairing-and-remote.md](./invites-pairing-and-remote.md) |
| `saya-ai` / `edition` / `cloud-handoff` / `workspace-copy` | Saya provider config, editions/plans, cloud handoff, workspace copy validation | [./platform-utilities.md](./platform-utilities.md) |
| `mascot` | Saya mascot geometry: shapes, tones, moods, path builders | [./mascot.md](./mascot.md) |

## 🧾 Key types in `types.ts`

`types.ts` is the shared vocabulary for rooms, messages, and tool calls. The const-array-plus-union pattern (`as const` array → derived union type) is used throughout so both the runtime list and the static type stay in sync:

| Const | Type | Values |
| :--- | :--- | :--- |
| `TURN_MODES` | `TurnMode` | `"mentions"`, `"debate"`, `"moderated"` |
| `ROOM_KINDS` | `RoomKind` | `"public"`, `"private"`, `"dm"` |
| `SENDER_TYPES` | `SenderType` | `"human"`, `"agent"`, `"system"` |
| `MESSAGE_STATUSES` | `MessageStatus` | `"streaming"`, `"complete"`, `"error"`, `"halted"` |
| `PROVIDERS` | `Provider` | 17 entries: `"openai"`, `"anthropic"`, `"google"`, `"groq"`, `"cerebras"`, `"openrouter"`, `"copilot"`, `"opencode"`, `"command-code"`, `"deepseek"`, `"minimax"`, `"grok"`, `"kimi"`, `"qwen"`, `"cursor"`, `"cloudflare"`, `"openai-compatible"` (`types.ts:15-33`) |
| `CANVAS_KINDS` | `CanvasKind` | `"markdown"`, `"code"`, `"svg"`, `"html"` |
| `TOOL_CALL_STATUSES` | `ToolCallStatus` | `"pending_approval"`, `"approved"`, `"rejected"`, `"running"`, `"done"`, `"error"` |

Two minimal row descriptors keep core decoupled from `@sayabot/db`:

```typescript
/** Minimal agent descriptor the coordinator needs; full rows live in @sayabot/db. */
export interface AgentRef {
  id: string
  handle: string
  kind: "llm" | "external"
}

/** A message as seen by the coordinator and context builder. */
export interface ChatMessage {
  id: string
  senderType: SenderType
  senderId: string | null
  senderName: string
  content: string
  createdAt: string
}
```

(`types.ts:49-64`)

### `roomEventSchema` — the realtime wire format

`roomEventSchema` (`types.ts:67-162`) is a Zod discriminated union of everything broadcast on the Realtime channel `room:{id}`. Each variant validates one event type:

| Event | Payload highlights |
| :--- | :--- |
| `message.delta` / `message.done` / `message.removed` | Streaming token deltas (`messageId`, `seq`, `delta`), terminal status, and removal of a replaced failed reply |
| `turn.state` | `sessionId`, `activeAgentId`, `queue` of agent ids, optional `threadRootId` |
| `tool.approval_requested` / `tool.approval_resolved` | The human-approval gate events: `toolCallId`, `agentId`, `toolName`, `args`, then `status: "approved" \| "rejected"` |
| `tool.started` / `tool.finished` / `tool.output` | Execution lifecycle: status `"done" \| "error" \| "rejected"`, `durationMs`, streamed output chunks |
| `agent.connected` | `agentId`, `handle`, optional `client` |
| `computer.state` | `agentId` + sandbox `status` |
| `room.notice` | `level: "info" \| "warn" \| "error"` notices |
| `run.step` / `run.status` / `run.plan` | Agent Loop V2 progress: step `kind` is `"model" \| "tool" \| "compaction" \| "recall" \| "plan" \| "subagent" \| "verify"`; run status includes `"thinking"`, `"tool"`, `"waiting:approval"`, `"waiting:answer"`, `"compacting"`; plan items carry `pending \| in_progress \| done \| blocked` |

The approval events here are the client side of the `dangerous: true` gate described in the top-level docs: the orchestrator records a `pending_approval` tool call and emits `tool.approval_requested`, and the room UI answers with `tool.approval_resolved`.

### Webhook & bot HTTP schemas

- **`webhookPayloadSchema`** (`types.ts:166-191`) — the payload delivered to external bots, a union of `message.created` (room/thread/message ids, sender, content, mentions array, and a `context_snapshot` of prior `{ sender, content }` pairs) and `task.assigned` (`task_id`, `task_number`, `title`, `description`, optional `reason`).
- **`botMessageBodySchema`** (`types.ts:194-198`) — what `POST /v1/rooms/:roomId/messages` accepts from external bots: `content` (1–100 000 chars), optional `thread_id` and `reply_to`.
- **`botStreamLineSchema`** (`types.ts:201-204`) — one NDJSON line on the streaming variant: `{ delta: string }` or `{ done: true }`.

## 🌐 Who depends on `@sayabot/core`

Every workspace lists `"@sayabot/core": "workspace:*"`. Import counts (files referencing `@sayabot/core`):

| Workspace | Files importing | Typical imports |
| :--- | :--- | :--- |
| `apps/web` | ~60 | `roomEventSchema`, `parseCapabilities`, `formatTokens`/`formatUsd`, `planAsk`, `resolveMentions` |
| `apps/orchestrator` | ~51 | `planMentionsTurn`/`planDebateTurns`, `parseCapabilities`, `computeCostUsd`/`pickModelPrice`, `getNextCronRun`, `isDestructiveCommand`, `redactSecrets` |
| `packages/llm` | 4 | provider registry: `readSayaAiConfig`/`resolveSayaModel` + `Provider` type from the root export; `assertSafeEgressHost` from the `/server` subpath (MCP clients) |
| `packages/db` | 3 | `AgentCapabilities`, `DEFAULT_CAPABILITIES` for the `agents`/`templates` schema columns and seeds |
| `apps/desktop` | 4 | scanner + pairing helpers |
| `apps/egress` | 2 | shared types |
| `apps/computerd` | 1 | shared types |
| `apps/mobile` | 0 | lists the dependency in `package.json` but does not import it yet |

The dependency direction is strictly downward: `core` imports nothing from `db`/`llm`/apps, while all of them import from `core`. This is what makes the coordinator's turn planner, the web inbox, and the desktop scanner able to run the *same* pure logic (see the module docs below).

## 🧪 Design constraints

Three properties explain most of the code shape you will see across `packages/core/src`:

- **Purity over I/O.** Modules never open sockets, read files, or touch the database. Where a flow needs the outside world (scanning disk stores, fetching provider plan usage, Keychain reads), the I/O lives in the caller (orchestrator, web app, Mac app) and core ships only the pure parse/plan/format half. `asks.ts` states this outright: *"Everything here is pure so the orchestrator (MCP) and the web app (inbox) share one rulebook."*
- **Lenient parsing with explicit fallbacks.** Untrusted JSON (DB columns, model tool args) is parsed defensively: `parseCapabilities` falls back per-key to defaults, `askItemsFromMetadata` drops malformed entries instead of throwing, `parseField` ignores out-of-range cron parts. Validators prefer *degrading* to a safe default over failing the whole request — with the notable exception of cron validation, where an invalid expression must surface as an error rather than silently never firing.
- **Const-array unions.** Every closed vocabulary (`TURN_MODES`, `SENDER_TYPES`, `PROVIDERS`, …) is declared once as a `readonly` string array with the type derived from it, so runtime iteration (e.g. building UI toggles) and static narrowing share a source of truth.

Test files sit adjacent to sources (`turns.test.ts`, `asks.test.ts`, …) and run under the workspace's Vitest setup (`pnpm --filter @sayabot/core test`); each module's reference page lists what its tests pin down.

## 🧭 Where to read next

Each module has its own reference page: turn planning in [./turns.md](./turns.md), capabilities & mentions in [./capabilities-and-mentions.md](./capabilities-and-mentions.md), the ask/response protocol in [./asks.md](./asks.md), destructive command detection in [./commands.md](./commands.md), cron & schedule math in [./cron-and-schedule.md](./cron-and-schedule.md), and token/cost math in [./cost-and-plan-limits.md](./cost-and-plan-limits.md).

Related docs: [./turns.md](./turns.md), [./capabilities-and-mentions.md](./capabilities-and-mentions.md), [./asks.md](./asks.md), [./commands.md](./commands.md), [./cron-and-schedule.md](./cron-and-schedule.md), [./cost-and-plan-limits.md](./cost-and-plan-limits.md), [./redact-and-breakers.md](./redact-and-breakers.md), [./scanner.md](./scanner.md), [./platform-utilities.md](./platform-utilities.md)
