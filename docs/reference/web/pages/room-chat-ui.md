# Room Chat UI

The room screen at `/(workspace)/[org]/r/[roomId]` is the heart of Sayabot: a chat feed where humans and agents take turns, with live token streaming, tool-call approval cards, threads, a composer with mentions and offline outbox, and a resizable side panel. That pane is either the bot settings sidebar or the workspace tabs (canvas, screen, activity, routines). Everything live flows through one Supabase Realtime channel per room (`useRoomRealtime`), fed by initial server-rendered data.

Source files: `apps/web/src/app/(workspace)/[org]/r/[roomId]/page.tsx`, `apps/web/src/components/room/room-workspace.tsx`, `agent-config-panel.tsx`, `side-panel.tsx`, `chat-panel.tsx`, `composer.tsx`, `message-item.tsx`, `message-actions.tsx`, `thread-sheet.tsx`, `turn-strip.tsx`, `tool-call-card.tsx`, `starter-card.tsx`, `setup-checklist.tsx`, `room-meeting-bar.tsx`, `use-room-realtime.ts`, `apps/web/src/components/markdown.tsx`, `apps/web/src/components/chat/*`, `apps/web/src/lib/message-map.ts`, `apps/web/src/lib/message-send.ts`, `apps/web/src/lib/agent-look.ts`

---

## 🗺️ Page → Component Data Flow

`page.tsx` is a server component that:

1. `requireRoomAccess(org, roomId)` (`src/lib/auth.ts`) resolves `{ org, user, room, orgRole, roomRole, canAdmin }` and 404s for non-members.
2. `loadRoomPageData(access)` (in `src/lib/queries.ts`) fetches messages, tool calls, canvases, room agents, members, avatars, thread counts, the active session, meeting and schedule.
3. `loadRoomRoutines(orgId, roomId)` reads up to 20 `routines` rows posting into this room. The agent name uses `agents!routines_agent_id_fkey`, so it is the bot that runs the schedule and not `created_by_agent_id`. The settings sidebar shows the schedules for the open bot.
4. **Setup checklist state**: only for non-DM rooms with zero agents, it computes `SetupState { canManage, hasModel, hasAgent, roomHasAgent, hasMessage }` from provider keys, org agents, and whether any human message exists (`page.tsx:69`).
5. Query params: `?canvas=<id>` pre-opens the side panel on that canvas, `?configure=1` opens the bot settings sidebar (the chat-list "Edit bot" link), `?m=<messageId>` focuses a message, `?thread=1&m=<id>` opens that thread.

`generateMetadata` titles the tab with the room name.

`RoomWorkspace` (`room-workspace.tsx`) owns the layout. It is a client component receiving `RoomPageData` and holding:

- **Split panes** — `react-resizable-panels` (`Group`/`Panel`/`Separator`) with chat at 60% min 380px and the side panel at 40% min 340px, persisted via a localStorage-backed `layoutStorage` (the library's default breaks SSR). `isDesktop` starts `null` until `matchMedia("(min-width: 768px)")` resolves, rendering a skeleton so the layout mounts exactly once.
- **Panel state per room** — `localStorage["sayabot:panel:<roomId>"]` remembers `canvas | screen | activity | routines | agent | closed`. `agent` is the bot settings sidebar. On a direct chat with a bot, when nothing is stored and the canvas is empty, the settings sidebar opens on desktop. `?canvas=` still wins. The choice is applied once per room visit so a later refresh does not jump the open section.
- **Header** — presence line (left), a pill with room mascots / `#`-prefix, room name, "Working" badge when `turnState.activeAgentId` is set, invite button, the panel toggle (with a red dot when approvals are pending), and a `DetailsMenu` with edit-bot / settings / add-bot / open-canvas / `EnableAlerts`. On a bot chat the mascot, the name, the pencil, and "Edit bot" open the settings sidebar in place. While that sidebar is open, the face follows the look being edited, and the chat title follows the name once it differs from the saved one. In a group chat each mascot opens that bot, and the menu has "Configure a bot". The chat-list "Edit bot" link goes to `?configure=1` on the chat, not the full bot page.
- **Children**: `RoomMeetingBar`, `RoomActivity` (screen + activity tabs' backing logic), the resizable chat plus either `AgentConfigPanel` or `RoomSidePanel`, and the `ThreadSheet` dialog.

## 🎛️ Bot settings sidebar (`agent-config-panel.tsx`)

Opening a bot (the chat pill, the pencil, "Edit bot", or `?configure=1`) puts `AgentConfigPanel` in the right pane. The title shows the name being typed and the same face Identity draws, including a look just picked. That preview is also sent to the chat header. A search box filters the sections. One section is open at a time and scrolls into view; a search hit expands every match. Escape clears the search, then closes the pane.

| Section | What it edits |
| :--- | :--- |
| Overview | Setup checklist, "Set up with the bot" (sends a short `@handle` prompt via `sendMessage`), name, what it does (schedules, else skills), and where it works plus connected apps |
| Identity | Display name (`updateBotBasicsAction` on blur) and mascot shape, expression and colour (`setAgentLookAction` → `params.mascot`). The highlighted shape and colour are the face on screen, including the name's default from `resolveMascotLook`. Choosing a shape keeps that colour |
| Soul | Standing instructions (the system prompt, 20,000 characters, saved on blur and with Save) and reply style (`setAgentReplyStyleAction` → `params.replyStyle`: `default` or `conversational`) |
| Skills | Org skills from `skills`, plus `saveOrgSkillAction` to add one. The list shows each skill's title. The bot loads it by name; it is not a composer shortcut |
| Tools | Boolean capabilities (search, documents, canvas, tasks, terminal, GitHub, database, MCP apps, connectors, helpers, schedules, secrets). Connected apps in Access is the connectors flag, not MCP |
| Memory | `capabilities.memory`, this bot's notes from `memories` (add with `rememberAction`, pin, remove), and a note that workspace upkeep prunes expired notes. When the bot has a computer, the mirror path `/home/bot/.saaya/memory/` is shown |
| Library | What it remembers, skills, where it works, and pages in this chat |
| Routines | Schedules whose `routines.agent_id` is this bot. Create posts to `POST /api/workspaces/:org/routines` (`daily at 9am` style). Run logs link to `/cron` |
| Computer | `WorksOnPicker` (Auto, Cloud desktop with a Boat / Self-hosted VPS / E2B switch, Private desktop, This computer, Off) saving through `setAgentWorksOnAction`, and the persistent computer (`capabilities.computer`, profile `standard` or `browser`) |
| Access | Working folder from `desktopHome(worksOn)`, a button that opens the screen, the `connectors` capability, connector grants, and for external bots the webhook address plus an API key (`issueAgentApiKey`, shown once, with copy) |
| Model | The chat model picker (`RoomModelPicker`, this copy does not listen for the composer shortcut) and effort chips (`setAgentModelAction`) |
| Permissions | This chat's execution mode (`setRoomExecutionModeAction`) |
| Voice & alerts | This person's notification mode (`setAlertModeAction`: all, mentions, off), the sound toggle (`setAlertSoundAction`), and the browser permission prompt. The section says this bot has no voice of its own |
| History | The latest tool calls, then Activity |
| Usage | Last 30 days from `usage_rollup` for this bot, plus a link to `/analytics` |

Workspace admins can change the bot. Anyone in the chat can change the execution mode and their own alerts. Invited bots (`kind: "external"`) keep their own tools, memory, and model, and they are the only bots that can issue an API key from this pane. "Canvas" in the header returns to `RoomSidePanel`. Delete stays on `/agents/[agentId]`.

`loadRoomPageData` selects `agents.capabilities` so the toggles show the saved flags rather than the defaults. The room page also loads org skills, connector grants for the bots in the chat, a 30-day `usage_rollup` for those bots, and their memory notes (title and pin only).

## 📡 Realtime Hook (`use-room-realtime.ts`)

`useRoomRealtime` is the single subscription point. It creates a **private** Supabase channel `room:<roomId>` with presence keyed on the user id, after `supabase.realtime.setAuth(access_token)` (`use-room-realtime.ts:252`), and handles:

| Event / source | Effect |
| :--- | :--- |
| `broadcast: message.delta` | Appends `delta` to a streaming message; ordered by `seq` (`deltaSeq` map drops out-of-order replays); creates a placeholder agent message if unseen. |
| `broadcast: message.done` | Sets final status, clears `runActivity`, then re-fetches the authoritative row (`refreshMessage`). |
| `broadcast: message.removed` | Removes a failed attempt the server retried. |
| `broadcast: run.step` / `run.status` / `run.plan` | Builds the `runActivity` state shown in `TurnStrip` (label, status, plan checklist with done counts). |
| `broadcast: turn.state` | Live `TurnStateView { sessionId, activeAgentId, queue }` (thread-scoped states ignored in the main feed). |
| `broadcast: tool.approval_requested / approval_resolved / started / finished / output` | Maintains `toolCalls` — inserting pending/running cards, flipping statuses, and appending `liveOutput` chunks. |
| `postgres_changes` on `messages` / `tool_calls` (filter `room_id=eq.<id>`) | Merge upserts (DELETE removes the message); thread INSERTs bump `threadCounts`. |
| `postgres_changes` on `canvases` / `meetings` | Canvas content syncs separately — only INSERT/DELETE triggers a debounced `router.refresh()` (500 ms). |
| presence `sync/join/leave` | Rebuilds the presence list (`{ id, name, typing }`). |

Robustness details worth knowing:

- **Merge, don't clobber**: `mergeMessage` keeps the longer content when a non-authoritative update arrives shorter while still `streaming`, and shallow-merges `metadata` (`use-room-realtime.ts:118`).
- **Offline**: `window offline/online` events set `connection`; on `online` it inspects the channel state because a brief drop may not produce a new `SUBSCRIBED`. While not connected, a 4-second polling interval re-pulls the last 80 messages + 60 tool calls as a catch-up.
- **Pagination**: first page is 80 messages; "Load older messages" fetches 50 more before the oldest root message (`loadOlder`), also fetching their tool calls. `?m=` links to unloaded messages trigger a jump-window query (`JUMP_WINDOW = 1000` messages from the target forward, `use-room-realtime.ts:217`).
- **Typing**: `trackTyping` tracks presence `{ typing: true }` and auto-clears after 2.5 s.

Row→view mapping lives in `src/lib/message-map.ts` (`messageFromRow` resolves sender names from agent/member lookups, falling back to "Removed agent" / "Former member" / "system"; `toolCallFromRow`; timestamp sorts).

## 💬 Chat Feed (`chat-panel.tsx`)

`ChatPanel` renders, top to bottom: connection banners (`error` → "Live updates paused…", `offline` → "You are offline…"), `SetupChecklist` (empty rooms), `StarterCard` (new DMs), the message list, the jump-to-latest pill, orphan approval/tool cards, `TurnStrip`, and the `Composer`.

Scroll behaviour is hand-rolled (`chat-panel.tsx:173`):

- `stickToBottom` follows the viewport within `STICK_THRESHOLD_PX = 140`; scrolling up shows a "↓ Latest" / "↓ N new messages" pill.
- First paint scrolls to `focusMessageId` (adding a `message-highlight` class) or the first unread message (computed once from `lastReadAt`), else bottom.
- Prepending older messages restores scroll with a `prependAnchor` (saved `scrollHeight - scrollTop`).
- A "New messages" separator renders before `firstUnreadId`; day dividers ("today", "yesterday", weekday) appear between differing days; a message is `continued` (avatar/name hidden) when the same sender wrote the previous message within 5 minutes.
- Empty rooms show mascot row + guidance ("Say hi! Type @ and pick a name…"); a screen-reader `aria-live` paragraph announces each completed agent message.

`orphanCalls` (`chat-panel.tsx:132`) lifts tool calls that need attention but have no visible home — `pending_approval` or running-without-message — into a strip above the composer (last 6).

Retry eligibility: system `halted` messages retry only when `metadata.reason` is in `RETRYABLE_REASONS` (`src/lib/recovery-hint.ts`), and only the last message offers retry.

## ✍️ Composer (`composer.tsx`)

`Composer` (also reused in threads with `compact` and a `threadRootId`) is a single textarea with:

- **Mentions** — typing `@` after whitespace/paren opens a listbox of `@all_bots` (only when >1 agent), agents, and people (filtered by the trailing query); full combobox ARIA (`role="combobox"`, `aria-activedescendant`), ArrowUp/Down/Enter/Tab/Escape handling; `insertMention` splices the handle and restores the caret.
- **Drafts** — persisted per room+thread under `mesh:draft:<roomId>:<thread|main>`; cleared only if the sent text is unchanged (`clearIfUnchanged`).
- **Slash commands** (`src/lib/slash-commands.ts`) — typing `/` as the first character opens a "Commands" listbox (same keyboard handling as mentions: ↑/↓, Enter/Tab picks, Escape clears; commands without arguments run on pick). The placeholder ends with ", / for commands". `parseSlashCommand` drives `send()`:
  - `/goal <what to achieve>` — sends the text with `metadata.command = "goal"`; the orchestrator loops the bot round by round until it ends a reply with `GOAL COMPLETE` / `GOAL BLOCKED: …` (see [Turn lifecycle](../../architecture/turn-lifecycle.md)).
  - `/btw <note>` — sends with `metadata.command = "btw"`: delivered to agents running now without interrupting them, and read by the rest on their next turn.
  - `/stop` — calls the chat panel's `onStop` (`stopGeneration` for the streaming run), or toasts "Nothing is running right now".
  - `/model` — dispatches `MODEL_PICKER_EVENT` to open the composer's model picker.
  - `/todo [title]` and `/schedule [instructions]` (alias `/cron`; `/schedule list` opens `/<org>/cron`) — open the quick-action dialog with the text pre-filled (`initialText`).
  - `/remember <fact>` — `rememberAction` (`src/lib/actions/memory.ts`), saved to room memory.
  Human bubbles of `/goal` and `/btw` messages carry a small "Goal" / "Side note" label (`message-item.tsx`).
- **Offline outbox** — when `navigator.onLine` is false (or `sendMessage` throws), the message goes to `enqueueOutbox` (`src/lib/outbox.ts`) with a UUID, shown as "N messages waiting to send" and flushed on the `online` event.
- **Layout & Focus** — one rounded surface (`rounded-[22px]` with subtle `focus-within` ambient glow and border highlight; the inner auto-growing textarea is outline-less via `focus-visible:outline-none` and `globals.css` suppresses default rectangular `:focus-visible` outlines on text inputs), a toolbar row below with a **"+" menu** (a `DetailsMenu` with Attach a PDF, Add a to-do, Do this on a schedule, Start a meeting for admins outside DMs, Open canvas), the chat's `RoomModelPicker` (`placement="up"`, see [Model system](./model-system.md)), then on the right the **execution mode** menu and a round white send button. Threads (`threadRootId`) show only the textarea and send button.
- **PDF attach** — "+" → Attach a PDF, or drag-drop, accepts only PDFs ≤ 8 MB, reads them as data URLs, and appends `[name](dataUrl)` markdown that the message renderer turns into a `PdfViewer`.
- **Quick actions** (main chat only) — `QuickActionDialog` for "task" (`createTaskAction` from `src/lib/actions/tasks.ts`, with people/agent assignee select), "meeting" (`startMeetingNowAction` from `src/lib/actions/meetings.ts`, admin + non-DM only), and "cron" (POSTs to `/api/workspaces/<org>/routines` with name, natural-language or cron `schedule_expr`, `agent_id`, `room_id`, `prompt`), each with success toasts and deep links.
- **Permissions** (`ExecutionModeMenu`) — a dropdown showing the chat's `rooms.execution_mode`, like a local coding agent's permissions: **Request review** (`review_all`: every step waits for an OK, even reading; saved "always allow" rules are ignored on the Mac), **Default** (`ask_risky`: sensitive steps ask), **Auto** (`auto`: on your Mac, read-only commands run on their own, anything that changes things asks) and **Turbo** (`turbo`: on your Mac, every command runs without asking). Choosing one is optimistic and saved with `setRoomExecutionModeAction` (rolls back with a danger toast on failure). Auto and Turbo only take effect on the Mac of the person who picked them (see `macPermissions`), and server tools that reach other people or services (sending, posting, spending) ask in every mode. The initial value comes from `RoomView.executionMode` via `RoomWorkspace` → `ChatPanel` → `Composer`.
- Enter sends (Shift+Enter newline, IME-composition safe); the textarea auto-grows to 220 px (160 compact); 100,000-char cap with a counter above 90,000.

`sendMessage` (from `src/lib/actions/messages.ts`) inserts the row server-side via `insertHumanMessage` (`src/lib/message-send.ts`), which validates 1–100k chars, resolves/validates the thread root (threading replies to a reply flattens to its root), and dedupes on `metadata.clientId`.

## 🧵 Messages (`message-item.tsx`, `message-actions.tsx`)

`MessageItem` renders three shapes:

- **System messages** — a grey card ("Sayabot" + timestamp) with a "Halted" state, optional `PokeBotButton` when `metadata.reason === "agent_quiet"` (sends "@<handle> are you still there? Pick up where you left off…" via `sendMessage`), and `FailureActions` for halted turns.
- **Human messages** — right-aligned bubbles (`mine` when `senderId === selfId`), no avatar column.
- **Agent messages** — avatar + name, panel-tinted bubble, `InspectTraceButton` (opens the run inspector drawer), `CopyButton`, per-message `ToolCallsList`, reply-in-thread button, live vote tally (`VoteTally` reads `metadata.vote { question, options, ballots }`, animating bars and showing per-agent reasons), collapsible tool warnings, error banner + `FailureActions`, and the `replySourceLabel` footnote (e.g. "answered from your Mac" via `src/lib/runs-on.ts`).

Streaming shows a "Live" tag, a `streaming-caret`, or a three-dot "Thinking" bubble when no content has arrived yet.

`FailureActions` (`message-actions.tsx:11`) is the recovery UX: a "Details" trace button, a "Retry" button (only when `retryHelps(metadata.errorKind)` — retrying a too-big or rejected-key failure is pointless) calling `retryMessageAction`, and a `recoveryHint`-driven CTA that either dispatches `MODEL_PICKER_EVENT` (opens the room model picker) or links to settings.

## 🧵 Threads (`thread-sheet.tsx`)

A right-side native `<dialog>` (max 560px) for one thread root. On open it fetches `id.eq.<root> or thread_root_id.eq.<root>` ordered ascending and merges into the shared message store (`mergeHistory`), so main feed and thread share live updates. Renders root + replies with `MessageItem inThread`, an empty state ("Replies here stay out of the main chat"), a `TurnStrip` (thread-scoped), and a compact `Composer` with `threadRootId`.

## ⏱️ Turn Strip & Approvals

`TurnStrip` (`turn-strip.tsx`) appears only when a turn is active: the working agent's busy mascot, "… is working on it", the current step label from `runActivity` (`run.step` broadcast), "N of M done" for plan mode, "then <names>" for queued agents, and a Stop button that calls `stopGeneration({ orgSlug, roomId, runId })` from `src/lib/actions/messages.ts`.

`tool-call-card.tsx` exports the approval system:

- **`ApprovalCard`** — "approval needed" header with a live countdown (`approvalMsLeft` from `src/lib/tool-summary.ts`; <60 s turns warn, ≤0 shows "expired — rejected automatically"). The human-readable request comes from `describeToolCall` (or `describeMacStep` for Mac-hosted steps, where approval belongs to the host owner via `readMacMarker`; non-owners see "Waiting for the owner of <host> to decide"). Body shows the exact JSON args. Buttons: Approve, Reject, and a conditional "always allow" (`decide("approved", true)` → `resolveToolCall({ decision, remember })` from `src/lib/actions/messages.ts`).
- **`ToolCallCard`** — a `<details>` card with status badge, arguments, streaming `liveOutput` (with copy), error and result blocks.
- **`ToolCallsList`** — routes each call to the right card; `pending_approval` → `ApprovalCard`.

## 🧾 Message Rendering (`markdown.tsx` + `components/chat/*`)

Messages render through **Streamdown** (streaming-safe markdown) with mode `streaming | static`, `parseIncompleteMarkdown`, and plugins:

- `@streamdown/code` (syntax highlighting), `@streamdown/math` (KaTeX with single-dollar math enabled), `@streamdown/mermaid` with a full dark theme config (`markdown.tsx:15`).
- **Custom element overrides**: `a` renders `PdfViewer` for PDF URLs/data-URIs (`isPdfUrl` in `pdf-viewer.tsx:20`), inline `<video>`/`<audio>` players for media file extensions, and external links with `target=_blank` + `noopener noreferrer` + an external-link icon; `img` renders `PdfViewer` or `ImageWithLightbox`; `blockquote` starting with `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]` becomes a `Callout` (`callout.tsx` — `parseAlert` checks the first text node and returns the typed config); `table` gets a scroll wrapper.
- **`MermaidErrorFallback`** (`chat/mermaid-error.tsx`) — shows a spinner while streaming, otherwise a "Mermaid Syntax Error" card with Retry, the error text, and a view/copy-code drawer.
- **`ImageWithLightbox`** (`chat/image-lightbox.tsx`) — lazy image with hover zoom button, fullscreen lightbox with 50–300% zoom controls, download, Esc/backdrop close, and a graceful "Image failed to load" chip.
- **`PdfViewer`** (`chat/pdf-viewer.tsx`) — collapsed-by-default card (filename + source via `extractPdfFilename`/`extractSource`) embedding the browser PDF viewer in an iframe with `page`, `view` (FitH/Fit), and `zoom` hash parameters, plus fullscreen modal and download.

## 🧭 First-Run Aids

- **`SetupChecklist`** (`setup-checklist.tsx`) — for admins: four steps (Connect an AI model → `/settings/keys`, Create an agent → `/agents?room=<id>#create-agent`, Add the agent to this room → `/r/<id>/settings#room-agents`, Send your first message) with the next undone step highlighted and CTA'd; non-admins get a one-line notice. Dismissal persists in `mesh:setup-dismissed:<roomId>`.
- **`StarterCard`** (`starter-card.tsx`) — for empty DMs: the agent's mascot greets the user by first name and offers five starters (research, monitoring, email/calendar, errands, data) plus "Something else". Clicking sends the prompt with a "set yourself up for that" hint via `sendMessage`; keyboard shortcuts `a`–`f` select options when no input is focused; dismissible.

## 🗓️ Meeting Bar (`room-meeting-bar.tsx`)

A slim strip under the header fed by `data.meeting` / `data.roomSchedule`:

- **Live/scheduled meeting** — status dot + "live · check-in" style label, title, time range, and actions: `startScheduledMeetingAction` (Start), `wakeBotsAction` ("Ask agents again"), and `endMeetingAction` behind a `ConfirmButton` ("Any agent reply in progress will stop.") — all from `src/lib/actions/meetings.ts`. A link to `/meetings` sits on the right.
- **Schedule only** — "weekday stand-ups" with the morning/evening windows and optional check-in interval, and the time zone. Not worth chat space on phones: only active meetings render below `md`.

---

## Related docs

- [Canvas UI](./canvas-ui.md) — the side panel's main tab
- [Model system](./model-system.md) — `RoomModelPicker` in the composer
- [Tasks, Inbox & Meetings UI](./tasks-inbox-meetings-ui.md) — where approvals and meeting threads land
- [Cron UI](./cron-ui.md) — the routines created by the composer's Schedule action
- [App overview](./app-overview.md) — the workspace shell around this screen
- ../../architecture/turn-lifecycle.md — what `turn.state`, `run.step` and `message.delta` mean server-side
- ../../architecture/realtime-and-events.md — the broadcast contract consumed here
- ../../database/schema-rooms-messages-canvas.md — `messages`, `tool_calls`, `room_reads` tables
- Message/room server actions are catalogued in `docs/reference/web/actions/`; the routines REST route in `docs/reference/web/api/`.
