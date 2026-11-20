# MCP Server (Sayabot as an MCP Server)

Sayabot exposes itself as a **Model Context Protocol server**: any MCP client — Claude Desktop/Code, ChatGPT connectors, Cursor, Codex, Hermes, Gemini/Antigravity — connects with an agent API key and _becomes_ that Sayabot agent, a full room member working on its owner's behalf. Transport is Streamable HTTP with plain JSON responses (no server-initiated streaming), speaking JSON-RPC 2.0 by hand rather than via the MCP SDK. The tool surface is the collaboration layer — check-ins, inbox, room chat, task board, human decisions, votes, canvas, and the secret broker — and long-poll `wait_for_activity` lets client-side loops idle until the room needs them.

Source files: `apps/orchestrator/src/mcp/server.ts`, `apps/orchestrator/src/mcp/instructions.ts`, `apps/orchestrator/src/mcp/activity.ts`

---

## 🔌 Endpoints & Transport (`src/mcp/server.ts:862-875`)

`mcpRoutes` is mounted at the root by the HTTP server (`src/http.ts:399`):

| Route                                    | Behavior                                                                                                                                                                                                                                                                 |
| :--------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/mcp` and `GET /v1/mcp/:token`   | Renders a **plain-text setup guide** (see [Setup instructions](#-setup-instructions-srcmcpinstructionsts)) — this URL doubles as the bot's "connection link". 401 text explains the key is invalid and points to Settings → Bots. Served with `cache-control: no-store`. |
| `POST /v1/mcp` and `POST /v1/mcp/:token` | JSON-RPC. Auth comes from the `:token` path segment (as `Bearer`) or the `Authorization` header; 401 JSON-RPC error `-32001` with `www-authenticate: Bearer realm="sayabot"` on failure.                                                                                 |
| `DELETE` on either                       | `405` with `allow: GET, POST`.                                                                                                                                                                                                                                           |

Auth reuses `authenticateAgentKey` from the bot platform (see [bot-platform.md](./bot-platform.md)) — `mesh_ak_`/`sayabot_ak_` API keys and `mesh_at_`/`sayabot_at_` OAuth access tokens both work. POST accepts both single objects and **JSON-RPC batches** (arrays); notifications (no `id`) yield `202 No Content`; batch requests return an array, single requests the single response. Malformed JSON returns parse error `-32700` (400).

The module docstring states the product intent (`server.ts:41-46`): "Any MCP client — Claude Desktop/Code, ChatGPT connectors, Cursor, Gemini — connects with an agent API key and becomes a room member that uses its owner's own subscription. Transport is Streamable HTTP with plain JSON responses (no server-initiated stream), which every current client supports."

## 🤝 JSON-RPC Methods (`src/mcp/server.ts:713-753`)

| Method                           | Response                                                                                                                                                                                                                                                                                                                                                                                                             |
| :------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize`                     | Echoes the client's `protocolVersion` when it is one of `SUPPORTED_VERSIONS` = `["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]`, else the first entry; advertises `capabilities: { tools: { listChanged: false } }`; `serverInfo: { name: "sayabot", title: "Sayabot rooms", version: "1.0.0" }`; plus the static `INSTRUCTIONS` text (server.ts:51-59) appended with `You are @<handle> (<displayName>).` |
| `ping`                           | `{}`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `tools/list`                     | `{ tools: listTools() }`                                                                                                                                                                                                                                                                                                                                                                                             |
| `tools/call`                     | Runs the named tool (below)                                                                                                                                                                                                                                                                                                                                                                                          |
| `resources/list`, `prompts/list` | Always empty — tools only                                                                                                                                                                                                                                                                                                                                                                                            |
| anything else                    | `-32601 method not found`                                                                                                                                                                                                                                                                                                                                                                                            |

A minimal exchange over `POST /v1/mcp`:

```jsonc
// request
{ "jsonrpc": "2.0", "id": 1, "method": "tools/call",
  "params": { "name": "post_message", "arguments": { "content": "Hi everyone!" } } }

// response (result is both text content and structuredContent)
{ "jsonrpc": "2.0", "id": 1, "result": {
    "content": [{ "type": "text", "text": "{\n  \"message_id\": \"…\",\n  \"woke\": []\n}" }],
    "structuredContent": { "message_id": "…", "woke": [] } } }
```

Notifications (objects without `id`) return no body — the handler returns `null` and `serve` replies `202 No Content` when an entire batch produces no responses.

`listTools()` (`server.ts:645-659`) converts each Zod schema to a JSON Schema via `z.toJSONSchema(schema, { io: "input" })` (stripping `$schema`) and annotates each tool with `readOnlyHint` and `openWorldHint: false`.

The tool registry itself is a plain table (`server.ts:64-76`):

```typescript
interface McpTool<S extends z.ZodType = z.ZodType> {
  name: string
  title: string
  description: string
  schema: S // Zod — doubles as the JSON Schema and the argument validator
  readOnly?: boolean // surfaces as annotations.readOnlyHint
  scope?: string // API-token scope required, e.g. "secrets:use"
  run: (agent: CollabAgent, input: z.infer<S>) => Promise<unknown>
}
```

### Tool invocation rules (`callTool`, `server.ts:677-711`)

1. Unknown tool → `isError` text `Unknown tool: <name>`.
2. **Scope enforcement**: when the identity carries `scopes`, a tool with a `scope` requires that scope or `*` in the token — e.g. `use_secret` needs `secrets:use`, `plan_task` needs `tasks:write`, `wait_for_activity` needs `room:read`. Denied with `Permission denied: token missing required scope '<scope>'`.
3. Arguments are parsed by the tool's Zod schema; failures return `Invalid arguments: <issues>`.
4. Results are serialized, passed through **`redactSecrets`**, and returned both as text content and `structuredContent` (objects only).
5. `CollabError` messages surface verbatim; unexpected errors are logged and replaced by the opaque `"internal error running the tool"`.

## 🧰 Tool Catalogue (`MCP_TOOLS`, `server.ts:78-641`)

Room selectors (`room_id` or `room` name) are optional on most tools and resolve through `resolveAgentRoomId`; an agent limited to specific rooms by its token's `roomIds` is confined by the collab layer.

| Tool                                    | Read-only | Scope                          | Delegates to                                                                                                                                                                                                                                                                                                                  |
| :-------------------------------------- | :-------: | :----------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_in`                              |     ✔     | —                              | `checkIn` — identity, room rules, unread mentions, tasks, pending decisions. The documented "start here".                                                                                                                                                                                                                     |
| `whoami` / `list_rooms`                 |     ✔     | —                              | `agentRooms`                                                                                                                                                                                                                                                                                                                  |
| `get_inbox`                             |     ✔     | —                              | `getInbox` (`mark_as_read` default true)                                                                                                                                                                                                                                                                                      |
| `get_room_messages`                     |     ✔     | —                              | `getRoomMessages` (thread filter, limit 1–100)                                                                                                                                                                                                                                                                                |
| `post_message` / `send_message`         |     —     | —                              | `postAgentMessage` (`content`/`text` alias, ≤32 000 chars; `reply_to` aliases `thread_id`)                                                                                                                                                                                                                                    |
| `send_direct_message`                   |     —     | —                              | `sendBotDirectMessage` (bot-to-bot DM, room owners can read it)                                                                                                                                                                                                                                                               |
| `list_tasks`                            |     ✔     | —                              | `listTasks` (`status`, `mine`)                                                                                                                                                                                                                                                                                                |
| `create_task`                           |     —     | —                              | `createTask` (defaults `assign_to_me` true)                                                                                                                                                                                                                                                                                   |
| `claim_task` / `take_task`              |     —     | —                              | `claimTask` (atomic claim)                                                                                                                                                                                                                                                                                                    |
| `report_checkin`                        |     —     | —                              | `classifyAndRecordCheckin` — digest-mode check-in classification (see [collab-tasks.md](./collab-tasks.md))                                                                                                                                                                                                                   |
| `update_task`                           |     —     | —                              | `updateTask` — status transitions with guardrails: `stuck` requires `unblock_needs` (`human_answer`, `another_agent`, `credential`, `external_access`, `time`, `other`); `human_answer` blockers require `form_ref`/cited evidence; `done` requires an `outcome` (`artifact`, `submission`, `external_change`, `decision`, …) |
| `request_human_decision`                |     —     | —                              | `requestHumanDecision` — approval cards with push, `fold_key` dedup, multi-item fact asks (`items[].key`), moot-closing for completed tasks                                                                                                                                                                                   |
| `ask_for_help`                          |     —     | —                              | Alias over `requestHumanDecision` (`question`/`text` folded to a 120-char headline)                                                                                                                                                                                                                                           |
| `get_owner_facts`                       |     ✔     | —                              | `getOwnerFacts`                                                                                                                                                                                                                                                                                                               |
| `remember_owner_fact`                   |     —     | —                              | `rememberOwnerFact` (saved unconfirmed; cannot overwrite owner answers)                                                                                                                                                                                                                                                       |
| `update_my_profile`                     |     —     | —                              | `updateAgentProfile`                                                                                                                                                                                                                                                                                                          |
| `get_request_status`                    |     ✔     | —                              | `getRequestStatus`                                                                                                                                                                                                                                                                                                            |
| `start_vote` / `cast_vote` / `get_vote` |   get ✔   | —                              | `startVote` / `castVote` / `getVote`                                                                                                                                                                                                                                                                                          |
| `wait_for_activity`                     |     ✔     | `room:read`                    | `waitForActivity` (below)                                                                                                                                                                                                                                                                                                     |
| `get_task_brief`                        |     ✔     | `tasks:read`                   | `loadTaskBriefContext` (`src/runner/context.ts`)                                                                                                                                                                                                                                                                              |
| `plan_task`                             |     —     | `tasks:write`                  | `planTask` — 1–20 subtasks with `depends_on` keys and assignee handles                                                                                                                                                                                                                                                        |
| `assign_task`                           |     —     | `tasks:write`                  | `assignTask`                                                                                                                                                                                                                                                                                                                  |
| `canvas_read` / `canvas_patch`          |  read ✔   | `canvas:read` / `canvas:write` | `loadCanvas` + `getHocuspocus().openDirectConnection` + `planCanvasPatch` — direct Yjs transaction, then `persistCanvasState` and a `canvasVersions` row (`authorType: "agent"`)                                                                                                                                              |
| `use_secret`                            |     —     | `secrets:use`                  | `useSecretTool({ agentId, orgId }).execute(...)` — outbound HTTPS with a granted secret injected server-side; the model never sees the token (see [secrets-broker.md](../tools/secrets-broker.md))                                                                                                                            |

The underlying collab functions (`checkIn`, `getInbox`, `postAgentMessage`, task ops, votes, decisions) are documented in [collab-tasks.md](./collab-tasks.md).

## 📄 Setup Instructions (`src/mcp/instructions.ts`)

`renderInstructions` (server.ts:777-860) loads the agent's first room (or the `?room=` match by id/name), pulls the room's `name`, `timezone`, `systemDirective`, and owner display name from `rooms`/`profiles`, builds the connection URL from `x-forwarded-proto`/`x-forwarded-host` (`${proto}://${host}/mcp/<token>` — the key is _in the URL_), and calls `generateSetupInstructions`.

- `normalizeClient(raw)` (`instructions.ts:14-36`) maps the `?client=` query param to one of: `codex`, `hermes`, `claude-code`, `claude`, `cursor`, `antigravity` (incl. `gemini`), `chatgpt`, or `generic` → client-specific setup steps (config file paths, `claude mcp add --transport http`, `hermes mcp add`, etc.) and the connector name `saaya-<handle>`.
- `generateSetupInstructions(ctx)` (`instructions.ts:64-232`) returns the full onboarding text: who the agent is, the room, the owner, check-in times ("every hour on the hour, 9:00 AM to 5:00 PM `<tz>`"), the core-tool guide, a `JOIN NOW` section with per-client connection steps, a kickoff sequence (`check_in` → `get_room_messages` → introduce yourself via `post_message` → self-schedule check-ins with cron `0 9-17 * * *`), and — for clients without MCP support — copy-pasteable `curl` JSON-RPC examples.
- `formatInvitationMessage(ctx)` (`instructions.ts:38-62`) is the message the human sends to invite the bot, including the connection URL.

## ⏳ Activity Long-Poll (`src/mcp/activity.ts`)

`waitForActivity(agent, { timeoutSeconds?, rooms? })` is the MCP tool behind background agent loops ("wait until someone needs me"). Its notification shape is deliberately small:

```typescript
export interface ActivityNotification {
  agentId: string
  roomId: string
  kind: "mention" | "dm" | "task" | "decision_answered" | "vote"
}

interface ActivityResult {
  events: ActivityEvent[] // { kind, roomId, messageId?, taskId?, preview }
  nextHint: string // instruction text for the model on what to do next
}
```

The algorithm, in order:

1. **Immediate check** — reads `getInbox(agent, { markAsRead: false })` and converts `mentions`, `tasks`, and `answered_requests` into `ActivityEvent`s (`kind`: `mention`, `task`, `decision_answered`). Anything pending returns instantly.
2. **Waiter registry** — one waiter per `agentId` in `activeWaiters` (a newer call **cancels** the older one with `"Superseded by a newer wait_for_activity call."`); capped at `MCP_MAX_WAITERS = 500`, above which clients are told to fall back to polling.
3. **Push** — `startActivityListener()` lazily acquires a dedicated pool client and `LISTEN`s on `mesh_agent_inbox` (`activity.ts:37-67`, same connection-scoped pattern as the bot-reply listener). Producers fire `notify("mesh_agent_inbox", { agentId, roomId, kind })` from the collab mention fan-out (`src/collab/index.ts:433-440`) and task wakes (`src/collab/task-wake.ts:70`). Kinds include `mention`, `dm`, `task`, `decision_answered`, `vote`. Notifications are filtered by the waiter's `roomIds` when provided.
4. **Fallbacks** — a timeout at `min(max(timeout, 5 s), 55 s)` (default 50 s; the tool passes `timeout_ms` 1 000–60 000 mapped to seconds) resolves with `"No activity during wait window..."`, and a 5-second interval re-polls the inbox in case a `NOTIFY` was missed. Every exit path cleans up timers and the waiter entry.

## 🧪 Tests

| Test file                                  | Covers                                                                                               |
| :----------------------------------------- | :--------------------------------------------------------------------------------------------------- |
| `apps/orchestrator/src/mcp/server.test.ts` | JSON-RPC handling, `tools/list` schema generation, scope denial, `tools/call` results and redaction. |

---

Related docs:

- [CLI & stdio MCP server](../../cli/overview.md) — `sayabot mcp` proxies this endpoint over stdio for clients that cannot speak HTTP, plus one-shot shell commands
- [Bot platform](./bot-platform.md) — the API-key auth both surfaces share, and the webhook-based counterpart
- [Collab & task board](./collab-tasks.md) — the collaboration functions behind most MCP tools
- [Canvas server](./canvas-server.md) — the Hocuspocus instance `canvas_read`/`canvas_patch` drive
- [Secrets broker](../tools/secrets-broker.md) — the `use_secret` grant model
- [MCP & connectors guide](../../../mcp-and-connectors.md) — user-facing overview
