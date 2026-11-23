# Rooms, Memberships & Messages (Server Actions)

Rooms are the shared spaces where humans and agents converse; messages are the durable record of those turns. This page documents the room CRUD actions, per-user chat state (read markers, pins, mutes), message sending with its offline outbox, retry/stop controls, tool-call approvals, and the shared routine that answers agent questions as a human.

Source files: `apps/web/src/lib/actions/rooms.ts`, `apps/web/src/lib/actions/room-state.ts`, `apps/web/src/lib/actions/messages.ts`, `apps/web/src/lib/message-send.ts`, `apps/web/src/lib/message-map.ts`, `apps/web/src/lib/outbox.ts`, `apps/web/src/lib/answer-requests.ts`, `apps/web/src/components/room-form.tsx`

---

## 🏗️ Room CRUD (`rooms.ts`)

### `createRoom(_prev, formData)`

Org-member action (any role) — `getOrgAccess` is enough; you do not need to be an admin to create a room (`rooms.ts:26`). Behavior:

- `kind` is one of `public | private | dm` (default `private`), name is capped at 60 chars (`rooms.ts:30`).
- `dm` requires a `memberId` that is not the caller; the room is auto-named `"<your name> / <their name>"` from profiles (`rooms.ts:41`).
- For non-DM rooms with a `memberId`, the member must belong to the org.
- The room's timezone defaults to the creator's profile preference and falls back to `UTC` if `Intl.DateTimeFormat` rejects it (`rooms.ts:66`).
- Insert `rooms` (with `turn_mode: "mentions"`, `created_by`), then `room_members` (creator as `admin`, plus the optional member), a `room_schedules` row for non-DM rooms, and a `room_reads` row per member (`rooms.ts:89`).
- If member insertion fails, the room is deleted and the action fails — no orphan rooms (`rooms.ts:94`).
- Audit `room.created`, `revalidateOrg`, then `redirect("/<orgSlug>/r/<roomId>")` (`rooms.ts:116`; `redirect` throws, so there is no return value).

### `updateRoomSettings(_prev, formData)`

Room-admin gated (`adminRoomAccess`). Validates `turnMode` enum (`mentions | debate | moderated`), `turnCap` 1–10, optional `rpmLimit` 1–1000 and `dailyBudgetUsd` 0–1,000,000, and `systemDirective` up to 4,000 chars. `name` is optional here: a form without a `name` field keeps the current name, since the settings page edits it with `updateRoomBasics`. When `name` is sent it must be 1–60 characters. A `moderatorAgentId` (the **lead agent**) must already be in the room and be `kind: "llm"`; an invited app is refused with "The lead agent must be one made in Sayabot…" (`rooms.ts:156`–163). `turnMode: "moderated"` without a lead fails with "Choose a lead agent…" (`rooms.ts:167`). `debateOrder` (JSON text) is filtered down to agents present in the room. Writes to `rooms`, audits `room.settings_changed`, revalidates.

### `updateRoomBasics(_prev, formData)`

Room-admin gated (`rooms.ts:209`). Updates `name` (1–60) and, for non-DM rooms when a `kind` field is posted, visibility (`public | private`; a room can't become or stop being a DM). Audits `room.settings_changed` with the changed fields and revalidates. Used by the **Room** section of [room settings](../pages/room-settings-ui.md).

### `deleteRoomAction(input)`

Room-admin plain-object action: deletes the `rooms` row (cascade handles children), audits `room.deleted` with the room name (`rooms.ts:364`).

---

## 👥 Members and agents in rooms (`rooms.ts`)

- `addRoomMember(_prev, formData)` (`rooms.ts:196`) — room-admin. The person must be an org member and not already in the room; inserted as `role: "member"` with a matching `room_reads` upsert. Audit `room.member_added`.
- `removeRoomMember(_prev, formData)` (`rooms.ts:240`) — room-admin. Refuses to remove the last room admin (counts `room_members` with `role: "admin"`), deletes the member and their `room_reads` row. Audit `room.member_removed`.
- `addAgentToRoom(_prev, formData)` — room-admin. The agent must exist in the same org and not already be linked; appended to `room_agents` at `position = max + 1`. Audit `room.agent_added`, message "`@handle` added".
- `removeAgentFromRoom(_prev, formData)` — room-admin. If the agent is the room's `moderator_agent_id` (its lead agent), the field is cleared first. Deletes the `room_agents` link, audits `room.agent_removed`.

---

## 🧾 The new-room form (`room-form.tsx`)

`RoomForm` (`components/room-form.tsx:10`) is the client component wired to `createRoom` via `useActionState<ActionResult | null, FormData>` (`room-form.tsx:19`). Only the name (1–60) is shown up front. The `kind` select (private by default / public / dm) and a `memberId` select (members other than the caller) sit in a collapsed **More options** `<details>` (`room-form.tsx:39`), and the help text points to room settings for agents, people, tools and the lead. It posts hidden `orgSlug`. Errors surface in an inline alert; the submit button disables while pending. Client state tracks `kind` only to switch which fields are required.

---

## 📌 Per-user chat state (`room-state.ts`)

### `markRoomReadAction(orgSlug, roomId)`

Room-member action. Upserts `room_reads` for `(user_id, room_id)` with `last_read_at = now`, preserving existing `pinned`, `muted_until`, `archived` flags (`room-state.ts:20`).

### `setChatPreferenceAction(input)`

Room-member action over the same `room_reads` row (`room-state.ts:35`):

- `pin` / `unpin` — pinning enforces a cap of **3 pinned chats** per user (`room-state.ts:63`).
- `mute` / `unmute` — `duration` is `"8h"` (default), `"1w"`, or `"always"` (stored as `9999-12-31T23:59:59Z`); `unmute` clears the column (`room-state.ts:67`).
- `archive` / `unarchive` — toggles `archived`.
- `mark_unread` — sets `last_read_at` to one second before the room's latest message so the chat reappears unread (`room-state.ts:77`).

Revalidates the workspace layout; audit-free (per-user state is not audited).

### `setRoomExecutionModeAction(input: { orgSlug, roomId, mode })`

Sets `rooms.execution_mode` to `"review_all"`, `"ask_risky"`, `"auto"` or `"turbo"` (anything else fails with "Unknown mode") and `rooms.execution_mode_set_by` to the caller, since a Mac honours auto/turbo only when its owner picked them. Turbo also skips the server approval gate for dangerous tools. Allowed for room members and workspace admins (`roomRole !== null || canAdmin`); writes with the admin client scoped to the org, audits `room.execution_mode_set` with `{ mode }`, and returns a per-mode message (`MODE_MESSAGES`). It does not revalidate: the composer holds the value optimistically. See [tool system](../../orchestrator/tools/tool-system.md) for how the orchestrator applies it.

### `openBotDmAction(orgSlug, agentId)`

Authenticated action that resolves the agent in the org, ensures the 1:1 room via `ensureBotDmRoom` (see the agents/bots reference), audits `bot_dm.opened`, and returns `data.path = "/<orgSlug>/r/<roomId>"` (`room-state.ts:98`).

---

## ✉️ Sending messages (`messages.ts` + `message-send.ts`)

### `sendMessage(input: { orgSlug, roomId, content, threadRootId?, clientId?, messageId?, command? })`

`command` (`"goal" | "btw"`, from the composer's `/goal` and `/btw`) is stored as `metadata.command`; the orchestrator turns a goal into a round-by-round loop and lets a side note through without interrupting.

Member-level action (`getRoomAccess`, using request-cached `getCurrentUser()`). The write itself lives in `insertHumanMessage` (`message-send.ts:8`), so web, mobile and offline flush share one code path:

- Content must be 1–100,000 characters after trimming; `roomId` and `threadRootId` must be UUIDs (`message-send.ts:5`).
- Threads resolve the root message, require it to be in the same room, and normalize to the thread's actual root (`thread_root_id ?? id`) so nested replies stay flat (`message-send.ts:23`).
- **Idempotency & Optimistic ID Preservation**: With an explicit `id` (e.g. client-generated UUID for optimistic message rendering), the primary key `id` is respected and checked; with a `clientId` (capped at 80 chars, stored in `metadata.clientId`), a duplicate send returns the existing message id instead of inserting again — this is what makes optimistic UI and offline flushes safe and instantaneous (`message-send.ts:38`).
- The insert sets `sender_type: "human"`, `status: "complete"`, and `mentions` from `extractHandles(content)` (`message-send.ts:59`).

Back in the action, `queueRoomMessage(roomId, messageId)` pokes the orchestrator's `/internal/room-message` endpoint. If the orchestrator is unreachable the message is still saved and the result carries the warning "Message saved, but agents could not be reached…" (`messages.ts:39`); `data.messageId` is always returned on success.

### `retryMessageAction(input)`

Re-runs a failed turn: finds the room's last `sender_type: "human"` message at or before the failed message's `created_at` within the same thread scope (`thread_root_id` match, or top-level), then queues that trigger message again (`messages.ts:59`). Fails with "There is no earlier message to retry from" when none exists, or when the orchestrator cannot be reached.

### `stopGeneration(input)`

Member-level action that verifies the `agent_runs` row belongs to the room, then calls `stopRunInOrchestrator` (`POST /internal/runs/:runId/stop`). A failed call surfaces as "The agent service could not be reached, so the agent is still running." (`messages.ts:95`).

### `resolveToolCall(input: { orgSlug, toolCallId, decision: "approved" | "rejected", remember? })`

The human approval gate for dangerous tool calls (`messages.ts:100`):

1. Loads the `tool_calls` row (session client, so RLS applies), then resolves room access.
2. **Mac runs are special**: `macApprovalBlock` decides whether the step belongs to the caller's Mac; a non-Mac tool call requires `access.canAdmin` — only room/org admins may approve (`messages.ts:124`).
3. Only `status: "pending_approval"` calls can be resolved; the update repeats that status guard so double-submissions lose the race.
4. With `remember` on an approved Mac step, `rememberMacAllow` records the allowance and the args gain `_remembered: true` (`messages.ts:127`).
5. `admin.rpc("notify_tool_resolution", ...)` wakes the waiting engine (`messages.ts:146`), audit `tool.approved` / `tool.rejected`, and the message notes "won't ask again" when remembered.

---

## 📬 Optimistic send & offline outbox (`outbox.ts`)

The outbox is a browser-side queue in IndexedDB (`idb-keyval`, key `"mesh:outbox:v1"`, `outbox.ts:5`) that makes sending resilient to flaky connections:

- `OutboxItem` = `{ id, orgSlug, roomId, content, threadRootId, createdAt }`; the client generates `id` and passes it as the send's `clientId`, so a retried flush cannot duplicate a message.
- `enqueueOutbox` dedupes by id; `readOutbox` lists the queue.
- `flushOutbox` (`outbox.ts:31`) POSTs each item to `POST /api/messages` (the session-authenticated route, see the proxy/API reference) with `clientId: item.id`. Items are dropped on success or on terminal failures (`400`/`404`); anything else (including network errors) stays queued for the next flush. Returns `{ sent, failed }`.

---

## 🗺️ Row → view mapping (`message-map.ts`)

Pure mappers shared by server pages and tests:

- `messageFromRow(row, lookup)` (`message-map.ts:22`) converts a raw `messages` row into `MessageView`, resolving the sender name from agent and member maps: agents show their display name and handle, humans show their display name, and missing senders degrade to "Removed agent" / "Former member"; system messages read as `senderName: "system"`.
- `toolCallFromRow(row)` (`message-map.ts:62`) maps raw `tool_calls` rows to `ToolCallView`.
- `sortMessages` / `sortToolCalls` (`message-map.ts:79`) sort copies by `createdAt` string comparison.

---

## ❓ Answering agent requests (`answer-requests.ts`)

`answerRequestsAs(who, input)` (`answer-requests.ts:17`) is the shared routine behind the web Inbox and the phone app (it takes either a session user or a bearer-token client). Input is either a single `{ taskId, answer?, alsoPost?, itemAnswers? }` or a batch `answers: [...]`.

For each answer (≤ 4,000 chars):

1. Loads the `tasks` row; only open `kind: "request"` tasks qualify.
2. Room access is required; a request addressed to someone else (`requested_from_user_id`) may only be answered by that person or a room admin (`answer-requests.ts:69`).
3. **Destination**: when `alsoPost` is not set and the requester is an agent, the answer goes to the private bot DM created via `ensureBotDmRoom`; otherwise it is posted into the task's room with an explicit `@handle` prefix (`answer-requests.ts:87`–143).
4. **Keyed questions** (structured "ask items" in task metadata): answered keys are stored as owner facts via `upsertFact` (source `"answer"`), `deliverItemAnswers` posts the update, and the question stays open until every required item is filled (`answer-requests.ts:98`).
5. Plain answers insert a human `messages` row (metadata `taskId`, `requestAnswer: true`, `alsoPost`, `dmToAgentId`, plus `command: "goal"` and `goal` when the question was asked during a paused `/goal`, which is what makes the answer resume that goal — `goalContinuation`), queue the room message, and complete the task through `mutateTaskInOrchestrator` with `status: "done"`, outcome `decision`, and the answer as note/metadata (`answer-requests.ts:167`).
6. Audit `request.answered` for each processed task.

Finally, `resolveOpenAsksFromFacts` sweeps each touched room so one answered fact fills every other open question that was waiting on the same key (`answer-requests.ts:192`). The result message is "Answer sent" or "N answers submitted".

---

## 🧾 The rows behind a chat

| Table            | Key columns                                                                                                                                                                                                                                               | Who writes it                                                                 |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------- |
| `rooms`          | `kind` ∈ `public \| private \| dm`, `turn_mode` ∈ `mentions \| debate \| moderated`, `turn_cap`, `rpm_limit`, `daily_budget_usd`, `moderator_agent_id`, `debate_order`, `timezone`, `agent_dm_user_id`/`agent_dm_agent_id` (the DM markers), `created_by` | `createRoom`, `updateRoomSettings`, `ensureBotDmRoom`, `setupWorkspaceAction` |
| `room_members`   | `role` ∈ `admin \| member`                                                                                                                                                                                                                                | `createRoom`, `addRoomMember`, `removeRoomMember`, invites                    |
| `room_agents`    | `position` (append-order), `model_override` (per-chat model pick)                                                                                                                                                                                         | `addAgentToRoom`, `removeAgentFromRoom`, `setRoomAgentModelAction`            |
| `room_reads`     | `last_read_at`, `pinned`, `muted_until`, `archived` (unique per `user_id,room_id`)                                                                                                                                                                        | `markRoomReadAction`, `setChatPreferenceAction`                               |
| `room_schedules` | morning/evening minutes, check-in window/interval/duration, `checkin_mode`                                                                                                                                                                                | room creation, `saveRoomScheduleAction`                                       |
| `messages`       | `sender_type` ∈ `human \| agent \| system`, `status` ∈ `streaming \| complete \| error \| halted`, `mentions` (handles extracted from content), `thread_root_id`, `run_id`, `metadata` (e.g. `clientId`, `taskId`, `requestAnswer`, `botJoined`)          | `insertHumanMessage`, `collectBotKey`, `deliverItemAnswers`, the orchestrator |

## 📬 Shapes at a glance

- `sendMessage` success → `{ ok: true, data: { messageId } }`, plus `warning: "Message saved, but agents could not be reached…"` when the orchestrator is down.
- `flushOutbox` → `{ sent, failed }`; messages on `400`/`404` are dropped, anything else stays queued.
- `setChatPreferenceAction` → `ok("Chat updated")`; pin failures read "You can pin up to 3 chats".
- `resolveToolCall` messages: "Tool approved" / "Tool rejected" / "Allowed, and won't ask again for this".

---

Related docs: [Room chat UI](../pages/room-chat-ui.md), [Tasks, inbox & meetings UI](../pages/tasks-inbox-meetings-ui.md), [Turn lifecycle](../../architecture/turn-lifecycle.md), [Realtime & events](../../architecture/realtime-and-events.md), [Auth & authorization](../../architecture/auth-and-authorization.md)
