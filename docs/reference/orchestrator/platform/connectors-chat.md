# Chat Platform Connectors (Slack, Discord, Telegram, WhatsApp)

The chat connectors are the client classes behind every conversation integration: `SlackConnector` for workspace search/threads/posts, `DiscordConnector` and `TelegramConnector` for bot messaging, `WhatsAppConnector` for the WhatsApp Business Cloud API, and the always-on `discord-gateway` process that holds a websocket per connected Discord bot so people's Discord messages become room turns. Reads go through `fetchWithRetry` (see [connector-platform.md](./connector-platform.md)); **sends never retry** (`maxRetries: 0`) so a timeout cannot post a message twice — and every send is a `dangerous: true` tool that waits for human approval first.

Source files: `apps/orchestrator/src/connectors/slack.ts`, `apps/orchestrator/src/connectors/discord-gateway.ts`, `apps/orchestrator/src/connectors/messaging.ts`

---

## 💬 Slack (`src/connectors/slack.ts`)

`SlackConnector` authenticates with a bot token (`Authorization: Bearer <botToken>`); it is constructed by `ConnectorService` per call with the decrypted workspace token. It keeps a per-instance `userCache: Map<string, string>` so a user id is resolved to a display name at most once per client.

### User mention resolution

- `resolveUserName(userId)` (`slack.ts:24-56`): calls `slack.com/api/users.info?user=<id>`, prefers `profile.display_name` → `real_name` → `name`, prefixes `@`, caches. On any failure it falls back to `@<userId>` rather than throwing.
- `formatSlackText(rawText)` (`slack.ts:61-72`): regex-replaces every `<@U…>` token in a message body with the resolved name, so the model sees human-readable text.

### Searching messages

`searchMessages(options)` (`slack.ts:77-157`) tries the native search API first:

1. Clamps `limit` to 1–25 (default 10) and appends `in:<channel>` filters for `allowedChannels`.
2. `GET /api/search.messages` with `count`, `sort=timestamp`, `sort_dir=desc`.
3. `search.messages` **only accepts a user token** — a bot token fails with `not_allowed_token_type` (or `missing_scope`), so on those two errors it falls back to `searchChannelHistory`.

The bot-token fallback `searchChannelHistory(options)` (`slack.ts:163-233`) is a bounded scan, not a real index:

- `conversations.list` (limit 100, public + private, exclude archived); filters channels to the `allowedChannels` set (matching id **or** name, case-insensitive).
- Walks at most **12 channels**, fetching `conversations.history` (40 messages each), keeping messages whose lowercase text contains the query, stopping once `limit` results are reached. The caps exist so one search cannot walk the whole workspace.

Both paths emit `ConnectorDoc`s with `source: "slack"`, `title: "Slack Message in #channel by @user"`, permalink, and `metadata.channelId/channelName/author/threadTs`.

### Reading threads and posting

- `readThread(channelId, threadTs)` (`slack.ts:248-305`): `GET /api/conversations.replies` with `limit: 50`; formats each reply as `**Author** (ISO timestamp):\ntext` joined by `---` separators. Throws on API `ok: false` or an empty thread.
- `postMessage(channel, text, threadTs?)` (`slack.ts:311-342`): `POST /api/chat.postMessage` with `maxRetries: 0` (never retried — a timeout must not post twice), body clamped to 40 000 chars, optional `thread_ts`. Returns `{ ts, channel }`; throws on empty text, HTTP error, or `ok: false`.

## 🟣 Discord gateway (`src/connectors/discord-gateway.ts`)

Discord does not POST ordinary messages to a webhook, so each connected bot holds a gateway websocket inside the orchestrator process. `startDiscordGateway()` is called once at boot from `src/index.ts:56`; everything is module-level state:

```typescript
/** GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT. Message content is a privileged Discord intent. */
const INTENTS = (1 << 9) | (1 << 12) | (1 << 15)
const sockets = new Map<string, WebSocket>()  // connectorId -> live socket
let started = false
```

**Reconciliation loop** (`tick`/`sync`, `discord-gateway.ts:25-60`): every **30 seconds** the module re-syncs its socket set against the database — selects all `workspace_connectors` rows with `source = "discord"`, keeps only `status = "active"` with `config.inbound.enabled`, decrypts each token with `MESH_KEK`, opens sockets for new connectors, and closes sockets whose connector was disabled or deleted. Sync errors are logged and swallowed; the loop never dies.

```typescript
async function sync(): Promise<void> {
  const rows = await getDb().select().from(workspaceConnectors)
    .where(eq(workspaceConnectors.source, "discord"))
  const wanted = new Set<string>()
  for (const row of rows) {
    const inbound = ((row.config ?? {}) as { inbound?: { enabled?: boolean } }).inbound
    if (row.status !== "active" || !inbound?.enabled) continue
    wanted.add(row.id)
    if (sockets.has(row.id)) continue
    let token = ""
    try {
      token = unwrapConnectorSecret(
        decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, getEnv().MESH_KEK),
      ).token
    } catch { continue }
    void connect(row.id, token)
  }
  for (const [id, socket] of sockets) {
    if (!wanted.has(id)) { socket.close(); sockets.delete(id) }
  }
}
```

Decryption runs on every sync tick for connectors that already have a socket — the `if (sockets.has(row.id)) continue` happens *after* `wanted.add` but before decryption in the success path, so only genuinely new connectors pay the decrypt cost (the token decrypt above is only reached when no socket exists yet). A failed decrypt (`catch { continue }`) leaves that connector unconnected until the next tick retries it.

**Connection lifecycle** (`connect`, `discord-gateway.ts:62-97`):

1. `GET /api/v10/gateway/bot` with `Authorization: Bot <token>` to get the websocket URL.
2. Opens `wss://<url>?v=10&encoding=json`.
3. On opcode **10 (Hello)**: starts a heartbeat `setInterval` sending `{ op: 1, d: null }` at the server-provided `heartbeat_interval`, then sends opcode **2 (Identify)** with the token, intents, and `properties: { os: "linux", browser: "sayabot", device: "sayabot" }`.
4. On opcode **0 dispatch** with `t === "MESSAGE_CREATE"`: hands the payload to `onMessage`.
5. `close`/`error` clear the heartbeat interval and drop the socket from the map; the next 30 s tick recreates it.

**Message intake** (`onMessage`, `discord-gateway.ts:99-116`): skips bot authors, requires non-empty `content`, `channel_id`, and `id`, then calls `acceptInbound({ connectorId, platform: "discord", externalId: id, chatId: channel_id, sender: @username, text, trusted: true })`. `trusted: true` skips the webhook-secret check because the gateway already holds the bot token (see [Inbound intake](./connector-platform.md#-inbound-chat-intake-srcconnectorsinboundts)). Failures are logged, never thrown into the websocket handler.

```mermaid
sequenceDiagram
    participant D as Discord API
    participant G as discord-gateway (orchestrator)
    participant I as acceptInbound
    participant Q as pg-boss room queue
    D->>G: op 10 Hello (heartbeat_interval)
    G->>D: op 1 heartbeat (every interval)
    G->>D: op 2 Identify (token, intents)
    D->>G: op 0 MESSAGE_CREATE
    G->>I: acceptInbound(trusted: true)
    I->>I: dedup insert messaging_inbound
    I->>Q: enqueueRoomMessage(roomId, messageId)
    Note over Q: room turn runs; reply path calls deliverInboundReply
```

The agent's reply is sent back through `deliverInboundReply` (`inbound.ts:178-196`), invoked from the reply paths in `src/engine/run.ts:291`, `src/runner/llm.ts:372`, and tool-result streaming in `src/tools/audited.ts:135`.

## 🤖 Discord REST client (`DiscordConnector`, `src/connectors/messaging.ts:45-122`)

Base URL `https://discord.com/api/v10`, `Authorization: Bot <token>` plus the `Sayabot (https://sayabot.com, 1.0)` user agent Discord requires.

| Method | Endpoint / behavior |
| :--- | :--- |
| `whoami()` | `GET /users/@me` → `{ id, username }`; used for connection tests. |
| `listGuilds()` | `GET /users/@me/guilds` → `{ id, name }[]`. |
| `listChannels(guildId)` | `GET /guilds/:id/channels`; validates `guildId` against `^\d{5,25}$`; keeps only text (type 0) and announcement (type 5) channels. |
| `readMessages(channelId, limit = 25)` | `GET /channels/:id/messages`, limit clamped 1–100; channel id validated; maps to `MessagingMessage` with author = `global_name` \|\| `username`, text clipped to 4 000 chars. |
| `sendMessage(channelId, content)` | `POST /channels/:id/messages` with **`maxRetries: 0`**; content clipped to Discord's 2 000-char limit and sent with `allowed_mentions: { parse: ["users"] }` — no `@everyone`/`@here`/role pings from an agent. Returns `{ id, url }`. |

## ✈️ Telegram client (`TelegramConnector`, `src/connectors/messaging.ts:126-206`)

The constructor validates the token format (`/^\d+:[A-Za-z0-9_-]{20,}$/`, the @BotFather shape) and throws a human-readable error otherwise. All calls go to `api.telegram.org/bot<token>/<method>`; the private `call` wrapper **strips the token out of any error message** (`messaging.ts:142`) before rethrowing, because the token is part of the URL and would otherwise leak into tool results and logs.

| Method | Behavior |
| :--- | :--- |
| `whoami()` | `getMe`. |
| `recentMessages(limit = 25)` | `getUpdates` with `limit: 100, allowed_updates: ["message"]`; takes the last N messages. Telegram keeps these for **24 hours** and only while no webhook is set on the bot; reading does not mark them read. Maps to `MessagingMessage` (`chatName` = title/username/first name). |
| `sendMessage(chatId, text)` | `sendMessage` with `retry = false`; chat id must be numeric or `@channelname`; text clipped to Telegram's 4 096-char limit. Returns `{ id }`. |

## 📱 WhatsApp client (`WhatsAppConnector`, `src/connectors/messaging.ts:210-280`)

Meta Graph API `https://graph.facebook.com/v21.0`, `Authorization: Bearer <accessToken>`, scoped to the workspace's `phoneNumberId` (constructor validates `^\d{5,25}$`).

| Method | Behavior |
| :--- | :--- |
| `whoami()` | `GET /:phoneNumberId?fields=display_phone_number,verified_name`. |
| `sendText(to, body)` | `POST /:phoneNumberId/messages` with `maxRetries: 0`, `type: "text"`, `preview_url: false`, body clipped to 4 096. Free-form text only works **within 24 hours** of the person's last message (Meta policy) — outside that window use a template. |
| `sendTemplate(to, template, language)` | Same endpoint with `type: "template"`; template name must match `^[a-z0-9_]{1,512}$`. |

Both normalize the destination with `normalizePhone(value)` (`messaging.ts:283-287`): strips spaces/`()+-.` and a leading `+`, requires 7–15 digits (E.164 without the `+`), returns digits only. The same function is used by `ConnectorService` to compare recipients against `allowedRecipients`.

## 📦 Shared shapes and helpers

`MessagingMessage` (`messaging.ts:9-16`) is the common read shape for Discord/Telegram: `{ id, author, text, sentAt, chatId, chatName? }`. `MAX_TEXT` is 4 000 chars with an ellipsis `clip()` helper; `readJson(res, service)` (`messaging.ts:24-41`) turns non-JSON bodies and API `message`/`description` fields into clean `"<service>: <detail>"` errors for tool results.

## 🧪 Tests

| Test file | Covers |
| :--- | :--- |
| `apps/orchestrator/src/connectors/messaging.test.ts` | Discord/Telegram/WhatsApp clients with a mocked `fetchFn` (reads, sends, validation errors, `normalizePhone`). |
| `apps/orchestrator/src/connectors/inbound.test.ts` | The `acceptInbound` pipeline the Discord gateway feeds, including webhook payload parsing. |

---

Related docs:
- [Connector platform](./connector-platform.md) — credential decryption, scope grants, retry primitive, inbound intake
- [Connector tools](../tools/tool-connectors.md) — the `slack_*`, `discord_*`, `telegram_*`, `whatsapp_*` agent tools wrapping these clients
- [Approvals](../tools/approvals.md) — how send tools pause for human approval before reaching the connectors
- [Orchestrator service overview](../engine/service-overview.md)
