# lib Reference (`apps/web/src/lib`)

The grab-bag of shared client/server modules behind the web app: browser notifications and push, the offline outbox, message insert/shape helpers, the ask/answer protocol, bot DM rooms, failure recovery hints and tool-call copy, URL/origin safety, the web-update bus, the workspace activity feed, desktop/Mac bridges, local agent detection, Supabase clients, route guards, environment access, and the shared view types.

Source files: `apps/web/src/lib/*` (`notify.ts`, `push-client.ts`, `outbox.ts`, `message-send.ts`, `message-map.ts`, `answer-requests.ts`, `bot-dm.ts`, `agent-handle.ts`, `recovery-hint.ts`, `tool-summary.ts`, `safe-next.ts`, `public-origin.ts`, `mcp-client.ts`, `connectors/probe.ts`, `web-update.ts`, `use-workspace-change.ts`, `use-workspace-activity.ts`, `workspace-import.ts`, `desktop-bridge.ts`, `desktop-hosts.ts`, `local-agents.ts`, `local-agents-shared.ts`, `mac-runner.ts`, `mac-runner-shared.ts`, `mac-plans.ts`, `works-on.ts`, `runs-on.ts`, `supabase/*`, `route-auth.ts`, `route-bearer.ts`, `types.ts`, `env.ts`), `apps/web/src/components/use-workspace-activity.ts`

Modules covered elsewhere: `format.ts`, `datetime.ts`, `human-handle.ts`, `image-avatar.ts`, `brand-logos.ts` in [UI shell & kit](./ui-shell-and-kit.md); `usage.ts`, `usage-math.ts`, `usage-summary.ts` in [Analytics / Usage UI](./analytics-usage-ui.md); `computers.ts`, `computer-settings.ts` in [Computers & remote UI](./computers-remote-ui.md); `marketplace.ts`, `marketplace-catalog.ts` in [Marketplace](./marketplace.md); `queries.ts`, `queries-ia.ts` inline with the pages that use them.

---

## 🔔 Notifications & Push

### `notify.ts` (client)

- `desktopNotify({ title, body, tag, url })` — shows a desktop notification when permission is granted. Tries the page `Notification` API first (click focuses and navigates to `url`); on Android Chrome (where page notifications are blocked) it falls back to `registration.showNotification` on the service worker. Entirely best-effort — "the Inbox still holds the item".
- `softBeep()` — a 70 ms sine beep at 740 Hz, gain 0.035, via `AudioContext`/`webkitAudioContext`; silent no-op when autoplay policy blocks it. Used for mention/approval sounds alongside toasts.

### `push-client.ts` (client)

`subscribeToPush()` registers Web Push for alerts when no tab is open. Returns `false` (quietly) when `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is unset or `PushManager` is unsupported; otherwise reuses the existing subscription or subscribes with `userVisibleOnly: true` and the VAPID key (URL-base64 decoded), then `POST`s the subscription JSON to `/api/push`. Delivery itself is the service worker's `push` handler (see [App overview](./app-overview.md)).

## 📮 Offline Outbox & Sending

### `outbox.ts` (client)

IndexedDB queue (`idb-keyval`, key `mesh:outbox:v1`). `OutboxItem = { id, orgSlug, roomId, content, threadRootId, createdAt }`. `readOutbox` / `enqueueOutbox` (dedupes by `id`) / `flushOutbox`, which replays each item as a `POST /api/messages` with `clientId: item.id`; removes items on success or on definitive 400/404, keeps them (counted as `failed`) on transient errors. Returns `{ sent, failed }`. Message composition offline waits here, per the offline page.

### `message-send.ts` (server-only)

`insertHumanMessage({ supabase, userId, roomId, content, threadRootId?, clientId? })` — the one validated path for human messages:

- Content 1–100,000 chars; room and thread ids must be UUIDs.
- Thread roots are normalized (the root's own `thread_root_id ?? id`) and verified to belong to the room.
- **Client-id dedup**: if `metadata->>clientId` already exists for this sender+room, the existing id is returned — this is what makes outbox replay and optimistic sends idempotent.
- Inserts `sender_type: "human"`, `status: "complete"`, `mentions: extractHandles(content)` (from `@sayabot/core`), and `metadata.clientId` truncated to 80 chars.

### `message-map.ts` (shared)

Row → view mapping for chat rendering: `messageFromRow(row, lookup)` builds `MessageView` with sender resolution (agent display name/handle, member display name, or the fallbacks "system", "Removed agent", "Former member"); `toolCallFromRow` maps `tool_calls` rows to `ToolCallView`; `sortMessages` / `sortToolCalls` order by `createdAt`. Types `RawMessageRow` / `RawToolCallRow` pin the DB shape.

## 🙋 Ask/Answer Protocol

### `answer-requests.ts` (server-only)

`answerRequestsAs(who, input)` — the shared engine behind answering agent questions from the web Inbox (session client) and the phone app (bearer client, via `who.client`). Accepts either a single `{ taskId, answer?, itemAnswers?, alsoPost? }` or a batch `answers[]`. Per item (answer capped at 4,000 chars):

- Loads the task; only `kind === "request"` tasks not already `done` proceed; requires room access via `getRoomAccess` (with the caller's own client when given) and, when the request was addressed to someone else, `canAdmin`.
- **Target room**: the asking agent's DM via `ensureBotDmRoom` unless `alsoPost` posts back to the task's room.
- **Keyed questions** (`askItemsFromMetadata`): each answered key is upserted as a fact (`upsertFact`), delivery handled by `deliverItemAnswers`, and the question stays open until every item is filled (a free-text note with no remaining items closes it).
- **Plain answers**: inserts a human message (prefixed `@<agent.handle>` when posting in the group), `queueRoomMessage` triggers the orchestrator, and the task is completed through `mutateTaskInOrchestrator` with `outcome: { kind: "decision", ref: messageId }` and full answer metadata.
- Audits `request.answered` per item; afterwards `resolveOpenAsksFromFacts` fills other open questions in the touched rooms waiting on the same keys.

### `bot-dm.ts` (server-only)

`ensureBotDmRoom({ orgId, userId, agentId, agentName })` — finds or creates the private user↔agent DM room (`kind: "dm"`, `agent_dm_user_id`/`agent_dm_agent_id`, mentions mode, turn cap 3, UTC). Creation adds the user as room admin, attaches the agent, seeds `room_reads`; a unique-violation race re-reads the winner. `letScopedKeysReachDm` then extends every non-revoked `agent_api_keys.room_ids` for that agent with the DM id — "otherwise a private answer from the Inbox would never reach" an outside bot whose key is scoped to invited rooms.

## 🧯 Failure UX Helpers

### `recovery-hint.ts` (shared)

Maps failed-turn errors to fixes: `recoveryHint({ text, reason, orgSlug, roomId, kind })` returns `{ label, href? }` or `{ label, action: "switch_model" }` (which raises `MODEL_PICKER_EVENT = "sayabot:open-model-picker"` in the room title bar). Engine error kinds (`metadata.errorKind` from the orchestrator's `classifyEngineError`): `context_overflow`/`quota_exhausted`/`refusal`/`mac_offline`/`mac_removed` → "Switch model"; `auth_error` → settings/keys; `runner_off` → settings/computers. Regex fallbacks cover provider-key, unknown-model and rate/budget failures (→ room settings). `retryHelps(kind)` is false for the deterministic failures (`RETRY_WONT_HELP`); `RETRYABLE_REASONS` = `agent_error`, `moderator_error`.

### `tool-summary.ts` (shared)

Human copy for approval cards: `describeToolCall({ toolName, input, agentName })` → e.g. "Hermes wants to run code in a sandbox: “deploy.sh --env production”." using a `KNOWN_TOOLS` map for built-ins, mcp-prefix stripping for others, and the first interesting string arg (`DETAIL_KEYS`) truncated to 90 chars. Also `APPROVAL_WINDOW_MS = 5 * 60_000`, `approvalMsLeft(createdAt, now)` and `formatCountdown(ms)` for the 5-minute approval countdown.

## 🔗 URL & Origin Safety

### `safe-next.ts` (shared)

`safeNextPath(value, fallback)` — same-origin redirect sanitization used by the login redirect: requires a leading `/`, rejects `//…`, and — because browsers normalize backslashes to slashes — rejects any `\`; also rejects control characters (≤ 0x1F and 0x7F). Unit-tested in `tests/unit/*` and exercised by the middleware gate.

### `public-origin.ts` (shared)

`getPublicOrigin(request?)` — the public address for OAuth callbacks and external redirects: prefers `x-forwarded-host`/`x-forwarded-proto` (reverse proxies, tunnels), then the request URL's origin, then `NEXT_PUBLIC_SITE_URL`/`NEXT_PUBLIC_APP_URL`, defaulting to `http://localhost:7431`. Any `0.0.0.0` (a bind address Chromium refuses) is rewritten to `localhost`.

## 🔄 Update & Activity Buses

### `web-update.ts` (shared)

The single bus behind exactly one update toast per deploy: `onWebUpdate(listener)` lets the workspace's update card claim the notification; `reportWebUpdate()` notifies listeners and returns `false` when nobody is listening — telling the PWA prompt to show its own toast. Consumed by `update-notification.tsx` and `pwa-update-prompt.tsx`.

### `use-workspace-change.ts` (client)

Window-event bus plus hook: `emitWorkspaceChange(table)` (`mesh:workspace-change`) for `tool_calls` / `tasks` / `messages`; `requestActivityRefresh()` (`mesh:activity-refresh`) asks the sidebar to re-fetch now; `useWorkspaceChange(tables, onChange)` re-runs `onChange` (debounced 400 ms) when a matching table changes anywhere. Screens that mutate data call `emitWorkspaceChange` so lists refresh without router.refresh.

### `components/use-workspace-activity.ts` (client)

The sidebar's live feed (see [UI shell & kit](./ui-shell-and-kit.md) for its consumer). Keeps `chats`/`inboxCount` state, refreshed by `GET /api/workspaces/<org>/activity` (no-store) — debounced 1.2 s, also on window focus and `ACTIVITY_REFRESH_EVENT`, with a 30 s fallback poll only while realtime isn't subscribed. Subscribes to one Supabase realtime channel (`workspace-activity:<user>:<org>`) after `setAuth(access_token)`:

- `messages` INSERT/UPDATE → schedule refresh; for complete, non-system messages from others in non-muted rooms you're not reading: desktop notification when the tab is hidden, or (settings permitting) a sound + "You were mentioned in <room>" toast with an Open action when mentioned. Per-row `alerted` set prevents duplicates.
- `tool_calls` * → refresh + `emitWorkspaceChange("tool_calls")`; new `pending_approval` rows visible to an approver (org role owner/admin or an admin of that room via `adminRoomIds` from the activity API) raise "Approval needed in <room>. It expires in 5 minutes." (desktop notification when hidden, 20 s toast otherwise) with `describeToolCall` copy.
- `tasks` * → refresh + `emitWorkspaceChange("tasks")`.
  Row Level Security decides which changes reach this browser, so only readable rooms arrive.

## 🖥️ Desktop & Mac Bridges

### `desktop-bridge.ts` (client)

Typed access to what the Sayabot Mac app adds to `window.sayabotDesktop` for usage data (older apps lack these calls — every caller checks first): `canReadPlanLimits()` / `readPlanLimits(force)` (validated `PlanLimits[]` from `@sayabot/core/scanner`), `canReadLocalUsage()` / `readDesktopLocalUsage(days)` (coding-tool `RawEvent[]`), and `resetsIn(iso)` ("in 2h 14m", "soon"). Null in a normal browser.

### `desktop-hosts.ts` (server-only)

Mac-host registry helpers shared with the desktop API: the `HostRow` shape (with `settings.whoCanControl | askOnComputer | runnerEnabled | localDefault`), constant-time `hostFromRequest` (`x-host-id` + `x-host-token` hashed and compared via `hashAgentApiKey`, revoked hosts rejected), `orgRoleOf`, `pickDefaultApp` (ready-first order `claude-code → codex → gemini → opencode → cursor`), `withLocalDefault` (auto-enables the local runner the first time a signed-in CLI appears; once the owner opts out, `localDefault === false` is left alone), and `macDefaultApp(userId)` for onboarding's "no key needed" option. Documented further in [Computers & remote UI](./computers-remote-ui.md).

### `local-agents-shared.ts` (client-safe)

The app list and status logic, importable from the browser: `LOCAL_AGENT_APPS` (claude-code, codex, gemini, opencode, cursor — binary `cursor-agent`, mac app `/Applications/Cursor.app`, hermes, antigravity) each with provider icon key and `inviteApp`; `localAgentStatus({ installed, signedIn })` → `ready | signed_out | installed | not_installed` (signedIn `null` means "can't tell"); `LOCAL_STATUS_LABEL`; `reportedAgentsToReports(raw)` converts what the Mac app reported in its heartbeat into the same rows (dropping uninstalled apps, adding Ollama/LM Studio as local model servers); types `LocalAgentReport` / `LocalAgentsResponse` (with `source: "server" | "mac"`).

### `local-agents.ts` (server-only)

`detectLocalAgents()` — filesystem/keychain detection of coding CLIs on this machine, "we never read or send the credentials themselves": binaries searched across `PATH`, common bin dirs, nvm/volta; sign-in checks per app (`.claude/.credentials.json` or `oauthAccount` key or keychain service `Claude Code-credentials`; `.codex/auth.json`; `.gemini/oauth_creds.json`; `CURSOR_API_KEY` or keychain `cursor-access-token`; `.local/share/opencode/auth.json`; `.hermes/config.yaml`), macOS Keychain probed with `security find-generic-password -s` only (no `-w`, so the secret is never printed); version via `--version`, plus Codex's `models_cache.json` for its model list. `localDetectionAllowed(host)` gates it to localhost deployments unless `SAYABOT_LOCAL_DETECTION` is `1` (`0` disables even then).

### `mac-runner-shared.ts` (client-safe)

The browser-safe half of Mac-run tool cards: `MacMarker` (the hidden `_mac` args marker the orchestrator attaches: `key, jobId, hostId, hostName, ownerId, agentId`), `readMacMarker`, `withoutMacMarker`, `describeMacStep(toolName, args)` ("Run `npm test` on Anurag's MacBook", file edits, web fetches, MCP tool calls…), `macAllowRuleFor(toolName, args)` — the "Always allow" rule in Claude Code's `--allowedTools` syntax (`Bash(npm test:*)` for the command's leading words, `WebFetch(domain:host)` per site, tool name for edits/MCP; chained commands (`;&|` backticks, redirects), `sudo`, `rm`, or >200-char commands can only be allowed once), and `macAllowLabel`.

### `mac-runner.ts` (server-only)

`macAllowRules(params)` — validates the agent's saved `params.localAllow` rules (`^[A-Za-z][\w-]{0,80}(\([^()\n]{1,200}\))?$`, max 50). `macApprovalBlock(args, userId)` — only the Mac's owner may approve its steps ("an admin of a shared room must not be able to run commands on someone else's computer"); revoked hosts fail outright. `rememberMacAllow(args, toolName)` — persists the narrowest rule onto the agent's `params.localAllow` (deduped, capped).

### `mac-plans.ts` (client)

`withMacPlans(groups, limits)` — merges the Mac app's plan-limit readings into the model picker's "mac" section groups (claude → Claude, codex → Codex) so you see remaining capacity before picking. Only when exactly one Mac host is present ("with more than one Mac in the workspace we can't tell which group is this one").

## 🤖 Bot Metadata Helpers

### `works-on.ts` (shared)

`WORKS_ON_OPTIONS` — the canonical "where the agent process runs" choices and their copy: `auto` (reuse a ready desktop, never wakes a Boat), `this_computer` (this Mac's screen and apps), `local_vm` (container desktop on this Mac), `boat` (hosted desktop at boat.dev, sleeps after 10 idle minutes, files in `/home/user`), `vps` (Docker over SSH on the user's own server — Sayabot never turns it off), `off`.

### `runs-on.ts` (shared)

`appName(app)` maps app ids to names (Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Ollama, LM Studio). `runsOnLabel(agent)` — the one-line "why it answered like that" under bot pages and replies: "Claude Code · claude-opus-5-5 on your Mac" (runner hostId), "… on the server" (`runner.where === "server"`), "<model> · API key" (a provider key), "<model> · Sayabot" or "Sayabot's model". `replySourceLabel(metadata)` derives the same from a reply's own metadata (`runsOn`, `model`, `where === "mac"`).

### `agent-handle.ts` (shared)

`handleFromName(name)` — suggests a valid agent @handle from a display name (NFKD + diacritic strip, slugify, must start with a letter, cap 39). See also `human-handle.ts` in [UI shell & kit](./ui-shell-and-kit.md).

## 📦 Workspace Import

### `workspace-import.ts` (server-only)

`restoreWorkspaceCopy(orgId, incoming)` — inserts a Mac's bots, chats, routines and sealed keys into a workspace ("A row that is already here is left as it is"). Reads existing ids, then `materializeCopy` (from `@sayabot/core`) plans the migration; inserts provider keys as ciphertext/iv/tag/last4 envelopes, agents, rooms with their messages, routines, and optionally the org's sealed Boat/VPS computer settings.

## 🗄️ Supabase Clients

| Module               | Environment          | Client                                     | Notes                                                                                                         |
| :------------------- | :------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `supabase/admin.ts`  | server-only          | service role (`SUPABASE_SERVICE_ROLE_KEY`) | module-level singleton, `persistSession: false`; bypasses RLS — every caller must authorize in code           |
| `supabase/server.ts` | server (RSC/actions) | anon key + server cookie jar               | `cookies()` read/write; writes fail silently in RSC (the proxy refreshes instead)                             |
| `supabase/client.ts` | browser              | `createBrowserClient` (anon key)           | singleton for realtime + client auth                                                                          |
| `supabase/proxy.ts`  | middleware           | anon key + request/response cookie jars    | `updateSession(request)` → `{ response, user }`; missing env throws; rotates expired tokens onto the response |

## 🛂 Route Guards

- **`route-auth.ts`** (server-only): `requireRouteUser()` — the signed-in user for connector route handlers or a ready-to-return 401 `NextResponse` ("Sign in required"). "Connector routes spend server credentials and proxy third-party auth, so none are anonymous."
- **`route-bearer.ts`** (server-only): `userFromRequest(request)` — dual auth for API routes: an `Authorization: Bearer <token>` header (the phone app sends its Supabase access token) is validated through a purpose-built client; otherwise the session cookie client. Returns `{ user, client }` where the client carries that person's RLS, so reads stay scoped — used by `/api/remote/*`, `/api/mobile/*`, etc.

## 🌍 Environment (`env.ts`, server-only)

Typed accessors that throw when required values are missing:

| Accessor                                | Env                                                          | Default                                |
| :-------------------------------------- | :----------------------------------------------------------- | :------------------------------------- |
| `getSupabaseUrl` / `getSupabaseAnonKey` | `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — (required)                           |
| `getServiceRoleKey`                     | `SUPABASE_SERVICE_ROLE_KEY`                                  | — (required)                           |
| `getKek`                                | `SAYABOT_KEK` or legacy `MESH_KEK`                           | — (required; AES-256-GCM envelope key) |
| `getOrchestratorUrl`                    | `ORCHESTRATOR_URL`                                           | `http://localhost:4000`                |
| `getComputerdUrl`                       | `COMPUTERD_URL`                                              | `http://localhost:4100`                |
| `getInternalSecret`                     | `ORCHESTRATOR_INTERNAL_SECRET`                               | — (required)                           |
| `getCollabUrl`                          | `NEXT_PUBLIC_COLLAB_URL`                                     | `ws://localhost:4000/collab`           |
| `getAppUrl`                             | `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL`               | `http://localhost:7431`                |

Feature/edition helpers: `sayaAi()` (the operator's Saya AI provider from `SAYA_AI_*` or legacy `DEV_OPENAI_COMPAT_*`, re-read per request) and `sayaAiPublic()` (names/aliases only — never the key — safe for clients); `devModelConfigured()`; `ssoEnabled()`, `githubAuthEnabled()`, `googleAuthEnabled()` (each from `*_ENABLED` including `NEXT_PUBLIC_*` forms); `desktopGuestModeEnabled()` (on unless `DESKTOP_GUEST_MODE=false/0/off`); `edition()` (`self-hosted` default vs `cloud`); `instanceName()` (`SAYABOT_INSTANCE_NAME` capped at 60 chars, else "Sayabot").

## 📐 Shared View Types (`types.ts`)

Every screen's data shape lives here (548 lines). Key unions: `OrgRole`/`RoomRole`, `RoomKind` (`public | private | dm`), `TurnMode` (`mentions | debate | moderated`), `SenderType`, `MessageStatus` (`streaming | complete | error | halted`), `CanvasKind` (`markdown | code | svg | html`), and `ToolCallStatus` (`pending_approval | approved | rejected | running | done | error`). Key interfaces: `OrgAccess`/`RoomAccess` (what `requireOrgAccess`/`getRoomAccess` return), `RoomView`, `AgentView`, `MessageView`, `ToolCallView`, `CanvasView`/`CanvasVersionView`, `TurnStateView`, `MemberView`, `ProviderKeyView`, `McpServerView`, `AgentApiKeyView`, `AuditLogView`, `ChatListItem` (sidebar row: unread/mention counts, pinned, mutedUntil, archived, isBotDm), `TaskView` + `TaskCommentView`/`TaskEventView`, the Inbox family (`InboxApprovalView`, `InboxRequestView`, `DecisionPacketView`, `BotJoinRequestView`, `OwnerFactView`, `InboxDoneView`), `FileView`, `MeetingView`/`RoomScheduleView`, `RoomPageData` (the room screen's payload), `ActionResult` (`{ ok, error?, message?, warning?, data? }` — the universal server-action return), and the trace family `RunStepKind`/`RunStepView`/`RunTraceView` (see [Trace](./trace-observability.md)).

## Related docs

- [App overview](./app-overview.md) — the middleware and service worker these modules plug into
- [Auth flows](./auth-flows.md) — `safeNextPath`, session refresh and the auth screens
- [Room chat UI](./room-chat-ui.md) — `message-send` / `message-map` / `recovery-hint` consumers
- [Tasks / Inbox / Meetings UI](./tasks-inbox-meetings-ui.md) — the Inbox that `answer-requests` serves
- [Computers & remote UI](./computers-remote-ui.md) — desktop hosts and remote sessions
- [UI shell & kit](./ui-shell-and-kit.md) — the sidebar that consumes `use-workspace-activity`
- [Analytics / Usage UI](./analytics-usage-ui.md) — `desktop-bridge` consumers (plan rings, local usage)
- ../../architecture/configuration.md — the env vars `env.ts` reads
- ../../architecture/auth-and-authorization.md — Supabase auth model behind these clients
- ../../architecture/realtime-and-events.md — the realtime feed the activity hook subscribes to
