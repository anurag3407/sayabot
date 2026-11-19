# Search, Files & Storage

Three read-oriented screens round out the workspace's "find things" surface. `/[org]/search` is a full-message search over the rooms you can read. `/[org]/files` indexes every room canvas as a file card (markdown, code, SVG, HTML). `/[org]/settings/storage` breaks the workspace's footprint down by category, agent and chat — including what agents keep on your own computers.

Source files: `apps/web/src/app/(workspace)/[org]/search/page.tsx`, `apps/web/src/app/(workspace)/[org]/files/page.tsx`, `apps/web/src/app/(workspace)/[org]/settings/storage/page.tsx`, `apps/web/src/components/ia/files-view.tsx`, `apps/web/src/components/storage/storage-view.tsx`, `apps/web/src/lib/queries-ia.ts` (`loadFiles`, `searchMessages`)

---

## 🔎 Workspace Search (`search/page.tsx`)

A server component with **no client JS state**: the form is a plain GET form (`action="/<org>/search"`, input named `q`), so the query lives entirely in the URL.

- Query handling (`search/page.tsx:41-42`): trimmed, hard-capped at 200 chars; results only run when the query is at least 2 characters (1 char shows "Type at least two characters.").
- `searchMessages(access, query)` (see below) returns at most 50 results, newest first. When exactly 50 come back, the result count reads "first 50 results".
- Each hit links to `/<org>/r/<roomId>?m=<id>` — using `threadRootId ?? id` as the anchor, so a hit inside a reply jumps to the whole thread and adds `&thread=1` to open the thread sheet.
- The `Snippet` helper (`search/page.tsx:12-29`) flattens whitespace, finds the first case-insensitive occurrence of the query and renders an 80-chars-before / 120-chars-after window with the match wrapped in `<mark>`; without a match it shows the first 220 chars.

### `searchMessages` (`lib/queries-ia.ts:766`)

Server-only query scoped to what the person can read:

1. `readableRooms(access.org.id)` determines the room set; empty → no results.
2. The LIKE pattern escapes `\`, `%`, `_` before interpolation, then filters `messages` by `room_id IN (readable)`, `sender_type != "system"`, `ilike(content, pattern)`, ordered `created_at DESC`, `SEARCH_LIMIT = 50`.
3. Sender names are resolved in parallel from `listMemberViews` (humans) and `listOrgAgents` (agents); unresolved senders show "Unknown", missing rooms "room".

Access enforcement: the room allowlist comes from membership; Row Level Security on `messages` provides the second layer (module docstring).

## 🗂️ Files (`files/page.tsx` + `components/ia/files-view.tsx`)

The Files page treats **every room canvas as a file**. The server page loads `loadFiles(access)` and `listRooms(org.id)` in parallel and hands both to the client `<FilesView>`.

### `loadFiles` (`lib/queries-ia.ts:648`)

- Again scoped to `readableRooms`; selects the 200 most recently updated `canvases` (`id, room_id, kind, title, language, snapshot_text, updated_at`).
- Builds a 180-char single-line `preview` from `snapshot_text` per canvas.

### `FilesView` (client)

- **Filters, all client-side**: kind chips (`all` / `markdown` / `code` / `svg` / `html`, each showing its count), a room `<select>` ("All rooms" + each room), and a text search over title, preview and room name (`files-view.tsx:58-70`).
- **Cards** link to `/<org>/r/<roomId>?canvas=<fileId>` — deep-linking straight into the canvas panel of that room. Each card shows a mono glyph per kind (`#` markdown, `{ }` code, `△` svg, `<>` html), title, kind/language/room line, a relative `updatedLabel` (minutes/hours/days, then a short date), and a 3-line clamped preview ("Empty file" when blank).
- **Header copy** explains the model: "Every room canvas is a live file… Humans and agents edit the same document; versions are kept server-side." The footer notes files are scoped to rooms and follow room membership, with agent edits attributed in canvas version history.
- **Empty states**: "No files yet" (open a room and create a canvas) vs "No files match" (change filters).

See [Canvas UI](./canvas-ui.md) for the editor these cards open, and `lib/types.ts` `FileView` (`id, roomId, roomName, kind: CanvasKind, title, language, preview, updatedAt`) for the data shape.

## 💾 Storage (`settings/storage/page.tsx` + `components/storage/storage-view.tsx`)

Lives in the settings section tree but is a full analysis screen. `force-dynamic` because it re-measures on load.

### Server page

- Calls the Postgres function `storage_summary` via `supabase.rpc("storage_summary", { p_org })`. **On error the summary is `null`** and the UI shows the "unavailable" warning: "Storage can't be measured until the latest database migration runs (pnpm db:migrate)." (`page.tsx:36`, `storage-view.tsx:95-99`).
- The RPC returns `measured_at`, five category buckets (`chat`, `files`, `memory`, `tools`, `computers` — each `{ bytes, count }`), per-agent rows (`chat_bytes, messages, memory_bytes, memories, computer_bytes`), and per-room rows (`bytes, messages, files`).
- Categories are mapped to fixed colors: Chat history `#5b9df5`, Files & canvases `#4fcdb0`, Agent memory `#b79cf0`, Tool activity `#f2c14e`, Agent computers `#ff7a70`.
- Agent bytes = `chat_bytes + memory_bytes + computer_bytes`, sorted descending; rooms are filtered to non-zero bytes and resolved to names via `listRooms` ("Chat" when missing).
- **Computers**: reads the signed-in user's own non-revoked `desktop_hosts` (`id, name, storage`); each host's `storage` JSON (`measuredAt`, `appData.bytes`, `agents: [{ handle, bytes, files }]`) is reported by the Mac app itself.

### `StorageView` (client)

Header: the workspace total (`formatBytes`, `lib/format.ts`), "Measured HH:MM" (or "Not measured yet"), and a **Measure again** button that simply `router.refresh()`es in a transition — re-running the server measurement.

- **Stacked category bar** (`role="img"`, aria-label "Storage by type") with a legend grid: color dot, label, bytes, and a percentage (`pct()` renders "<0.1%" for tiny shares).
- **Agents**: rows with `Mascot seed={handle}`, message and memory counts, a relative `Bar` against the largest agent, bytes and workspace share.
- **Largest chats**: name, message/file counts, bytes.
- **On your computers**: one card per desktop host — total (app data + agent folders), "Measured …" or "Open the Sayabot app on it to measure", and up to 8 `~/Sayabot/agents/<handle>` folder lines with bytes and file counts.

The module header calls this "OpenBot-style storage: one total, a stacked bar, then what takes the space by agent and by chat."

### Cloud Storage Providers (`components/storage/cloud-storage-manager.tsx`)

Rendered at the top of the Storage settings page (`settings/storage/page.tsx`), allowing admins to connect, test, and manage persistent cloud object storage for workspace agents:

- **Supported Providers**:
  - **Supabase Storage**: Instant 1-click connection using workspace default credentials (`connectBuiltinSupabaseStorage`) or zero-copy Supabase OAuth (`/api/connectors/supabase/oauth`), auto-provisioning the `sayabot-storage` bucket, or manual Service Role Key + Project URL.
  - **Cloudflare R2**: Free-tier S3-compatible object storage via Access Key ID, Secret Access Key, Account ID, and Bucket (`https://<account_id>.r2.cloudflarestorage.com`).
  - **Backblaze B2**: S3-compatible storage via Key ID, Application Key, Endpoint, and Bucket.
  - **Custom S3 / MinIO / Ceph**: Generic S3-compatible endpoints with Region and custom credentials.
  - **Hugging Face Hub**: Free dataset & model repository file storage via user Access Token (`hf_...`).
- **Connection Testing**: Each card and connected provider row provides a real-time "Check / Test Connection" button triggering `testWorkspaceConnector`, testing bucket accessibility (`HeadBucket` / `ListObjectsV2` / Supabase REST API) and displaying live status badges.
- **Agent Storage Configuration**:
  - **Agent Profile (`agent-connector-scope.tsx`)**: Admins can assign storage connector grants to specific agents, toggling read-only restrictions and scoping access to specific folder prefixes (`allowedPrefixes`).
  - **Room Agent Sidebar (`agent-config-panel.tsx`)**: Users configure which storage connector each agent uses directly from the room chat tools panel (`setAgentStorageProviderAction`), enabling or switching the agent's cloud storage backend seamlessly.

## Related docs

- [Canvas UI](./canvas-ui.md) — the canvases the Files page indexes and deep-links into
- [Room chat UI](./room-chat-ui.md) — the `?m=` message anchors and `?canvas=` deep links land here
- [Settings UI](./settings-ui.md) — the settings layout that hosts the storage page
- [App overview](./app-overview.md) — org layout and access model
- [Analytics / Usage UI](./analytics-usage-ui.md) — the other measurement screen (usage instead of bytes)
- [lib-reference](./lib-reference.md) — `format.ts` (`formatBytes`) and other helpers
- ../../architecture/security-model.md — RLS and readable-room scoping
- ../../database/schema-rooms-messages-canvas.md — `messages` and `canvases` tables
- ../../database/schema-memory.md — memory rows counted under "Agent memory"
