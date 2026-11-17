# Tasks, Inbox, Meetings & Chats UI

This page covers the four "workspace home" screens beside the chat: the Tasks board (`/tasks`, a kanban of tasks plus agent requests), the Inbox (`/inbox`, approvals, agent questions, bot join requests, aged stuck tasks and an owner-facts panel), Meetings (`/meetings`, scheduled and live meetings plus weekday stand-up schedules), and the chat list surfaces (`/chats/new` for starting rooms or agent DMs). The data layer for all of them is `lib/queries-ia.ts`; mutations go through `lib/actions/tasks.ts`, `lib/actions/meetings.ts` and the shared request-answer pipeline in `lib/answer-requests.ts`.

Source files: `apps/web/src/app/(workspace)/[org]/tasks/page.tsx`, `inbox/page.tsx`, `meetings/page.tsx`, `chats/new/page.tsx`, `apps/web/src/components/ia/tasks-view.tsx`, `inbox-view.tsx`, `ask-card.tsx`, `meetings-view.tsx`, `new-chat-view.tsx`, `chats-view.tsx`, `facts-panel.tsx`, `apps/web/src/lib/queries-ia.ts`, `apps/web/src/lib/actions/tasks.ts`, `apps/web/src/lib/actions/meetings.ts`, `apps/web/src/lib/answer-requests.ts`

---

## 📚 Data Layer (`lib/queries-ia.ts`)

All loaders are `"server-only"` and RLS-scoped: they start from `readableRooms(access.orgId)` (rooms visible through the session client) and join names from `listOrgAgents` / `listMemberViews`.

| Loader | Reads | Notes |
| :--- | :--- | :--- |
| `loadChatList(access)` | `room_reads` (last_read, pinned, muted_until, archived), `room_agents`, last 500 messages across rooms, `pending_approval` tool-call count, open `kind: "request"` tasks, pending `bot_invites` | Builds `ChatListItem[]`: unread/mention counts are computed against `last_read_at` (own messages never count; mentions match the viewer's `humanHandle`), last sender resolves to `@handle` / member name / "You" / "system". Sorted pinned-first, then by last message time. **`inboxCount`** = pending approvals + **distinct** open request questions (grouped by `fold_key`, expired ones dropped — `queries-ia.ts:174`) + pending bot join requests (`countBotJoinRequests` reads service-role because `bot_invites` is server-only). |
| `loadMeetings(access)` | `room_schedules` for all rooms; `meetings` ending within the last 7 days, up to 150, ascending by start | Maps raw rows to `RoomScheduleView` / `MeetingView` with room names (`mapMeeting`). |
| `loadTasks(access)` | Latest 300 tasks (by `updated_at`) + rooms/agents/members, then `task_comments` (≤500), `task_events` (≤1000), and `agent_runs (task_id, cost_usd)` | Produces `TaskView` with author-resolved comments (`@handle` / member name / "System"), a status-change event timeline (`from_status → to_status`, reason, outcome), per-task `{ runs, cost }` summed from `agent_runs.cost_usd`, and fields like `unblockNeeds`/`unblockDetail`, `blockedBy[]`, `outcomeKind/Ref`, `foldKey`, `askedCount`, `expiresAt`, and lead/parent/budget fields (`lead_agent_id`, `parent_task_id`, `budget_turns`, `budget_usd`, `turns_used`). |
| `loadInbox(access)` | 50 newest `pending_approval` tool calls (+ `agent_runs` run→agent lookup), 30 resolved tool calls from the last 7 days, and `loadTasks` | Returns `approvals` (with room + agent names), `requests` (open, unexpired), `packets` (requests grouped by room into `DecisionPacketView`), `agedStuck` (tasks `stuck` for > **72 h** — `STUCK_ESCALATION_MS`, `queries-ia.ts:530`), and `done` (resolved approvals + done requests, capped at 30). |
| `loadBotJoinRequests(access)` | Pending, unexpired `bot_invites` in readable rooms (≤50) | Includes the normalized app label (`normalizeClient`) and `rejectedAttempts` count. |
| `loadOwnerFacts(access)` | `owner_facts` (≤300, newest first) | Key/label/value facts with room scope, source (`fact`/`answer`/…), source-agent handle, note. |
| `loadFiles`, `loadBotChats`, `searchMessages`, `loadRoomSchedule` | canvases / agent-to-agent mention messages / `ilike` search / one schedule | Power the Files page, the chats page "Agents talking to each other" section (`loadBotChats` keeps agent messages that mention *another* agent, ≤20 per room), `/search` (50 results, escapes `%`/`_`), and room settings. |

## 📋 Tasks (`/tasks` + `tasks-view.tsx`)

`TasksView` is a two-view client component refreshed by `useWorkspaceChange(["tasks"])` (realtime workspace-change subscription from `src/lib/use-workspace-change.ts`) with a header counter line ("N open tasks · M requests waiting · K answered"):

- **Tasks view** — a 4-column kanban (`COLUMNS = open | in_progress | stuck | done`) of `kind: "task"` items in a responsive `md:grid-cols-2 xl:grid-cols-4` grid. `TaskCard` shows:

| Chip / line | When |
| :--- | :--- |
| `SAYA-<number>` | always (mono, faint) |
| `request` tag | `kind === "request"` (accent mono text) |
| `needs: <unblockNeeds>` | stuck tasks with a need (danger chip) |
| `N blockers` | `blockedBy` non-empty and not done |
| `due <Mon D>` | `dueAt` set — red chip when overdue and not done |
| outcome row | done tasks with `outcomeKind`: "outcome: artifact · <ref>" |
| meta row | room (unless hidden), assignee (`@handle` / name / "Unassigned"), **`$<cost> · N runs`** from agent_runs, comment count, "asked by @handle" |

  Left border color encodes status (`taskTone`: ok-green done, danger stuck, accent in-progress). Cards open the detail dialog.
- **Requests view** — "Waiting on a human" list of open `kind: "request"` tasks beside an "Answered" aside (last 8 done), with the note "Answers can post in the room or go to the agent's direct chat. Either way the agent then continues."
- **Filters** — room select + text search (title/description/number), shared across both views, with a Clear-filters empty state.
- **New task/request form** — title (2–120), kind select (Task vs "Request (needs a decision)" — preselected by which tab you opened it from), room (non-DM), assignee (people/agents optgroups, hint "must already be in the room"), optional description; submits `createTaskAction` via a `FormData` action wrapper.
- **`TaskDetail`** — a right-side `<dialog>` with header (`SAYA-N`, `StatusBadge`, kind chip), description, a stat strip (Cost, Runs, Due, "In status since", Outcome, Blockers), and:
  - **Status select with guarded transitions** — moving to `done`, `stuck`, or `in_progress` with blockers stashes `pendingStatus` and opens a confirmation panel (`tasks-view.tsx:197`):
    - **done** requires an **outcome kind** select (`artifact | submission | external_change | decision | none (human override only)`) + optional outcome reference ("URL, Canvas ID, or ref").
    - **stuck** requires an **unblock needs** select (`human_answer | another_agent | credential | external_access | time | other`) + detail ("What specific fact, answer, or access is needed?").
    - **in_progress with blockers** requires a **reason** ("Why can this start while blockers are still unresolved?").
    - Plain `open ⇄` moves submit immediately via `updateTaskAction`.
  - **Assignee select** (Unassigned / People / Agents) — immediate `updateTaskAction({ assignee })`.
  - **"answer this request"** section for open requests — textarea plus the checkbox "Post the answer in <room>. Unchecked delivers it as a direct message to the agent." calling `answerTaskRequestAction`.
  - **Activity** — comments list + add-comment box (`addTaskCommentAction`), and an **Audit Timeline** of `task_events` ("@actor open → in_progress · <time>", reason and outcome lines), footed "changes are recorded in the audit log" with an "open room" link.

### Task actions (`lib/actions/tasks.ts`)

- **`createTaskAction(prev, formData)`** — `getRoomAccess`; validates title 2–120, description ≤4,000, kind in `task|request`; parses `user:`/`agent:` assignee prefixes and verifies the assignee is in **this room** (`room_agents` for agents via `agentForRoom`, `org_members` + `room_members` for people); inserts the task (`status: "open"`, `created_by`, `metadata: {}`); audits `task.created` / `request.created`; `revalidatePath("/<org>", "layout")`.
- **`updateTaskAction(input)`** — resolves the task's room access, validates a new assignee the same way, then delegates the whole mutation to **`mutateTaskInOrchestrator`** (`src/lib/orchestrator.ts`) — the comment reads "Mutate through orchestrator service layer enforcing task integrity & event recording" — passing status, assignees, `dueAt`, unblock fields, `blockedBy`, outcome, reason and note. Audits `task.updated` with room/status/assignee metadata.
- **`addTaskCommentAction(prev, formData)`** — content ≤4,000; inserts into `task_comments` as `author_type: "human"` with the room access check.
- **`answerTaskRequestAction(input)`** — thin wrapper: `requireUser("/<org>")` then `answerRequestsAs({ user }, input)` (below), revalidating on success.

## 📥 Inbox (`/inbox` + `inbox-view.tsx` + `ask-card.tsx`)

The page loads `loadInbox`, `loadBotJoinRequests`, `loadJoinRequests` (workspace admins only), `loadOwnerFacts`, the viewer's `room_members` admin room ids and non-DM rooms. `InboxView` refreshes via `useWorkspaceChange(["tool_calls", "tasks"])` and computes `needsYou = peopleRequests.length + joinRequests.length + requests.length + approvals.length` for the header ("You're all caught up…" / "N things need you…"). The sidebar badge adds the same pending people count for owners and admins (`countPeopleJoinRequests` inside `loadChatList`). Sections, newest-first:

1. **People asking to join** (`PersonCard`) — only for workspace admins. "<name> wants to join this workspace", email, role, room count, `when(createdAt)`. Approve/Decline call `decideJoinRequestAction`.
2. **Agents asking to join** (`JoinCard`) — avatar, "<name> wants to join #<room>", app label, `when(requestedAt)` (relative time from `ask-card.tsx:15`), the bot's self-description, and a warning when `rejectedAttempts > 0` ("Someone else also tried this link and was turned away. Only approve if you pasted it into this agent yourself."). Approve/Decline call `decideBotInviteAction` (`src/lib/actions/bot-invites.ts`); non-admins see "A room admin has to approve this."
3. **Questions for you** — `AskCard` per open request, sorted grouped-by-agent then recency ("one agent's questions sit together"). Hint: "Answer once. Your agents remember it and won't ask again."
4. **Waiting for your OK** — the room's `ApprovalCard` component (`src/components/room/tool-call-card.tsx`) reused per pending tool call, with "agent in room · <when>" context; `canApprove` is org-admin or that room's admin, and Mac-owned steps stay owner-only via `viewerId`. Hint: "An agent wants to change something and is paused until someone allows it. It gives up after 5 minutes."
5. **Stuck for more than 3 days** — aged stuck tasks ("These need someone to unblock or reassign them") with room, assignee, `unblockDetail` and an "Open chat" link.
6. **Done in the last 7 days** — a collapsed `<details>` of resolved approvals (`"<tool> in <room>"`) and answered requests.
7. Non-approvers see "You can see everything here. A room or workspace admin decides."

The sticky right column is **`FactsPanel`** (`facts-panel.tsx`): "Everything the person has already told their bots. Bots read this before asking, so a fact here is never asked again." Rows show label → value with scope and source; inline add/edit forms call `saveOwnerFactAction` / `deleteOwnerFactAction` (`src/lib/actions/facts.ts`) with label, value and scope select ("Every room in this workspace" or "Only #<room>"); bot-discovered facts are marked unconfirmed; label is fixed after creation.

### `AskCard` details (`ask-card.tsx`)

Keyed questions come from `askItemsFromMetadata(task.metadata)` (`@sayabot/core`):

- **One field per item** — answered items render as green check rows showing the question + answer ("Filled from what you told your agents before" when `item.source === "fact"`); open items get a numbered label, optional hint, **option chips** (`item.options` — clicking fills the field), and an input placeholder from `humanizeFactKey(item.key)`.
- **Free-form questions** get quick-answer buttons from `metadata.options` (first is primary) and one textarea.
- Submit calls `answerTaskRequestAction({ orgSlug, taskId, answer, alsoPost, itemAnswers })`; the button label shows batch progress ("Send 2 of 4"); toasts report leftovers ("Sent to @bot. N still open; answer them any time.") or completion ("It will remember, so it won't ask again."). "Also post my answer in the group chat" is a switch defaulting **off** (DM delivery).

### The answer pipeline (`lib/answer-requests.ts`)

`answerRequestsAs({ user, client? }, input)` is shared by the web Inbox (session) and the phone app (bearer token, via `/api/mobile/inbox/answer`). It accepts a single `{ taskId, answer, alsoPost, itemAnswers }` or a batch `answers[]`, then per item:

1. Loads the request task (skipping non-requests and done ones), checks room access, and only lets the addressed user (`requested_from_user_id`) or a room admin answer.
2. **Delivery room**: `alsoPost` posts into the task's room; otherwise `ensureBotDmRoom` (`src/lib/bot-dm.ts`) opens/reuses the bot's 1:1 DM with the answerer.
3. **Keyed questions** — answers applied with `applyAnswersToItems(askItems, itemAnswers, "human")`; each answered key is upserted as an **owner fact** (`upsertFact`, `src/lib/facts.ts`), and `deliverItemAnswers` posts the delta to the agent; the request stays open until every item is filled ("A free-text note with no items left to fill closes the question too").
4. **Free-form** — inserts a human message (`@handle <answer>` when posting into the group with a known agent) with `metadata: { taskId, requestAnswer: true, alsoPost, dmToAgentId? }`, `queueRoomMessage(targetRoomId, messageId)` to run the agent turn, then completes the request **through `mutateTaskInOrchestrator`** with `outcome: { kind: "decision", ref: messageId }`, reason "human answered request", and answer metadata.
5. Finally `resolveOpenAsksFromFacts` fills every other open question in the touched rooms waiting on the same keys — the "answer once" guarantee.

Every answered item audits `request.answered` with `{ roomId, targetRoomId, keys, remaining }`.

## 🗓️ Meetings (`/meetings` + `meetings-view.tsx`)

`MeetingsView` combines creation controls and three list sections from `loadMeetings`:

- **Create controls** — a "Start a meeting now" dialog (room, title, length select, agenda) via `startMeetingNowAction`, and a schedule form (future start via `dateTimeLocalToIso` from `src/lib/datetime.ts`) via `scheduleMeetingAction`.
- **Upcoming & live meetings** — `MeetingCard` per meeting: status chip (active accent / scheduled raised / ended muted), kind, room link, title, 2-line agenda, `formatMeetingTime(startsAt) → endsAt`; actions per status: **Start now** (`startScheduledMeetingAction`), **Ask agents again** (`wakeBotsAction`) + **End** behind `ConfirmButton` ("Any agent reply in progress will stop.") for active meetings, plus "open room".
- **Weekday stand-ups** — a `ScheduleCard` per room from `room_schedules`: shows the morning/evening windows (via `formatMinutes` from `@sayabot/core`), check-in interval, and a **live "in stand-up" indicator** computed client-side from the schedule's own timezone (`minutesNow(timeZone)` and `isWeekday(timeZone)`, `meetings-view.tsx:39` — Intl-based, so it is correct regardless of the viewer's machine). Rooms without a schedule get "This room has no weekday stand-ups yet." with a confirm-gated "Start a meeting" ("Every agent in this room will reply, using your API credits.") and a "set a schedule" link to room settings.

### Meeting actions (`lib/actions/meetings.ts`)

All prompts are posted by `postMeetingPrompt` (`meetings.ts:32`): it looks up the room's agents, then inserts a **human message on behalf of the starter** mentioning `@all_bots`:

```typescript
// apps/web/src/lib/actions/meetings.ts:17
const lead = wake ? `Wake up: the meeting "${title}" is live.`
  : kind === "checkin" ? `Check-in: ${title}.` : `Meeting started: ${title}.`
// + agenda + "\n\nAgents: report what you have done, what you are doing next, and anything you need from the humans."
```

with `metadata: { meetingId, automated: true, startMeeting: !wake }`; stores `prompt_message_id` and queues the room turn. Rooms with **no agents** get a system message instead ("<kind> started: <title>. No agents are in this room yet."). Any prompt failure rolls the meeting status back (`scheduled` → active attempt reverted; new meeting set to `ended`).

| Action | Guard | Effect |
| :--- | :--- | :--- |
| `startMeetingNowAction` | `adminRoomAccess`; duration 5–240 min; title ≤80; agenda ≤4,000 | Inserts an **active** meeting starting now (`metadata.slot: "manual"`), posts the prompt, audits `meeting.started`, returns the room path. |
| `startScheduledMeetingAction` | admin; `status === "scheduled"` | Claims the row with a conditional `update ... eq(status, scheduled)` (so double-starts fail with "already started or was canceled"), sets `starts_at` to now, posts the prompt. |
| `endMeetingAction` | admin; `status === "active"` | Ends it (`ends_at` = now), posts a system "Meeting ended: <title>." message, audits `meeting.ended`. |
| `wakeBotsAction` | admin; `status === "active"` ("Start the meeting before waking the bots") | Posts the wake prompt without ending anything. |
| `scheduleMeetingAction` | admin; title 2–80; future start **with explicit zone** ("A value without a zone would be read in the server's zone, not the user's", `meetings.ts:255`) | Inserts a `scheduled` meeting (`metadata.slot: "scheduled"`), audits `meeting.scheduled`. |

These are the same actions the room's `RoomMeetingBar` calls (see [room chat UI](./room-chat-ui.md)).

## 💬 Chats (`/chats/new` + `new-chat-view.tsx`, `chats-view.tsx`)

- **`/chats/new`** — `NewChatView` with two tabs (deep-linkable via `?tab=agent`): **Room with people** (renders `RoomForm` from `src/components/room-form.tsx` to create a room) and **Chat with an agent** — one card per agent (mascot, description/bio, model text via `agentModelText` + the server's Saya AI labels from `sayaAiPublic()`), each with a `BotStartButton` calling `openBotDmAction` (`src/lib/actions/room-state.ts`) which ensures the bot DM room and `router.push`es to `result.data.path`.
- **Chat list (org root, `[org]/page.tsx`)** — renders `ChatsView` wrapping `ChatList` (`src/components/workspace/chat-list.tsx`) over `loadChatList` items, with a mascot empty state, and an **"Agents talking to each other"** section (`Handoffs`, `chats-view.tsx:18`) built from `loadBotChats`: per room, expandable summaries of the last agent-to-agent mention messages ("@sender → @mentioned" + 4-line clamped content) with an "Open room" link.

---

## Related docs

- [Room chat UI](./room-chat-ui.md) — the ApprovalCard/ToolCallsList components the Inbox reuses, and `sendMessage`
- [Cron UI](./cron-ui.md) — scheduled routines vs meeting stand-ups
- [Agents UI](./agents-ui.md) — the agents these tasks and meetings assign work to
- [App overview](./app-overview.md) — `loadChatList`'s `inboxCount` driving the sidebar badge
- ../../database/schema-tasks-and-facts.md — `tasks`, `task_comments`, `task_events`, `owner_facts`
- ../../database/schema-routines-and-meetings.md — `meetings`, `room_schedules`
- ../../database/schema-identity-and-invites.md — `bot_invites` behind join requests
- ../../architecture/turn-lifecycle.md — `queueRoomMessage` and `mutateTaskInOrchestrator` on the orchestrator side
- Task/meeting action signatures are catalogued in `docs/reference/web/actions/`; the mobile inbox-answer endpoint in `docs/reference/web/api/`.
