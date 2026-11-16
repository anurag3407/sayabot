# Home & Chat

The Chats tab (`HomeScreen`) is the app's dashboard: an org-switcher header, a "needs you" banner, an agent strip, and the chat list — all backed by one shared home snapshot cached on disk and kept live by a single realtime subscription. Opening a chat pushes `ChatScreen`, which loads the room's message history, subscribes to a private broadcast channel for token streaming, agent status, terminal output, and danger-tool approvals, and posts outgoing messages through the web API. Message bodies are rendered by a lightweight Markdown pipeline (`parseBlocks` + `RichText`), and any `tool.output` events feed a slide-up terminal drawer showing the agent's computer shell.

Source files: `src/screens/HomeScreen.tsx`, `src/screens/ChatScreen.tsx`, `src/hooks/useHome.ts`, `src/hooks/useRooms.ts`, `src/hooks/useRoomRealtime.ts`, `src/hooks/useRoomAgents.ts`, `src/core/room-message.ts`, `src/core/api.ts`, `src/ui/RichText.tsx`, `src/core/markdown.ts`, `src/components/chat/TerminalDrawer.tsx`, `src/components/chat/ModelPicker.tsx`, `src/core/model-choice.ts`, `src/types/index.ts`

---

## 🏠 Home data model (`src/hooks/useHome.ts`)

`useHome` exposes one module-level snapshot shared by every screen that mounts it (Chats, More, Tasks, agent pages):

- **Types** (`useHome.ts:7-40`): `HomeChat` (`id`, `name`, `kind: "public" | "private" | "dm"`, `agentIds`, `pinned`, `muted`, `unread`, `questions`, `workingAgentId`, `lastMessage { preview, senderName, at, streaming }`, `updatedAt`) and `HomeAgent` (`handle`, `kind: "llm" | "external"`, `model`, `workingRoomId`, `usage { tokens, runs, costUsd, lastAt, topModel }`, `roomIds`). `HomeData` adds `org`, `orgs[]`, `user`, and `needsYou { questions, approvals }`.
- **Fetch** — `refreshHome()` calls `GET {currentWebApiUrl()}/api/mobile/home?orgSlug=<slug>` with the Supabase bearer token, caches the JSON to AsyncStorage key `@sayabot/home_cache_v1`, and — server-side, documented in [Mobile App API](../web/api/api-mobile.md) — writes back `settings.orgSlug` when the response's `org.slug` differs (`useHome.ts:76-102`). Concurrent calls share one `inflight` promise.
- **Instant cache** — on module load the last cached snapshot is read from AsyncStorage so the list renders before the network answers (`useHome.ts:67-74`).
- **Live updates** — the first mounter starts a Supabase channel listening to `INSERT`/`UPDATE` on `public.messages` and all events on `public.tasks`, each event triggering a debounced (700 ms) refresh; a 45 s interval refresh runs regardless (`useHome.ts:104-121`). The last unmount stops the channel and interval (`useHome.ts:127-139`).
- Helpers exported for the whole app: `shortTime(iso)` ("now", "3m", "2h", weekday, date) and `compactNumber(n)` (K/M/B) (`useHome.ts:152-169`).

---

## 💬 Chats list (`src/screens/HomeScreen.tsx`)

### Header and banners

- Org name with a chevron when the user belongs to more than one workspace; tapping opens a "Workspaces" `Sheet` listing `data.orgs` with the current one marked; choosing one calls `applySettings({ orgSlug })` which cascades everywhere (`HomeScreen.tsx:183-193`, `430-445`).
- "N things need you" banner (questions + approvals from `data.needsYou`) navigating to `InboxTab` (`HomeScreen.tsx:199-238`).
- Horizontal agent strip: each agent is a `Mascot` avatar with a working ring, tapping opens `AgentProfile`; a dashed "Add" tile opens the web app's `/{orgSlug}/agents` page via `Linking.openURL` (`HomeScreen.tsx:240-277`, `261`).
- A compact "Chats" title fades in over a blurred bar once the large title scrolls away (animated from scroll offset 40→70) (`HomeScreen.tsx:176`, `323-343`).

### Chat rows and actions

`ChatRow` (`HomeScreen.tsx:57-124`) shows a `ChatAvatar` (DM: the agent's Mascot with a working indicator; group: two overlapping Mascots; no agents: a `#` hash tile), a pin icon, relative timestamp, and a preview line that reads "<Agent> is working…" when `workingAgentId` is set, plus a "<n> ?" warn pill for open questions and an unread `Badge`.

- Tap → `navigation.navigate("Chat", { roomId, roomName, orgSlug })`; long-press → actions sheet (`HomeScreen.tsx:154`, `293`).
- The actions sheet offers **Pin to top / Unpin**, **Mark as read**, and **Archive** (destructive). All write to the `room_reads` table via an upsert on `(user_id, room_id)` — `pinned`, `archived`, or `last_read_at` — then refresh (`HomeScreen.tsx:157-174`, `447-480`).
- Pull-to-refresh calls `refreshHome()`.

### Search

A floating bottom search pill (blurred on iOS) filters as you type: chats by name/preview and agents by name/handle. Results replace the list in place — agents first (`@handle · model` subtitle) then chats; an X button clears (`HomeScreen.tsx:145-152`, `345-428`).

### New chat sheet

`NewChatSheet` (`HomeScreen.tsx:497-593`) creates a room directly through Supabase (not the web API):

1. Looks up the org id by `settings.orgSlug` from `orgs`.
2. Slugifies the name to `[a-z0-9-]`, max 48 chars.
3. Inserts into `rooms` with `kind: "private"`, `turn_mode: "mentions"`, the device's IANA timezone, `created_by` the user (`HomeScreen.tsx:529-534`).
4. Inserts `room_members` (`role: "admin"`) and one `room_agents` row per picked agent with sequential `position`.
5. Fires `haptic.success()`, then `onCreated` refreshes home and opens the new chat.

Picking agents is optional ("Who should be in it? (optional)"). The sheet says a name is enough: agents, the lead and apps are set up later in room settings.

It is also opened by the "New chat" home-screen quick action, which lands via `route.params.action === "new-chat"` (`HomeScreen.tsx:137-140`).

### Room list hook (`src/hooks/useRooms.ts`)

`useRooms(preferredSlug?)` is the Supabase-side room loader (used where the home snapshot is not enough): it reads `org_members` → `orgs` → `rooms` (`id, org_id, name, kind, turn_mode, system_directive, timezone`, ordered by `kind` then `name`), falling back to the first org with a notice when the preferred slug is missing (`useRooms.ts:20-95`). `createRoom({ name, kind, turnMode, systemDirective? })` inserts the room, adds the creator as `room_members` admin — deleting the room if that fails — and returns the `Room` (`useRooms.ts:97-157`). A `rooms:list` channel re-fetches on any `rooms` table change (`useRooms.ts:159-172`).

---

## ⚡ Room realtime (`src/hooks/useRoomRealtime.ts`)

`useRoomRealtime(roomId, orgSlug)` powers the chat screen. Returns `{ messages, loading, error, agentStatus, activeAgentId, terminalLogs, approval, sendMessage, resolveApproval, clearTerminal, reload }`.

### History

`loadHistory()` selects the latest 80 top-level messages (`thread_root_id is null`, oldest-first) from `public.messages` for the room and maps snake_case rows to `Message` (`useRoomRealtime.ts:33-80`; `mapRow` at `6-21` names agents from `metadata.agentName` / `agentHandle`).

### Broadcast channel

A **private** Supabase channel `room:<roomId>` carries the live events (`useRoomRealtime.ts:84-162`):

| Event | Effect |
| :-- | :-- |
| `message.delta` | Appends `payload.delta` to the message with `payload.messageId`, or creates a new streaming agent message (`useRoomRealtime.ts:91-113`) |
| `message.done` | Clears `agentStatus`, sets the message's `status` from `payload.status` (`116-123`) |
| `turn.state` | Records `payload.activeAgentId` (`126-128`) |
| `tool.output` | Appends `payload.chunk` to `terminalLogs`, capped at the last 150 chunks (`131-133`) |
| `run.step` | Sets `agentStatus` to `payload.label` (`136-138`) |
| `run.status` | Maps `thinking` / `tool` / `compacting` to fixed status strings ("Agent is thinking...", "Running computer command...", "Compacting memory..."); any other non-`waiting*` status clears it (`141-146`) |
| `tool.approval_requested` | Populates the `PendingApproval` `{ toolCallId, toolName, agentId, args }` card (`149-156`) |
| `tool.approval_resolved` | Clears the approval card (`159-161`) |

The event names mirror the orchestrator's realtime broadcast topics (see [Realtime & events](../architecture/realtime-and-events.md)).

A second randomized channel `room-rows:<roomId>:<rand>` listens to `postgres_changes` INSERT/UPDATE on `messages` filtered by `room_id`: INSERTs skip threaded rows, dedupe, and replace the optimistic `local-*` copy of a just-sent message; UPDATEs merge content edits (`useRoomRealtime.ts:165-186`).

### Sending and approvals

- `sendMessage(content)` (`useRoomRealtime.ts:195-242`) first appends an optimistic message (`id: "local-<ts>"`, `status: "streaming"`, `metadata: { sending: true }`), then `POST {currentWebApiUrl()}/api/messages` with `{ orgSlug, roomId, content }` and the bearer token. On failure the optimistic copy flips to `metadata.failed`. On success, if the response carries `messageId`, the local copy is either dropped (real row already arrived) or promoted to the real id with `status: "complete"`.
- `resolveApproval(approved)` (`useRoomRealtime.ts:245-263`) posts `POST /api/v1/tools/{toolCallId}/approve` with `{ approved }` and the bearer token, clearing the card on success. This is the mobile face of the human approval gate (see [Architecture: security model](../architecture/security-model.md) context; server routes in [Mobile App API](../web/api/api-mobile.md)).

`src/core/room-message.ts` offers `postRoomMessage(orgSlug, roomId, content)` — the same `POST /api/messages` call without optimistic UI — for callers outside the chat screen (`room-message.ts:5-19`).

### Room agents

`useRoomAgents(roomId, refreshKey = 0)` queries `room_agents` joined to `agents` (`agents!inner(id, handle, display_name, kind)`, ordered by `position`) to list who is in the room — used for the header subtitle, mention autocomplete, and delegation pickers. It loads again whenever `refreshKey` changes. `ChatScreen` bumps it on each navigation `focus`, so agents added in room settings show on return.

---

## 🧵 Chat screen (`src/screens/ChatScreen.tsx`)

### Layout

Params `{ roomId, roomName, orgSlug }` (`ChatScreen.tsx:200`). The header shows a back button, the first room agent's Mascot (working state mirrors live streaming), the room name, and a status subtitle: `agentStatus` when set, "Replying…" while any agent message streams, otherwise the comma-joined agent list or "No agents yet" (`ChatScreen.tsx:237-238`, `302-331`). A `SquareTerminal` icon button appears only when `terminalLogs` exist. A `Settings2` **Room settings** button always shows. It opens the web room settings signed in via `WebPageScreen` (path `/<org>/r/<roomId>/settings`): agents, where each runs, the lead, tools and people ([room-settings-ui](../web/pages/room-settings-ui.md)).

If open questions exist for this room (from `useInbox(orgSlug)` filtered by `roomId`), a warn-colored banner reads "<agent> has a question" (or "and others need N answers") and opens a `Sheet` reusing `QuestionCard` from Inbox (`ChatScreen.tsx:332-345`, `555-566`).

### Message list

- The `FlatList` is **inverted**; `items` are built newest-first with day separators ("Today" / "Yesterday" / weekday date) and per-sender grouping flags (`first`/`last`) computed from neighbor equality (`ChatScreen.tsx:222-235`).
- `MessageRow` (`ChatScreen.tsx:83-197`): system messages render as centered pills; human/agent messages as bubbles (`theme.bubbleMine` / `bubbleTheirs`, 20px radius with a flattened tail on the last bubble of a run). Streaming-with-no-content shows `TypingDots`; otherwise `RichText` renders the body. Captions under the last bubble show the time, "Sending…", "Queued · read after the current reply" (messages sent while the agent was mid-reply, tracked in `queuedIds`), "Not sent · long press to copy", or "Stopped with an error".
- **Swipe right to reply**: a `PanResponder` moves the bubble up to 80px, fires `haptic.select()` past 60px, and on release seeds the draft with a quote — `> <first 160 chars>` plus `@handle` for agents — then focuses the input (`ChatScreen.tsx:96-120`, `293-298`).
- Long-press opens an actions `Sheet` with **Copy** (expo-clipboard) and **Reply** (`ChatScreen.tsx:522-545`).
- A "Jump to latest" arrow appears when scrolled away from the bottom (`atBottom` = offset < 80) (`ChatScreen.tsx:389-393`).
- Empty rooms show a "Say hello" footer suggesting `@mentions`. If the room has no agents, it shows "Add agents, pick a lead and connect apps in room settings." with a **Room settings** button.

### Mentions, attachments, sending

- Typing `@text` at the draft's end opens agent-handle autocomplete chips (`mentionQuery` regex on the draft tail); picking one rewrites the tail to `@handle ` (`ChatScreen.tsx:239-240`, `433-449`).
- Above the input, `ChatModelButton` (`components/chat/ModelPicker.tsx`) opens the model picker for every bot in the chat that was made here (invited bots keep their own app's model, and the chip hides when the room has none). It reads `GET /api/mobile/models?orgSlug&roomId` and saves with `POST /api/mobile/models`. "Only this chat" writes this room's override; "Everywhere" changes the bot's default and clears the override. A dot on the chip means this chat has its own pick. Members see the list; only workspace admins can save ("Only workspace admins can change models."). See [Mobile App API](../web/api/api-mobile.md).
- The "+" button opens "Add to message": **Photos** (library, up to 4), **Camera**, **File** (DocumentPicker). Picked files cap at 6 (`ChatScreen.tsx:271-291`, `547-553`). Permissions denied produce explicit errors like "Photo access is off for Sayabot in Settings."
- `send()` uploads each attachment via `uploadToRoom(roomId, file)` and appends `attachmentMarkdown(...)` links to the text before `sendMessage` (`ChatScreen.tsx:246-269`). Upload contract (`src/core/api.ts`):
  - `prepareForUpload` resizes images to a 1600px long side and re-encodes to JPEG at 0.72 quality (GIFs untouched) (`api.ts:54-62`).
  - `uploadToRoom` POSTs multipart `FormData` (`roomId` + `file`) to `{currentWebApiUrl()}/api/mobile/upload` with bearer auth; response `{ url, name, type }` (`api.ts:64-73`).
  - `attachmentMarkdown` yields `![name](url)` for images and `[📎 name](url)` for other files — exactly the two shapes `parseBlocks` recognizes (`api.ts:76-79`).
- Sending while an agent streams queues the message (see the "Queued" caption above).

### Danger-tool approval card

When `approval` is set, a warn-bordered card renders above the composer: `approvalTitle(toolName, args)` produces human phrasing — "Run \"<command>\" on <Mac>?", "Write <file> on <Mac>?", "Use <tool> on <Mac>?" — by reading a hidden `_mac.hostName` marker that steps from agents running on someone's Mac carry (stripped from the JSON preview via `withoutMacMarker`) (`ChatScreen.tsx:573-595`, `395-431`). The raw args JSON (truncated to 240 chars) shows below, with **Allow** / **Don't allow** buttons calling `resolveApproval(true|false)`.

---

## 🖥️ Terminal streaming drawer (`src/components/chat/TerminalDrawer.tsx`)

`TerminalDrawer({ visible, logs, onClose, onClear })` is a bottom-sheet `Modal` (70% height, static dark `colors.codeBg` palette from `src/theme`) titled "Agent Computer Terminal — /home/bot • Persistent Docker Shell" (`TerminalDrawer.tsx:20-82`). It renders each `tool.output` chunk as a selectable green monospace line (`#4ade80`, `fonts.mono`), auto-scrolls to the bottom on content size change, shows "$ Waiting for agent computer shell executions..." when empty, and has Clear (trash) and Close buttons. The logs come straight from `useRoomRealtime().terminalLogs`; `clearTerminal` resets that buffer.

---

## ✍️ Markdown rendering (`src/core/markdown.ts` + `src/ui/RichText.tsx`)

### Block parser (`parseBlocks`)

A pure line-based splitter (unit-tested in `tests/unit/markdown.test.ts`) producing a `Block[]` (`markdown.ts:3-67`):

| Block | Trigger |
| :-- | :-- |
| `code` | Fenced ``` ``` ``` blocks (everything between, joined) |
| `img` | Whole-line `![alt](url)` |
| `file` | Whole-line `[📎 name](url)` (the upload attachment shape) |
| `li` | `- * •` bullets or `1.` / `1)` numbers (mark preserved) |
| `h` | `#`–`####` headings (rendered bold at 17px, no real hierarchy) |
| `quote` | `> ` prefix |
| `p` | Anything else, paragraph-joined |

### `RichText` renderer

`RichText({ text, color?, mine? })` (`RichText.tsx:91-144`) maps blocks to plain RN views for speed:

- **Images** — `ChatImage` renders a 240px-wide thumbnail whose aspect ratio snaps to the loaded image (clamped 0.5–2), tapping opens a full-screen fade `Modal` viewer (`RichText.tsx:29-56`). Source resolution (`imageSource`): if the URL is a Sayabot protected file (`isSayabotFile` = starts with `{currentWebApiUrl()}/api/files/`) and a cached token exists, the bearer token is attached as an image header; otherwise it loads as-is (`RichText.tsx:24-27`; token cache in `api.ts:10-18`).
- **Files** — a row with `FileText` icon opening the link.
- **Links** — `openLink` routes protected `/api/files/...` URLs through `signedInWebUrl(path)`, which builds `{base}/auth/complete?next=…#access_token=…&refresh_token=…` so the web app completes a session handover before showing the file (`RichText.tsx:16-22`; `api.ts:82-89`). Plain URLs open directly.
- **Inline formatting** (`INLINE` regex at `RichText.tsx:13`): `[text](url)` links, `**bold**`, `` `code` `` (Menlo/monospace, slightly smaller, code background), `_italic_`, bare `https?://` URLs, and `@mentions` (accent color). All text is native `Text`, keeping long agent replies fast (`RichText.tsx:8-11`).
- Outgoing bubbles invert the accent: `accent = mine ? fg : theme.accent`, and code/quote tints adapt to `mine` (`RichText.tsx:94-96`).

---

Related docs: [Inbox, tasks & usage](inbox-tasks-usage.md), [Computers & share](computers-and-share.md), [Realtime & events](../architecture/realtime-and-events.md), [Mobile App API](../web/api/api-mobile.md), [Room chat UI](../web/pages/room-chat-ui.md)
