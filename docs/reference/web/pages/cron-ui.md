# Cron & Routines UI (`/cron`, n8n Canvas)

The routines page is an n8n-style visual workflow editor: every routine renders as a three-node chain — Schedule Trigger → Autonomous Brain (agent) → Room Delivery — on a pannable, zoomable dotted canvas with animated bezier edges, next to a plain table "List" view. A slide-out inspector edits the routine's parameters and shows execution history; creation, updates, pausing, "execute now" and deletion all go through the routines REST API under `/api/workspaces/<org>/routines` — this screen uses no server actions at all.

Source files: `apps/web/src/app/(workspace)/[org]/cron/page.tsx`, `apps/web/src/components/cron/n8n-canvas.tsx`

---

## 📥 Page Data (`cron/page.tsx`)

The server component loads four things in parallel:

1. **Routines** — all org routines with their joined `agents (id, handle, display_name, avatar_url, model)` and `rooms (id, name, kind)`; `human_schedule` is derived server-side with `humanReadableCron(schedule_expr)` from `@sayabot/core` (the same helper the room page uses for the side panel's Routines tab).
2. **Rooms** — `listRooms`, filtered to non-DM rooms before being handed to the canvas as delivery targets.
3. **Agents** — `listOrgAgents` mapped to `{ id, handle, displayName, model: agent.model || "standard" }`.
4. **Chat targets** — active `workspace_connectors` of source `telegram | discord | whatsapp`; each connector whose `config.inbound.enabled` is on contributes one `RoutineChatTarget { connectorId, chatId, label }` per **allowed chat id**, labeled like `Telegram · Support bot · 12345`. The page comments: "Chats a routine can also send its results to: the allowed chats of connectors whose chat is turned on (Settings → Connectors → Chat). The orchestrator re-checks all of this."

Everything is handed to the client `<N8nCanvas>` inside a full-height, non-scrolling shell (`flex h-full w-full flex-col overflow-hidden`).

## 🧩 The Canvas (`n8n-canvas.tsx`)

### Toolbar

Header row with a Zap mark, title "Cron Automations & Routines" (subtitle "Hermes-class scheduled autonomous agents & workflows"), a live "N Active | M Total" pill (`routines.filter(r => r.enabled).length` with a pulsing green dot), a routine search box (desktop only; filters by name, `schedule_expr`, and description), a **Canvas / List** view toggle, and a "New Routine" primary button.

### Canvas view (visual editor)

- **Pan & zoom** — mouse-drag panning (elements marked `.no-pan` are excluded from starting a drag) and `Ctrl/Cmd + wheel` zoom:

```typescript
// apps/web/src/components/cron/n8n-canvas.tsx:198
function handleWheel(e: React.WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.1 : 0.1
    setZoom((z) => Math.min(Math.max(z + delta, 0.5), 1.8))
  }
}
```

  A bottom-right control cluster shows the percentage, +/− buttons (same 0.5–1.8 clamp), and Reset (`pan { x: 40, y: 40 }`, zoom 1). The dotted grid background (`radial-gradient` at 24px spacing) scales and shifts with the same transform.
- **Routine selector bar** — with multiple routines, chips (green/grey status dot + name) select the active routine and pan the canvas to its row: `setPan({ x: 40, y: -(idx * 260) + 60 })` (each workflow chain occupies a 260px vertical band).
- **Workflow chains** — each routine renders as a vertical stack of three 288px node cards connected left-to-right by SVG cubic bezier paths (`M 288 y C 336 y, 344 y, 392 y` style) with amber→indigo and indigo→emerald gradient strokes. Enabled routines animate a dashed flow (`@keyframes n8nFlow { from { stroke-dashoffset: 24 } to { stroke-dashoffset: 0 } }`, class `n8n-flow-active`); disabled ones dim to 35% opacity and lose the dash animation.

| Node | Accent | Port pins | Contents |
| :--- | :--- | :--- | :--- |
| **Trigger Node — "Schedule Trigger"** | amber (`border-amber-500/40`) | output (right) | cron expression + timezone chip, human-readable schedule, "Next Execution" time (or "Paused"), inline **Execute now** (▶) and **Pause/Resume** buttons in the header |
| **Agent Node — "Autonomous Brain"** | indigo | input (left) + output (right) | agent avatar/@handle/display name, model badge, 3-line clamped prompt |
| **Action Node — "Room Delivery"** | emerald | input (left) | `#room-name` target channel, `<n> runs` counter, last status (`success` green / `failed` red / other muted) |

  Each card shows a "Workflow: <name>" + Active/Paused chip header above the chain. Clicking any node selects the routine (accent ring) and opens the inspector on the Parameters tab. Empty canvas: "No routines found. Click 'New Routine' to build an automation workflow."

### List view

A 7-column table (Routine + truncated description, Schedule chip (`<Clock> {schedule_expr}`) + human label, Agent `@handle`, Destination `#room`, Next Run (locale-formatted or "Paused"), Active/Paused status chip, row actions: Execute now and Pause/Resume). Clicking a row selects the routine and opens the inspector; action buttons `stopPropagation` so the row click doesn't also fire. Empty state: "No routines found. Click 'New Routine' to create your first automation."

## 🎛️ Inspector Drawer

A right-side slide-out (`fixed inset-y-0 right-0 ... max-w-md`, `slide-in-from-right` animation) for the active routine with a status-dot header (name + `human_schedule`) and two tabs:

- **Parameters & Nodes** — an edit form, deliberately remounted per routine via `key={activeRoutine.id}` ("the fields are uncontrolled (defaultValue), so without this, switching routines kept the previous one's values and saved them over it", `n8n-canvas.tsx:976`). Fields:

| Field | Control | Notes |
| :--- | :--- | :--- |
| Workflow Name | `Input` | required |
| Schedule Expression (Cron or Shorthand) | `Input` | cron or natural language |
| Quick Schedule Presets | 6 chips | write their expr into the input by id lookup: `*/15 * * * *`, `0 * * * *`, `0 */2 * * *`, `0 9 * * *`, `0 9 * * 1-5`, `0 9 * * 1` (`PRESET_SCHEDULES`, `n8n-canvas.tsx:120`) |
| Timezone | `Select` | UTC, America/New_York, America/Los_Angeles, Europe/London, Asia/Kolkata, Asia/Tokyo |
| Assigned Autonomous Agent | `Select` | `@handle - name (model)` |
| Delivery Room | `Select` | includes "Organization General Room" for the empty value |
| Also send results to | `ChatTargetField` select | "Only the room" default; hint when no targets: "Turn on a Telegram, Discord or WhatsApp chat in Settings → Connectors and list its chat ID to send results there." |
| Agent Task Prompt / Instructions | `Textarea` | monospace, required |

  Submit PATCHes `/api/workspaces/<org>/routines/<id>` including `metadata: { deliverTo: deliverToFromForm(form.get("deliver_to")) }` — `deliverToFromForm` splits the `connectorId|chatId` form value into `{ connectorId, chatId }` or `null`, and `null` clears it ("PATCH merges metadata"). Success merges the returned `routine` into local state and toasts.

- **Execution Runs** — fetches `GET /api/workspaces/<org>/routines/<id>` whenever the active routine or tab changes; each `RoutineRun` shows a status chip (success `CheckCircle2` / failed `AlertCircle` / running spinner), start time, output block and red error block. Empty state: "No recorded executions yet. Click 'Execute Now' to test run this workflow."

Bottom action bar: **Execute Workflow Now** (`POST .../run`, disabled while executing), **Pause Routine / Resume Routine** (PATCH `{ enabled: !routine.enabled }`, toast "Routine '<name>' resumed/paused."), and **Delete** (`window.confirm("Are you sure you want to delete this scheduled routine?")` then DELETE, closes the inspector).

## ➕ New Routine Modal

A centered modal form (`max-w-lg`): Routine Name, Schedule ("Cron expr (`0 9 * * 1-5`) or natural shorthand (`daily at 9am`)"), Timezone (same six zones), Target Agent, Target Room (default "General Room"), the chat-target select, and Task Prompt (placeholder "Summarize uncompleted tasks, check git status, and post top 3 priorities for today."). Submit POSTs `/api/workspaces/<org>/routines` with the same `metadata.deliverTo` shape; on success the routine is **prepended** to the local list, selected, and toasted.

## 🔌 API Contract Used by the UI

The screen's mutation flow, end to end:

```mermaid
flowchart LR
    A[Toolbar / node buttons] -->|POST /routines| B[Create modal]
    A -->|PATCH /routines/:id| C[Inspector form]
    A -->|PATCH enabled| D[Pause / Resume]
    A -->|POST /routines/:id/run| E[Execute now]
    A -->|DELETE| F[Delete + confirm]
    B & C & D & E & F --> G[routines table + routine_runs]
    E --> G2[Agent turn enqueued in the room]
    C -->|GET /routines/:id| H[Execution Runs tab]
```| Call | Purpose |
| :--- | :--- |
| `POST /api/workspaces/<org>/routines` | Create (also used by the composer's `/cron` quick action and the bot sidebar's Create schedule) |
| `PATCH /api/workspaces/<org>/routines/<id>` | Edit fields or `{ enabled }`; `metadata` is merged |
| `DELETE /api/workspaces/<org>/routines/<id>` | Delete after confirm |
| `POST /api/workspaces/<org>/routines/<id>/run` | Trigger an immediate run ("Workflow executed immediately! Agent turn enqueued." toast) |
| `GET /api/workspaces/<org>/routines/<id>` | Routine detail + `runs[]` history (also re-pulled after an immediate run) |

These route handlers (auth, validation, scheduling semantics, natural-language schedule parsing) live in `apps/web/src/app/api/workspaces/[org]/routines/` and are documented with the other route handlers under `docs/reference/web/api/`. All mutations re-render purely from API responses plus local state — there are no server actions or `router.refresh()` calls in this screen.

## 🧵 Related Surfaces

- **Room side panel → Routines tab** — the per-room list of routines posting into that chat (see [room chat UI](./room-chat-ui.md)), fed by the page's own `loadRoomRoutines` query limited to 20.
- **Composer quick action** — the chat composer's Schedule button and `/cron` command open a reduced create-dialog that POSTs to the same endpoint (same field names: `name`, `schedule_expr`, `agent_id`, `room_id`, `prompt`).
- **Onboarding** — the wizard's help note explains the two weekday stand-ups that `room_schedules` create; those meeting-based stand-ups are separate from `routines` and are managed in room settings (`saveRoomScheduleAction`) and the meetings page.

---

## Related docs

- [Room chat UI](./room-chat-ui.md) — where routine results are delivered and the Routines tab lives
- [Settings UI](./settings-ui.md) — the connectors whose inbound chats become delivery targets
- [Tasks, Inbox & Meetings UI](./tasks-inbox-meetings-ui.md) — meeting stand-ups vs cron routines
- [Onboarding](./onboarding.md) — `saveRoomScheduleAction` for the stand-up schedule
- ../../database/schema-routines-and-meetings.md — `routines`, `routine_runs`, `room_schedules`
- ../../architecture/turn-lifecycle.md — what an enqueued routine turn executes
- ../../architecture/realtime-and-events.md — how results broadcast into rooms
- The routines REST endpoints are documented under `docs/reference/web/api/`.
