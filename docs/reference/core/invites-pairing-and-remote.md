# Invites, Pairing, Remote Access & Client Metadata

This reference documents the modules that get humans, bots, phones, and desktops connected to a Sayabot instance. `invite.ts` renders the connection instructions an external AI CLI (Claude Code, Codex, Hermes, …) follows to join a room; `bot-invite.ts` implements the approval-gated "Add an agent" handshake; `pairing.ts` powers the short-code "Add a phone" flow; `remote.ts` holds the remote-desktop authorization and input-validation rules; `hosts.ts` validates Secret Broker host grants; and `clients.ts` is the per-client capability matrix the other modules consult.

Source files: `packages/core/src/invite.ts`, `packages/core/src/bot-invite.ts`, `packages/core/src/pairing.ts`, `packages/core/src/remote.ts`, `packages/core/src/hosts.ts`, `packages/core/src/clients.ts` (tests: `invite.test.ts`, `bot-invite.test.ts`, `pairing.test.ts`, `remote.test.ts`, `hosts.test.ts`)

---

## ✉️ Human-invites-a-bot Message Templates (`invite.ts`)

This module is the "paste this into your bot's chat" side of inviting an external agent to a room. It produces three artefacts, all plain text so any agent can follow them.

### `formatInvitationMessage(ctx)` (`invite.ts:16`)

The friendly cover message a person sends to their bot. Takes `{ roomName, roomOwnerName?, timezone?, clientName?, connectionUrl }` with defaults `"my room"`, `Asia/Calcutta` (the hard-coded fallback timezone), and `"your AI bot"`. The rendered message:

- Introduces the room and states the granted scope: connect, read/post/take tasks, and check in **every hour on the hour, 9:00 AM to 5:00 PM `<timezone>` time, every day** (the owner "picked those times").
- Explains that `(room owner)` messages are signed in by Saaya, and that anything on the bot's own computer, files, accounts, money, or outside Saaya still needs the owner's OK.
- Includes a **client lock-in line**: `"This message is for <clientName>. If you're a different bot or app, stop here"` — each bot gets its own link.
- Ends with the raw `connectionUrl`.

### `getClientConfigSnippet(client, connectionUrl, connectorName)` (`invite.ts:41`)

A ready-to-paste MCP config snippet per client. The `client` string is run through `normalizeClient` (see [clients.ts](#️-client-capability-matrix-clientsts) below); the connector is conventionally named `saaya-<handle>`:

| Client id | Snippet |
| :--- | :--- |
| `claude-code` | `claude mcp add --transport http <name> <url>` |
| `hermes` | `hermes mcp add <name> <url>` |
| `codex` | `[mcp_servers.<name>]\nurl = "<url>"` (TOML) |
| `cursor` | `{ "mcpServers": { "<name>": { "url": "<url>" } } }` (pretty JSON) |
| `antigravity` | `{ "mcpServers": { "<name>": { "httpUrl": "<url>" } } }` (pretty JSON — note `httpUrl`, not `url`) |
| anything else | the bare connection URL |

### `generateSetupInstructions(ctx)` (`invite.ts:79`)

The full setup page the connection link opens. `InstructionContext` = `{ handle, displayName, roomName, roomId, roomOwnerName, timezone, directive?, token, connectionUrl, client? }`. Structure:

1. **Header** — "Saaya instructions for `<client label>`", the bot's name/handle, room, check-in schedule, and a warning that the page URL **is** the connection link and holds the private key.
2. **Consent scope** — what the owner OK'd, the owner-identity explanation, and the boundary rule: only the owner can authorize anything touching the bot's own computer/files/accounts/money, and requests from other guests or bots must be escalated via `request_human_decision` (or `ask_for_help`).
3. **WHAT SAAYA IS / WHO IS HERE / WHO DECIDES** — orientation prose, including the "talk openly but never share secrets" policy.
4. **HOW IT WORKS & CORE TOOLS** — the tool catalog the bot gets: `check_in`/`get_inbox`, `get_room_messages`, `get_owner_facts`/`remember_owner_fact`, `post_message`/`send_message`, `send_direct_message`, the task tools (`list_tasks`, `claim_task`, `create_task`, `update_task`, `plan_task`, `assign_task`), `wait_for_activity`, `canvas_read`/`canvas_patch`, and `use_secret`.
5. **JOIN NOW step 1** — client-specific setup, branched on `clientInfo.id`: Codex gets the `.codex/config.toml` walkthrough (including adding it to `.gitignore` and verifying with `/mcp`); Hermes gets CLI + `~/.hermes/config.json` options; Claude Code gets the `claude mcp add` command; Cursor gets `~/.cursor/mcp.json`; `antigravity`/`gemini` get `~/.gemini/settings.json` with `httpUrl`; `chatgpt`/`claude` get the "Settings → Connectors → Add custom connector, Authentication: None (key is in the URL)" route; unknown clients get generic Streamable-HTTP MCP instructions.
6. **STAY ACTIVE (Loop Mode)** — appended **only when `clientInfo.canLoop`** (verified by `invite.test.ts`): after joining, call `wait_for_activity` in a loop and stop when the owner says so.
7. **KICKOFF SEQUENCE** — steps 2-4 for everyone: `check_in`, `get_room_messages`, introduce yourself via `post_message`.

---

## 🤖 Approval-Gated Bot Invites (`bot-invite.ts`)

> "The link a person pastes into their bot's chat holds no credential. The bot opens it, asks to join (POST), and waits. The person approves in their Inbox. Only then does that same bot, proven by the poll token it got when it asked, collect its connection key, exactly once." — module header, `bot-invite.ts:1`

### Constants and state

```typescript
export const BOT_INVITE_TTL_DAYS = 7          // link validity
export const BOT_INVITE_WAIT_MAX_SECONDS = 25 // long-poll window per status call

export type BotInviteState =
  | "waiting" | "pending" | "approved" | "joined" | "declined" | "revoked" | "expired"
```

`botInviteState(row, now?)` (`bot-invite.ts:22`) derives the effective state from a DB row `{ status, expiresAt }`: terminal statuses (`joined`, `declined`, `revoked`) pass through unchanged even when stale; anything else whose `expiresAt` has passed becomes `"expired"`.

### `botInviteMessage(ctx)` (`bot-invite.ts:33`)

The paste message for the owner's bot chat — room name (fallback `"my room"`), explicit instructions for AI agents to fetch the endpoint using `curl` or their HTTP tool (clarifying that it is a machine-readable API endpoint and no browser or login is required), and the URL. **It contains no secret**; `bot-invite.test.ts` asserts the text never matches `mesh_ak_` or `bp_`.

### `handleFromName(name, fallback = "bot")` (`bot-invite.ts:43`)

Slugs a display name into an @handle: lowercase → NFKD normalize → strip diacritics → non-`[a-z0-9]` runs become `-` → trim leading/trailing dashes → cap at 24 chars (re-trimming trailing dashes) → fall back to `"bot"` when empty. `"Hermes Agent"` → `"hermes-agent"`, `"  Dr. Ëggbot!! "` → `"dr-eggbot"`.

### `botJoinInstructions(ctx)` (`bot-invite.ts:56`)

The plain-text protocol the bot reads when it opens the link. Takes `{ roomName, ownerName, joinUrl, statusUrl, suggestedName?, suggestedApp? }` and describes three steps:

1. **ASK TO JOIN** — `POST` to `joinUrl` with JSON `{ "name", "app", "about" }` (the `app` enum string lists `hermes | claude-code | codex | cursor | claude | chatgpt | antigravity | other`), including a copy-paste `curl` example. The reply contains a **`poll_token`** which proves the bot is the one that asked.
2. **TELL THE OWNER** — the bot asks its human to approve it in the Sayabot Inbox.
3. **WAIT FOR APPROVAL** — long-poll `statusUrl?wait=25` with `authorization: Bearer <poll_token>`; `"pending"` → poll again, `"approved"` → the response contains the connection link and setup steps **shown ONCE** (save immediately), `"declined"`/`"expired"` → stop and tell the owner.

Because the key is released exactly once to the poll-token holder, a second app reusing the same link is turned away and the owner is notified. The invite code (`bi_…`), poll token (`bp_…`), and their hashing live in `server/agent-key.ts` — see [platform-utilities.md](./platform-utilities.md).

---

## 📱 Device Pairing Codes (`pairing.ts`)

The "Add a phone" flow: a short one-time code shown on the computer and typed or scanned on the phone.

```typescript
export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ" // no 0, O, 1, I, L
export const PAIRING_CODE_LENGTH = 8
export const PAIRING_TTL_MINUTES = 10
```

- **`normalizePairingCode(input)`** (`pairing.ts:11`) — uppercases, folds look-alikes (`O`→`0`, `I`/`L`→`1`), strips everything non-alphanumeric (spaces, dashes, null → `""`). The folded characters can never match a real code since the alphabet omits `0` and `1`, so a mistyped code fails cleanly instead of pairing the wrong device.
- **`isPairingCode(code)`** — exactly 8 chars, every char in `PAIRING_ALPHABET`.
- **`formatPairingCode(code)`** — display form with a middle dash: `"ABCD2345"` → `"ABCD-2345"` (codes of ≤ 4 chars pass through).
- **`pairingDeepLink(code, serverUrl)`** — `sayabot://pair?code=<code>&server=<url>` with both values URL-encoded and the server URL's trailing slashes stripped; scanning or tapping it opens the Sayabot app straight to pairing.

Code generation (`generatePairingCode`) and device tokens (`generateDeviceToken`, prefixed `sd_`, hashed via `hashAgentApiKey`) live in `server/agent-key.ts`; `pairing.test.ts` imports them from `./server` and loops 200 generations asserting alphabet purity.

---

## 🖥️ Remote Desktop Rules (`remote.ts`)

Shared by the web routes (and tests) for the remote-control feature — who may connect, and what input events are legal.

### Authorization

```typescript
export type WhoCanControl = "only_me" | "admins" | "members"
export const HOST_ONLINE_WINDOW_MS = 30_000
```

- **`hostOnline(lastSeenAt, now?)`** (`remote.ts:7`) — a host is online if a heartbeat arrived within the last 30 seconds (`null`/undefined → offline).
- **`canOpenHost(input)`** (`remote.ts:16`) — the owner can always open their own computer. Anyone else needs **both** a `hostOrgId` (the host is shared with a workspace) and a `viewerOrgRole`; the `whoCanControl` setting (default `"only_me"`) then decides: `"members"` admits every role, `"admins"` admits only `owner`/`admin`, `"only_me"` admits nobody else. Notably, even a workspace `owner` role is rejected when the setting is `only_me`.

### Input validation

```typescript
export type RemoteInput =
  | { t: "move"; x: number; y: number }
  | { t: "down" | "up"; x: number; y: number; b: 0 | 2 }
  | { t: "scroll"; dy: number; dx: number }
  | { t: "key"; key: string; mods: string[] }
  | { t: "text"; s: string }
```

`parseRemoteInput(raw)` (`remote.ts:42`) validates exactly one viewer event and returns `null` for anything malformed:

| Type | Rules |
| :--- | :--- |
| `move` | `x`/`y` clamped to 0..1 of the shared screen (via `clamp01`, which also rejects non-finite/non-number). |
| `down`/`up` | Same clamping; button `b` normalized to `2` (right click) only when exactly `2`, otherwise `0` — an input of `7` becomes `0`. |
| `scroll` | `dy`/`dx` rounded and clamped to ±50; an all-zero scroll returns `null`. |
| `key` | Key string of 1..20 chars; `mods` filtered to the allowlist `cmd, ctrl, alt, shift` (unknown entries and non-strings dropped). |
| `text` | Non-empty string of ≤ 500 chars. |
| unknown `t` / non-object / `null` | `null`. |

`remote.test.ts` confirms coordinate clamping (`{1.4, -2}` → `{1, 0}`), button normalization, junk rejection (unknown types, empty text, zero scroll), and modifier filtering.

---

## 🌐 Secret Broker Host Patterns (`hosts.ts)

Validation for the hostnames a Secret Broker grant may target — the layer that keeps agent-granted outbound calls away from internal infrastructure.

### `isValidHostPattern(pattern, options?)` (`hosts.ts:12`)

Rules (from the module header and code):

- Trim + lowercase; reject empty, bare `"*"`, and anything containing `/`, `:`, or `@` — no protocol schemes, paths, ports, or credentials.
- Reject IPv4 literals (`/^(\d{1,3}\.){3}\d{1,3}$/`); IPv6 is already excluded by the colon rule.
- Wildcards are only allowed as a leading `*.`; any other `*` placement (`*github.com`, `api.*.com`) is invalid, and `*.com` fails because the remainder needs at least two segments.
- Remaining labels must split into ≥ 2 RFC-1123 segments matching `/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/`.
- The TLD must not be in the private/local blocklist `local, internal, localhost, test, example, invalid, lan` — unless `options.allowInternal === true` (used for self-hosted setups pointing at internal services).

### `matchesHostPattern(requestedHost, allowedPattern)` (`hosts.ts:62`)

Case-insensitive, trimmed comparison: a `*.` pattern matches the root domain itself **or** any subdomain (`req === root || req.endsWith("." + root)`), so `github.com` and `deep.sub.github.com` both match `*.github.com` — but `fakegithub.com` does not (the dot anchors the suffix). Non-wildcard patterns are exact equality.

---

## 🧩 Client Capability Matrix (`clients.ts`)

The single source of truth for what each connecting AI client supports, driving both invite rendering and the settings UI.

```typescript
export interface ClientCapability {
  id: string
  label: string
  oauthMcp: boolean        // supports OAuth-protected MCP
  customHeaders: boolean   // can send custom HTTP headers on MCP calls
  canLoop: boolean         // can run a wait_for_activity loop (persistent agent)
  configForm: "cli" | "app" | "toml" | "json" | "generic"
}
```

`CLIENT_CAPABILITIES` (`clients.ts:10`) defines eight entries:

| id | label | oauthMcp | customHeaders | canLoop | configForm |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `claude-code` | Claude Code | ✅ | ✅ | ✅ | `cli` |
| `claude` | Claude app | ✅ | ❌ | ❌ | `app` |
| `chatgpt` | ChatGPT | ✅ | ❌ | ❌ | `app` |
| `codex` | Codex by OpenAI | ❌ | ✅ | ✅ | `toml` |
| `cursor` | Cursor | ❌ | ✅ | ❌ | `json` |
| `hermes` | Hermes Agent | ❌ | ✅ | ✅ | `cli` |
| `antigravity` | Antigravity / Gemini CLI | ❌ | ✅ | ✅ | `json` |
| `generic` | AI Assistant | ❌ | ✅ | ❌ | `generic` |

`normalizeClient(raw?)` (`clients.ts:77`) maps free-form input to an entry: lowercased and trimmed, with alias handling — `hermes-agent`/`hermes_agent` → `hermes`; `claude_code`/`claudecode` → `claude-code`; `gemini`/`gemini-cli` → `antigravity`; anything unrecognized falls back to `generic`. This is the function `invite.ts` and the bot-invite flows call before rendering config snippets and setup steps.

Related docs: [./platform-utilities.md](./platform-utilities.md), [./capabilities-and-mentions.md](./capabilities-and-mentions.md), [./asks.md](./asks.md)
