# Agent gateways (Telegram & Discord)

Each bot can own its own Telegram or Discord account. A token is an identity, so the system treats
"one bot account" and "one agent" as the same thing: a second agent can never inherit the first
agent's bot, and a token that is already connected anywhere is refused.

This differs from [workspace connectors](./connectors-chat.md), which are workspace-wide pipes into
a chosen room and can be shared by every agent in that room. Gateways are per-agent, appear in the
bot's sidebar settings. Each gateway is one chat and one room: the app and Telegram or Discord are two clients of that room.

---

## Identity rules

| Rule | Where it is enforced |
| --- | --- |
| One gateway per `(agent, source)` | unique index `agent_gateways_agent_source_idx` |
| One agent per bot token | unique index `agent_gateways_token_idx` on `token_fingerprint` (SHA-256) plus an explicit lookup on connect |
| A legacy connector's bot cannot be re-bound | the connect route decrypts same-source `workspace_connectors` and compares the token |
| The token is never returned | sealed with `encryptSecret(…, MESH_KEK)`; the API exposes only `last4` |
| One outside chat per gateway | `bound_chat_id`, set by the first message that passes the allowlist (`gatewayChatDecision`) |
| One room per gateway | `room_id`, unique where not null, created when the channel is connected |

`webhook_secret_enc` holds a per-gateway random secret (sealed with `sealSecret`) used in the
Telegram webhook path.

---

## Schema

`0041_agent_gateways.sql` and `0042_gateway_one_channel.sql` (`packages/db/src/schema/gateways.ts`):

- **`agent_gateways`** — `org_id`, `agent_id`, `source` (`telegram` | `discord`), `name`, `status`,
  sealed token (`ciphertext`/`iv`/`tag`), `last4`, `token_fingerprint`, `webhook_secret_enc`,
  `config` (`allowedChats`, `allowedUserIds`, `silence`), `bound_chat_id`, `room_id`, `last_error`,
  `last_seen_at`, `created_by`. `room_id` references `rooms(id)` on delete set null. Unique
  `agent_gateways_room_idx` allows many unbound rows and one room per gateway.
- **`gateway_inbound`** — `(gateway_id, external_id)` dedup ledger written by the orchestrator. It is
  separate from `messaging_inbound` because that table has a foreign key to `workspace_connectors`.
  A refused chat is claimed here so a webhook retry does not send the refusal twice.
- **`external_chats`** — the bound chat's `(gateway_id, external_chat_id)` → `room_id`, `chat_type`,
  `title`, `last_message_at`. Kept so older readers can still label the room. `room_id` is unique.

RLS: members may read/write their org's gateways and external chats; the inbound ledger is readable
by members and written by the service role.

---

## Inbound path

```
Telegram ──POST──► /api/gateways/telegram/<gatewayId>/<secret>   (web)
                      │ verify sealed secret, forward
                      ▼
                   /internal/gateway-inbound                      (orchestrator)
Discord  ──socket──► connectors/discord-gateway.ts (trusted)
                      │
                      ▼
              gateways/inbound.ts  acceptGatewayInbound
```

`acceptGatewayInbound` (`apps/orchestrator/src/gateways/inbound.ts`):

1. Loads the gateway by id, requires `status = active` and a matching `source`.
2. Checks the webhook secret in constant time (skipped for the Discord socket, which already holds
   the bot token). `allowedChats` applies only while the gateway is unbound, so it chooses who may
   become the one chat. `allowedUserIds` still applies after binding.
3. `gatewayChatDecision(boundChatId, chatId)` returns `bind`, `accept`, or `refuse`. A refusal
   claims the dedup row, sends `GATEWAY_REFUSAL` (`"This bot is bound to another chat."`) once, and
   does not enqueue a turn. Binding uses `UPDATE … WHERE bound_chat_id IS NULL`; the loser of that
   race is refused the same way.
4. Uses the room created at connect (`agent_gateways.room_id`). If that room is missing, one private
   room is created and stored where `room_id` is still null. The room is named
   `Telegram · <title>` (or `Discord · …`) once the first message has a title. It is never `kind: dm`.
   The agent and the person who connected the gateway are members. One `external_chats` row stays in
   sync for the bound chat.
5. Stores the message with `metadata.gateway = { gatewayId, platform, chatId, externalId, chatType,
   sender }` and mentions the agent, updates `last_seen_at`, then enqueues the room message like any
   other chat turn.

The room is a normal room, so the web chat list, realtime turns, memory, canvas, approvals and the
mobile home feed are the same conversation as Telegram or Discord. An agent may still have one
Telegram gateway and one Discord gateway. Those stay separate rooms so a reply is not sent twice.

### Telegram webhook

`apps/web/src/app/api/gateways/[platform]/[gatewayId]/[secret]/route.ts` verifies the sealed secret
and forwards the raw update. On connect the API calls `setWebhook` with
`<public origin>/api/gateways/telegram/<id>/<secret>` and `allowed_updates: ["message"]`; if Telegram
refuses, the gateway row and its room are deleted and the error is returned, so there is never a
gateway with a broken webhook.

`POST /v1/gateways/telegram/:gatewayId/:secret` on the orchestrator is the same intake for
deployments that expose the orchestrator directly instead of going through the web app.

Telegram refuses `getUpdates` once a webhook is set — polling is intentionally not supported for
gateways.

### Discord socket

`connectors/discord-gateway.ts` serves both row types from one loop: legacy `workspace_connectors`
(key `connector:<id>`) and `agent_gateways` (key `gateway:<id>`). Message content is a privileged
intent; the bot needs **Message Content** enabled in the developer portal. `guild_id` present means a
server channel (`group`), absent means a DM. A socket is opened per row so replies always leave
through the bot that received the message.

---

## Reply path

Agent replies funnel through `deliverInboundReply(metadata, text, roomId)` from the engine
(`engine/run.ts`, `runner/llm.ts`) and the approval hook (`tools/audited.ts`). It calls
`deliverGatewayReply` first:

- `metadata.gateway` present → send once to that gateway's `bound_chat_id` (the metadata chat is not
  a second destination). A missing or inactive gateway is handled, so the connector path does not
  also send.
- no gateway metadata, but `roomId` matches `agent_gateways.room_id` → send to `bound_chat_id`. If
  the chat is not bound yet, return `true` and send nothing.
- neither → return `false`, and the legacy connector path runs unchanged.
- silence token (`[SILENT]`, `NO_REPLY`, Chinese equivalents — `GATEWAY_SILENCE_TOKENS`) → handled,
  nothing is sent. `config.silence` also suppresses a reply when the bound chat is a group. DMs
  still answer unless the text itself is a silence token.
- otherwise the reply is sent with the gateway's own class from `connectors/messaging.ts`, truncated
  to 4000 characters on Telegram and 2000 on Discord. A reply typed in the app uses this same path.

---

## Web UI and API

The agent settings page renders `AgentChannelsPanel` under the connector scopes. It lists each
channel with its platform, status, `last4`, last error and whether a webhook is set, and lets an
admin paste a token to connect or disconnect. Tokens are write-only.

| Route | Purpose |
| --- | --- |
| `GET /api/workspaces/[org]/agents/[agentId]/channels` | list channels (never the token) |
| `POST …/channels` | verify the token with `getMe` / `/users/@me`, open the room, seal the token, set the Telegram webhook |
| `PATCH …/channels/[channelId]` | `allowedChats`, `allowedUserIds`, `silence` |
| `DELETE …/channels/[channelId]` | `deleteWebhook`, delete the bound room and any leftover external-chat rooms, delete the row |

The list includes `boundChatId` and `roomId`. The panel says whether the channel is waiting for its
first message or already bound. Disconnect deletes that room, which cascades to messages and the
external-chat row. `room_id` is set null if the room disappears first, so the sealed token is not
dropped by a room delete on its own.

---

## Mobile

`/api/mobile/home` labels a room from `agent_gateways.room_id` first, then from `external_chats`
for any older room that was not chosen as the bound chat. `HomeScreen` prefixes the preview with
`Telegram · ` / `Discord · `, and `HomeChat.channel` carries the value through `useHome`.

---

## Tests

- `packages/core/src/gateways.test.ts` — source guard, silence tokens, room naming, token shape,
  and `gatewayChatDecision` (`bind` / `accept` / `refuse`).
- `apps/orchestrator/scripts/gateway-e2e.local.ts` — local end-to-end over a real Postgres migrated
  with `pnpm db:migrate`: sealed token → inbound → dedup → one bound room → a second chat refused
  → membership → message metadata → reply to `sendMessage` → a reply looked up by room id →
  silence → connector fall-through. Run with a local `DATABASE_URL`, `MESH_KEK`,
  `SAYABOT_LOCAL=true`. The script stubs `fetch` before the refusal is sent.
- `e2e/gateways.spec.ts` — the public webhook accepts the first chat, ignores a duplicate, rejects a
  bad secret, and refuses a second chat with one outbound line and a single `external_chats` row.

Live provider tests need real bot tokens and a public URL Telegram can reach; they are not part of
the automated suite.

---

## Related docs

- [Connectors & chat](./connectors-chat.md)
- [Connector platform](./connector-platform.md)
- [Agents UI](../../web/pages/agents-ui.md)
- [Mobile home & chat](../../mobile/home-and-chat.md)
- [Connectors & Vault schemas](../../database/schema-connectors-and-vault.md)
