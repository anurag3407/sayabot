# Realtime & Events

Sayabot has two realtime layers: **Supabase Realtime broadcast** for discrete room events (message deltas, tool cards, turn state) and a **Hocuspocus Yjs WebSocket** mounted inside the orchestrator for collaborative canvas documents. Both share one event vocabulary — the `RoomEvent` discriminated union in `@sayabot/core` — so orchestrator, web and mobile render the same stream.

Source files: `packages/core/src/types.ts`, `apps/orchestrator/src/realtime.ts`, `apps/web/src/components/room/use-room-realtime.ts`, `apps/orchestrator/src/canvas/server.ts`, `apps/orchestrator/src/engine/run.ts`, `apps/web/src/components/use-workspace-activity.ts`

---

## 📡 Layer 1 — Supabase Realtime broadcast

The orchestrator is **stateless with respect to sockets**: it never holds a websocket per room. Instead `broadcast(roomId, event)` POSTs to Supabase's Realtime HTTP API (`apps/orchestrator/src/realtime.ts:8-39`):

```typescript
const response = await fetch(`${base}/realtime/v1/api/broadcast`, {
  method: "POST",
  headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${...}` },
  body: JSON.stringify({
    messages: [{ topic: `room:${roomId}`, event: event.type, payload: event, private: true }],
  }),
})
```

Clients subscribe from the browser with the anon key on a channel named `room:${roomId}` — **private**, matching the `private: true` flag the orchestrator broadcasts with — and register per-event handlers (`apps/web/src/components/room/use-room-realtime.ts:257-262`):

```typescript
const channel = supabase.channel(`room:${args.roomId}`, {
  config: { private: true, presence: { key: args.user.id } },
})
  .on("broadcast", { event: "message.delta" }, ({ payload }) => { ... })
  .on("broadcast", { event: "tool.approval_requested" }, ({ payload }) => { ... })
  .on("presence", { event: "sync" }, applyPresence)
  .subscribe()
```

Before subscribing, the hook copies the session's access token onto the realtime socket with `supabase.realtime.setAuth(token)` (`use-room-realtime.ts:252-256`); Realtime's private-channel authorization checks that JWT against the room's RLS policies. The same channel also carries `postgres_changes` subscriptions for `messages`, `tool_calls`, `canvases` and `meetings` filtered by `room_id`, so inserts and edits that bypass broadcast (web actions, retries) still reach the UI.

Failures to broadcast are logged, never thrown — a Realtime outage degrades UI liveness but never breaks a turn (the database remains the source of truth; the room view re-syncs from queries).

---

## 📨 The `RoomEvent` catalogue

`roomEventSchema` (`packages/core/src/types.ts:67-162`) is a `z.discriminatedUnion("type")`. Every payload that crosses the wire conforms to it:

| Event | Emitted by | Payload (essentials) | Web handler does |
| :--- | :--- | :--- | :--- |
| `message.delta` | engine v2 flush loop, streaming bot route | `messageId`, `seq: int`, `delta` | appends text to the streaming bubble, ordered by `seq` (`deltaSeq` map) |
| `message.done` | coordinator, engine finalize, plan-limit turn | `messageId`, `status: streaming\|complete\|error\|halted` | finalizes the bubble; `halted` renders the halt banner |
| `message.removed` | retry reconciliation | `messageId` | drops a replaced reply from view |
| `turn.state` | coordinator after each transition | `sessionId`, `activeAgentId (nullable)`, `queue: string[]` (agent ids), `threadRootId?` | shows whose turn it is and the pending queue |
| `tool.started` | audited tool wrapper | `toolCallId`, `agentId`, `toolName`, redacted `args` | renders the tool card |
| `tool.approval_requested` | audited tool wrapper (dangerous only) | same shape | renders the approval card (Allow / Don't allow) |
| `tool.approval_resolved` | audited wrapper / approve endpoint | `toolCallId`, `status: approved\|rejected` | closes the card with the outcome |
| `tool.finished` | audited wrapper | `toolCallId`, `status: done\|error\|rejected`, `durationMs` | shows result state + duration |
| `tool.output` | streaming tools (shell, browser) | `toolCallId`, `seq`, `chunk` | streams stdout/stderr into the card |
| `agent.connected` | local Mac agents | `agentId`, `handle`, `client?` | marks the agent online |
| `computer.state` | computerd bridging | `agentId`, `status` | updates the computer pill |
| `room.notice` | system notices | `level: info\|warn\|error`, `message` | inline notice |
| `run.step` | engine v2 step loop | `runId`, `step`, `kind: model\|tool\|compaction\|recall\|plan\|subagent\|verify`, `label` | live "doing X" label under the agent reply |
| `run.status` | engine/park/resume | `runId`, `status: thinking\|tool\|waiting:approval\|waiting:answer\|compacting` | spinner state |
| `run.plan` | `update_plan` tool | `runId`, `items: { id, title, status: pending\|in_progress\|done\|blocked, note? }[]` | renders the live plan checklist |

Emission is serialized per turn: the engine chains `send()` through a promise (`chain = chain.then(...)`) so `message.delta` sequence numbers and step events arrive in order even when awaits race (`apps/orchestrator/src/engine/run.ts:184-192`).

### Presence and typing

The same Supabase channel carries **presence** (`presence: { key: user.id }`), with join/sync/leave handlers powering the avatar row and typing indicators in the room header (`use-room-realtime.ts:515-517`). This is channel presence, not the database.

### Workspace-wide activity

A second hook, `apps/web/src/components/use-workspace-activity.ts`, subscribes once per user/org on a `workspace-activity:${userId}:${orgSlug}` channel with **unfiltered** `postgres_changes` on `messages` (INSERT/UPDATE), `tool_calls` and `tasks` — every room, not one. It drives notifications, inbox badges and workspace-switcher state, and falls back to polling plus a window-focus refresh when the socket is not subscribed.

### Where each event is emitted

For grepping purposes, the emission sites:

| Event | Emission site |
| :--- | :--- |
| `message.delta`, `message.done` (engine path) | `apps/orchestrator/src/engine/run.ts` (`send`/`flush` and `finalize`) |
| `message.delta`, `message.done` (external bot stream) | `apps/orchestrator/src/bot/routes.ts:141-219` |
| `message.done` (system/quiet-bot/halt messages) | `apps/orchestrator/src/coordinator/index.ts:91-139` |
| `turn.state` | `apps/orchestrator/src/coordinator/index.ts:75-89` (`broadcastTurn`) |
| `tool.*` (all five) | `apps/orchestrator/src/tools/audited.ts:109-217` |
| `run.step`, `run.status`, `run.plan` | `apps/orchestrator/src/engine/run.ts` step loop; `parkRun`/`resumeRun` in `apps/orchestrator/src/engine/resume.ts` |
| `message.done` (plan limit) | `apps/orchestrator/src/plans.ts:101-103` |
| `computer.state`, `agent.connected` | computerd/bridge events surfaced through orchestrator |

All of them funnel through the single `broadcast()` function; nothing else posts to the Realtime API.

---

## 🔢 Ordering, de-duplication and catch-up

Because Supabase broadcast is fire-and-forget, the client treats the database as truth and events as hints:

- **Delta ordering**: every `message.delta` carries an incrementing `seq`; the room hook keeps a `deltaSeq` map per message and ignores deltas that arrive late or replayed (`use-room-realtime.ts:95`, merge logic below it). The engine guarantees monotonic `seq` per message by chaining sends through a promise queue.
- **Streaming reconciliation**: the streaming message row is persisted (roughly every second for bot streams, at finalize for engine turns), so a client that missed the whole stream renders the final content from its initial server-rendered query; `message.done` then swaps the bubble to its authoritative state.
- **Optimistic sends**: the composer inserts a local bubble and reconciles it with the inserted row via `metadata.clientId` de-duplication at insert time (`apps/web/src/lib/message-send.ts:38-47`) — a retry cannot create a duplicate human message.
- **Turn state**: `turn.state` is always a full snapshot (`activeAgentId`, complete `queue`), never a delta, so a client joining mid-session renders the correct state from one event plus the initial session row.
- **History paging**: `MESSAGE_PAGE_SIZE = 80` with 50-message "load older" pages (`use-room-realtime.ts:27-29`); realtime events only ever touch recent messages.

### When delivery fails

| Problem | Behaviour |
| :--- | :--- |
| Broadcast POST fails | Logged (`[realtime] broadcast … failed`), never thrown; the turn continues (`realtime.ts:30-38`) |
| Channel drops | Supabase JS auto-reconnects and re-subscribes; the hook tracks `connection: connecting \| connected \| error \| offline` for the room banner |
| Long stream, tab hidden | Deltas accumulate in DB; on refocus the client refetches instead of replaying events |
| Two orchestrators broadcast concurrently | Only one coordinates a room at a time (advisory lock), so interleaving is bounded to system messages and run events from parked runs |

---

## 📱 Mobile realtime

`apps/mobile/src/hooks/useRoomRealtime.ts` follows the same model with a smaller surface:

- **Broadcast channel** `room:${roomId}` with `config: { private: true }` (no presence tracking). Handlers: `message.delta` (appends to or creates the streaming bubble), `message.done`, `turn.state` (keeps only `activeAgentId`), `tool.output` (appends to a 150-line terminal drawer buffer), `run.step` (shows the label as agent status), `run.status` (maps `thinking`/`tool`/`compacting` to status text, clears on anything else), and `tool.approval_requested` / `tool.approval_resolved` (drives the approval sheet).
- **A second channel** `room-rows:${roomId}:${random}` subscribes to `postgres_changes` INSERT/UPDATE on `messages` filtered by `room_id`. INSERTs are skipped for thread replies, de-duplicated, and used to replace the optimistic `local-` bubble the composer created; UPDATEs merge the new row in.
- **History**: `loadHistory()` reads the last 80 root messages from Supabase directly under the user's RLS before subscribing.
- **Sending**: `sendMessage()` POSTs to the web app's `/api/messages` (`apps/web/src/app/api/messages/route.ts`) with the Supabase access token as a bearer token; that route accepts bearer or cookie auth, re-runs `insertHumanMessage` + `queueRoomMessage`. **Approvals**: `resolveApproval()` POSTs to `/api/v1/tools/:toolCallId/approve` through the same bearer path.

The web `/api/messages` route returns `{ messageId }` so the optimistic `local-` id can be swapped in place — the same reconciliation the `metadata.clientId` mechanism provides on web.

## 🧵 Layer 2 — Canvas Yjs WebSocket (`/collab`)

The Hocuspocus server runs **inside the orchestrator process**, not as a separate service. The HTTP server in `apps/orchestrator/src/index.ts` handles `upgrade` events on pathname `/collab` only (others are destroyed) and hands the socket to `hocuspocus.handleConnection()` with a 2 MB `maxPayload` (`apps/orchestrator/src/index.ts:70-100`).

`createHocuspocus()` (`apps/orchestrator/src/canvas/server.ts:64-107`) configures:

| Hook | Behaviour |
| :--- | :--- |
| `onAuthenticate` | The client must pass a Supabase access token; `supabase.auth.getUser(token)` validates it, the canvas row must exist, and `canUserReadRoom(userId, canvas.roomId)` must pass. Returns `CollabContext { userId, canvasId, roomId }`. |
| `onLoadDocument` | Hydrates the Y.Doc from `canvases.ydocState` (binary `Y.applyUpdate`), falling back to `snapshotText` inserted at `getText("content")`. |
| `onStoreDocument` | Persists both representations: `ydocState = Y.encodeStateAsUpdate(doc)` and `snapshotText = doc.getText("content").toString()` (debounced 2 s, max 10 s). |

Access revocation is proactive: because auth checks run only at socket authentication, a 30-second sweep (`revokeStaleCanvasConnections`, `ACCESS_SWEEP_MS = 30_000`) re-runs `canUserReadRoom` for every live connection and closes lost ones with `4403 Forbidden`. A failed lookup **keeps** the connection so a database blip never throws everyone off the canvas (`canvas/server.ts:25-52`).

Web clients connect to `NEXT_PUBLIC_COLLAB_URL` (prod: `wss://<domain>/collab`, proxied by nginx to orchestrator :4000). Agent canvas tools (`canvas_read`, `canvas_write`, `canvas_patch`) go through the same server, applying diffs into the shared Y.Doc so humans see agent edits character-by-character.

---

## 🌊 Inbound streaming: bots that stream their reply

The reverse direction is also streamed: an external bot can POST to `POST /v1/rooms/:roomId/messages/stream` with `application/x-ndjson` or `text/event-stream` and write its reply incrementally. `BotStreamParser` (`apps/orchestrator/src/bot/stream-parser.ts`) buffers partial lines, parses `data:` prefixed lines for SSE (`[DONE]` ends the stream), and treats each NDJSON line as a delta. The route inserts the `messages` row as `streaming` up front, broadcasts redacted `message.delta` events as chunks arrive, persists the growing content to the database about once a second, then finalizes with `message.done` and calls `notifyBotReply()` so a coordinator waiting on this agent wakes immediately (`apps/orchestrator/src/bot/routes.ts:106-229`).

The orchestrator's only *outbound* SSE endpoint is `/internal/egress/stream` (`apps/orchestrator/src/internal/routes.ts:299-341`): an internal-secret-authenticated stream that fans out PostgreSQL `vault_changed` notifications via an in-memory `vaultEmitter` (`vault-events.ts`) fed by the central control connection, forwarding cache invalidations to every connected egress instance without consuming dedicated database pool connections, with 15-second heartbeats.

## 🔔 Beyond the room: LISTEN/NOTIFY control channels

Not everything is user-facing. Three PostgreSQL channels coordinate orchestrator internals (see [Turn Lifecycle](./turn-lifecycle.md)):

| Channel | Producer | Consumer | Effect |
| :--- | :--- | :--- | :--- |
| `mesh_room_interrupt` | `interruptRoom()` via `notify()` | control connection in `apps/orchestrator/src/index.ts` | `abortRoomRuns(roomId)` across instances |
| `mesh_stop_run` | `POST /internal/runs/:runId/stop` | same | `abortRun(runId)` |
| `tool_call_resolved` | web approve endpoint / `notify_tool_resolution()` RPC | approvals listener | wakes `waitForApproval()` promise instantly |

Each has a polling or DB-recovery fallback (2 s poll for approvals, stale-run rescue on boot), so a dropped listener connection never wedges a run. The `notify()` helper JSON-encodes payloads and uses `pg_notify` on the shared pool (`apps/orchestrator/src/db.ts:44-46`); note that this is fine for control events precisely because they are advisory — the authoritative state change (session row, tool_calls row) is written first, and the notification only accelerates noticing it.

Push notifications (VAPID web-push to phones/browsers) are the third delivery path for things that must reach a human when no tab is open — approval requests (`notifyHumansNeeded({ kind: "approval" })`) and ask cards.

---

## 🧪 What the tests cover

- Event schema invariants (all 15 event types parse; `run.plan` item statuses; message status enum) — exercised through `packages/core/src/types.ts` consumers; core union types are re-validated wherever payloads cross module boundaries.
- Delta ordering + redaction flush behaviour — `apps/orchestrator/src/engine/run.test.ts` and `sdk-contract.test.ts` (engine↔AI-SDK contract).
- Canvas access revocation sweep — covered by orchestrator canvas server tests; `canUserReadRoom` semantics (member, public-room org member, or denied) are pinned by `apps/orchestrator` authz usage and `e2e/api-guard.spec.ts`.
- Approval event flow end to end — `e2e/approval.spec.ts`.

---

## Related docs

- [Turn Lifecycle](./turn-lifecycle.md) — the producer of most of these events.
- [Auth & Authorization](./auth-and-authorization.md) — how broadcast keys, Supabase tokens and `canUserReadRoom` gate the channels.
- [System Overview](./system-overview.md) — the two layers on the service map.
- [Security Model](./security-model.md) — why every delta and tool arg is redacted before broadcast.
