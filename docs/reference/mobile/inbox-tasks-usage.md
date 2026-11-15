# Inbox, Tasks & Usage

Three data surfaces answer "what needs me, what's moving, and what did it cost": the Inbox tab lists agent questions with quick-option chips and per-item typed answers; the Tasks tab is a filtered board of work handed to agents with a delegation sheet that also nudges the assignee over chat; and the Usage screen (pushed from More) charts tokens, spend, and runs per day, agent, and model. All three read through the web API or Supabase directly, stay live via tasks-table realtime subscriptions, and reuse the same theme/UI kit as the rest of the app.

Source files: `src/screens/InboxScreen.tsx`, `src/screens/TasksScreen.tsx`, `src/screens/UsageScreen.tsx`, `src/hooks/useInbox.ts`, `src/hooks/useTasks.ts`

---

## 📥 Inbox data (`src/hooks/useInbox.ts`)

`useInbox(orgSlug)` returns `{ questions, approvals, loading, error, refresh, answer }`:

- **Fetch** — `GET {currentWebApiUrl()}/api/mobile/inbox?orgSlug=<slug>` with the Supabase bearer token; the response `{ questions, approvals }` fills the two state values (`useInbox.ts:42-58`). Server-side shape is documented in [Mobile App API](../web/api/api-mobile.md).
- **`InboxQuestion`** (`useInbox.ts:13-25`): `{ id, roomId, roomName, title, description, agentHandle, agentName, askedCount, updatedAt, options, items }`. Each **`InboxItem`** is `{ key, question, hint, options, answer }` — a sub-question the agent asked, with `answer` already collected shown as resolved.
- **Live refresh** — a randomized `inbox:live:<rand>` channel on `postgres_changes` for `public.tasks` plus a 30-second interval (`useInbox.ts:75-86`). The inbox reads from task rows (agent asks are stored as tasks), which is why task changes drive it.
- **Answering** — `answer({ taskId, answer?, itemAnswers?, alsoPost? })` posts `POST {currentWebApiUrl()}/api/mobile/inbox/answer` with `{ orgSlug, ...input }`, returns the server's confirmation `message` (default "Sent"), then refreshes (`useInbox.ts:60-73`).

---

## 🧮 Data shapes at a glance

| Field | Meaning in the mobile client |
| :-- | :-- |
| `InboxQuestion.options` | Top-level quick answers; rendered as one-tap chips only when the question has no `items` (`InboxScreen.tsx:131-139`) |
| `InboxQuestion.items[]` | Per-item sub-questions; each answered item collapses to a `CheckCircle2` row showing the recorded `answer` |
| `InboxQuestion.askedCount` | How many times the agent re-asked; shown as "· asked N times" past 1 |
| `InboxQuestion.roomId / roomName` | Lets ChatScreen filter questions to the room it is showing and label cards with the source room |
| `TaskItem.status` | Five database states collapsed to three UI filters: `blocked` displays identically to `stuck` (`STATUS_LABEL`, `TasksScreen.tsx:28-34`) |
| `TaskItem.budgetTurns / turnsUsed` | Agent turn budget (defaults to 12 when null) — not shown in the list, carried in the type for the detail sheet |
| `TaskItem.unblockNeeds` | What a stuck agent is blocked on; surfaced only when status is `stuck`/`blocked` |
| `UsageData.cachedTokens` | Returned by the server in `totals` but not rendered on the phone |
| `UsageData.series[].day` | Date strings bucketed server-side using the phone's `tzOffset`; the chart labels use `slice(5)` (MM-DD) |

---

## ❓ Inbox screen (`src/screens/InboxScreen.tsx`)

`InboxScreen` (the `InboxTab` tab) renders a header — "N question(s) waiting on you" and, when nonzero, "· N waiting for your OK" for approvals — over a `FlatList` of `QuestionCard`s with pull-to-refresh and an "You're all caught up" empty state (`InboxScreen.tsx:182-220`).

### `QuestionCard` (exported; also reused by ChatScreen)

`QuestionCard({ question, onAnswer })` (`InboxScreen.tsx:30-169`) is the approval/answer UI:

- **Card header** — "<Agent> has a question" (or "needs a few answers" when multiple items), a meta line "<when> · <room>[ · asked N times]", and the question title. Long descriptions truncate to 4 lines with a "Read more" toggle past 200 characters (`InboxScreen.tsx:70-87`). The relative `when()` helper renders "just now" under a minute, "N min ago" under an hour, "N h ago" under a day, otherwise a short date (`InboxScreen.tsx:22-28`).
- **Per-item answers** — unanswered items render as numbered blocks with optional hint, option **chips** (single-select, stored into `values[item.key]`), and a free-text input. Already-answered items show a `CheckCircle2` with the recorded answer (`InboxScreen.tsx:89-129`).
- **Quick options** — when the question has no items but has top-level `options`, each chip sends immediately: `send(option)` calls `onAnswer` with `answer: option` (`InboxScreen.tsx:131-139`, `50-68`). This is the "Allow / Don't allow" style one-tap path.
- **Typed answer** — a multiline note input (placeholder "Your answer", or "Anything else? (optional)" when items exist).
- **"Also post my answer in the group chat"** — a `Switch` controlling `alsoPost` so the answer lands in the room as a message too (`InboxScreen.tsx:150-153`).
- **Send button** — disabled until at least one item value or the note is non-empty (`canSend`, `InboxScreen.tsx:48`); its label becomes "Send <filled> of <open>" when some items are still blank — partial answering is allowed, and the server decides how to treat unanswered items. On success it shows the server's status message and clears inputs; errors render inline (`InboxScreen.tsx:155-166`). While busy, the button shows an `ActivityIndicator` instead of text.

"Allow" / "Don't allow" buttons on chat-screen approval cards are a separate flow — those call `POST /api/v1/tools/{toolCallId}/approve` from `useRoomRealtime.resolveApproval`, documented in [Home & chat](home-and-chat.md).

---

## ✅ Tasks data (`src/hooks/useTasks.ts`)

`useTasks(roomId?)` returns `{ tasks, loading, error, refresh, createTask }`:

- **Fetch** — selects the latest 50 rows from `public.tasks` with `kind = "task"`, ordered `updated_at` descending, optionally filtered by `room_id` (`useTasks.ts:60-75`). Rows map through `mapTask` (`useTasks.ts:6-40`): priority comes from `metadata` via `taskPriority`, `budget_turns`/`turns_used` default to 12/0, `cost_usd` coerces to number, and `unblockNeeds` carries the stuck-task blocker note. The mapped shape is `TaskItem` from `src/types/index.ts:32-49` (`status: "open" | "in_progress" | "blocked" | "stuck" | "done"`, `priority: "low" | "medium" | "high" | "urgent"`).
- **Create** — `createTask({ orgId, roomId?, title, description?, priority?, budgetTurns?, assigneeAgentId? })` requires an org id and a room ("Choose a room. Tasks belong to a room so an agent knows where to work."), builds the insert payload with `taskInsertRow` from `src/core/workspace-draft.ts` (see [Pairing & onboarding](pairing-and-onboarding.md)), and prepends the returned task (`useTasks.ts:84-129`).
- **Live** — a `tasks:live` channel on `public.tasks` re-fetches on any change (`useTasks.ts:131-144`).

---

## 📋 Tasks screen (`src/screens/TasksScreen.tsx`)

### Board

- Three filter chips with counts: **Active** (`open` + `in_progress`), **Stuck** (`stuck` + `blocked`), **Done** (`TasksScreen.tsx:52-59`, `86-90`). The header has a "New task" accent icon button; the "New task" home-screen quick action opens the sheet via `route.params.action === "new-task"` (`TasksScreen.tsx:46-48`).
- **Task rows** (`TasksScreen.tsx:103-137`): a `StatusIcon` — `CheckCircle2` (done, `theme.ok`), `OctagonAlert` (stuck/blocked, warn), `CircleDot` (in progress, accent), `CircleDashed` (open) — the title, and a meta line joining assignee ("Any agent" if unassigned), `#room`, status label ("Not started" / "In progress" / "Stuck" / "Done"), and `shortTime(updatedAt)`. Stuck tasks with `unblockNeeds` show "Needs: <text>" in warn color (underscores replaced with spaces). The assignee's Mascot pulses while `in_progress`.
- **Detail sheet** (`TasksScreen.tsx:156-189`): full title and description, "<Agent> is on it" with Mascot or "Waiting for an agent to pick it up", and an "Open #<room>" button navigating to `Chat` with `{ roomId, roomName, orgSlug }`.
- Room/agent maps derive from the shared `useHome()` snapshot; rooms exclude DMs (`TasksScreen.tsx:49-50`).

### New task sheet (`NewTaskSheet`)

`NewTaskSheet` (`TasksScreen.tsx:194-286`) is the delegation flow:

1. **Title** (required, "What needs doing?") and optional details ("Details, links, what done looks like").
2. **"In which chat?"** — chips of non-DM rooms from the home snapshot; changing the room resets the assignee.
3. **"Who should do it?"** — "Any agent" (null assignee) or one of the room's members (`roomAgents` filtered by the room's `agentIds`), each chip showing the agent's Mascot.
4. **"Mark urgent"** toggle — sets `priority: "urgent"`, otherwise `"medium"` (`TasksScreen.tsx:229`).
5. Submit calls the injected `create` (which resolves the org id from `settings.orgSlug` and runs `createTask`), then — when an assignee was picked — `postRoomMessage(orgSlug, roomId, delegationMessage(agent.handle, title, details))`, the wake-up mention message from `src/core/workspace-draft.ts` ("@handle New task for you: …It's on the task board. Claim it…"). Errors on the nudge message are swallowed; only task creation failures block (`TasksScreen.tsx:224-244`). The submit button reads "Hand it over" when delegating, "Add task" otherwise.

---

## 📊 Usage screen (`src/screens/UsageScreen.tsx`)

`UsageScreen` (stack screen `Usage`, pushed from More) loads `GET /api/mobile/usage` through the shared `api()` helper from `src/core/api.ts` with query `orgSlug=<settings.orgSlug>&days=<days>&tzOffset=<new Date().getTimezoneOffset()>` — the tz offset makes the server bucket days in the phone's time zone (`UsageScreen.tsx:44-51`; endpoint documented in [Mobile App API](../web/api/api-mobile.md)).

`UsageData` (`UsageScreen.tsx:12-18`) contains `days`, `totals { tokens, costUsd, runs, cachedTokens }`, a daily `series [{ day, tokens, cost, runs }]`, per-`agents` totals, and `models` ranked by usage. The `api()` helper from `src/core/api.ts` supplies the bearer token from the current Supabase session ("Please sign in again." when there is none), defaults the method to GET for bodyless calls, and throws the server's `error` field or `HTTP <status>` (`api.ts:29-38`).

Display:

- **Range chips** — 7 / 30 / 90 days; changing re-fetches (`UsageScreen.tsx:65-69`).
- **Totals cards** — Tokens (`compactNumber`), Spend (`$X.XX`), Runs (`UsageScreen.tsx:75-88`).
- **"Per day" chart** — a `Bars` component drawing an SVG bar chart (`react-native-svg` `Rect`s, nonuniform `viewBox` scaling, bars floored at 2px, empty days as faint 1px lines) with a Tokens/Cost metric toggle; axis labels show the first day (`series[0].day.slice(5)`) and "Today" (`UsageScreen.tsx:20-32`, `90-108`).
- **"By agent"** — per-agent rows with Mascot, a proportional accent bar (relative to the busiest agent), and "<tokens> · $<cost>" (`UsageScreen.tsx:110-126`).
- **"Top models"** — `Row`s of `model` / `provider` with the same token+cost value (`UsageScreen.tsx:128-132`).
- Pull-to-refresh re-runs `load()`; errors render in the danger tone above the cards.

`compactNumber` and `shortTime` helpers come from `src/hooks/useHome.ts` (documented in [Home & chat](home-and-chat.md)).

---

## 🔁 Refresh wiring

Each surface refreshes on its own triggers:

- **Inbox** — initial load, a 30 s interval, any `public.tasks` change, and pull-to-refresh. Answers trigger an immediate `refresh()` after the POST succeeds so answered items collapse right away (`useInbox.ts:69`).
- **Tasks** — initial load, any `public.tasks` change via the shared `tasks:live` channel, pull-to-refresh, and after the New task sheet completes (`onDone` → `refresh()`). Because the Inbox and Tasks hooks subscribe to the same table independently, both stay current from one database event.
- **Tasks counts** — the Active/Stuck chips recompute synchronously from `tasks` state on every change; the tab badge in `TabNavigator` comes from `useInbox` instead (see [Navigation & auth](navigation-and-auth.md)).
- **Usage** — fetched on mount and whenever `orgSlug` or `days` changes (the `load` callback's dependency list re-runs the `useEffect`), plus manual pull-to-refresh. It does not subscribe to realtime.

---

## 🧩 Interaction with the rest of the app

- The Inbox tab badge in `TabNavigator` is `questions.length + approvals` from the same `useInbox` hook instance pattern — each tab mounts its own hook, and all of them refresh from the same events.
- HomeScreen's "N things need you" banner and each chat row's "<n> ?" warn pill come from `useHome`'s `needsYou` and per-chat `questions` counts — a different pipeline (`GET /api/mobile/home`) than the Inbox screen's `GET /api/mobile/inbox` (see [Home & chat](home-and-chat.md)).
- ChatScreen filters `useInbox(orgSlug).questions` by `roomId` for its in-chat question banner and reuses the exported `QuestionCard` with its own `answer` callback, so answering inside a chat uses the identical POST as the Inbox tab.
- `createTask` requires `roomId` because tasks are room-scoped server-side; the phone mirrors that in its error copy rather than inventing a default room.

---

Related docs: [Home & chat](home-and-chat.md), [Settings & UI kit](settings-and-ui-kit.md), [Mobile App API](../web/api/api-mobile.md), [Tasks, inbox & meetings UI](../web/pages/tasks-inbox-meetings-ui.md)
