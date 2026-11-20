# Agent gateways (Telegram & Discord)

Each bot can own its own Telegram or Discord account. A token is an identity, so the system treats
"one bot account" and "one agent" as the same thing: a second agent can never inherit the first
agent's bot, and a token that is already connected anywhere is refused.

This differs from [workspace connectors](./connectors-chat.md), which are workspace-wide pipes into
a chosen room and can be shared by every agent in that room. Gateways are per-agent, appear in the
bot's sidebar settings, and mirror each outside conversation as its own room.

---

## Identity rules

| Rule | Where it is enforced |
| --- | --- |
| One gateway per `(agent, source)` | unique index `agent_gateways_agent_source_idx` |
| One agent per bot token | unique index `agent_gateways_token_idx` on `token_fingerprint` (SHA-256) plus an explicit lookup on connect |
| A legacy connector's bot cannot be re-bound | the connect route decrypts same-source `workspace_connectors` and compares the token |
| The token is never returned | sealed with `encryptSecret(…, MESH_KEK)`; the API exposes only `last4` |

`webhook_secret_enc` holds a per-gateway random secret (sealed with `sealSecret`) used in the
Telegram webhook path.

---

## Schema

`0041_agent_gateways.sql` (`packages/db/src/schema/gateways.ts`):

- **`agent_gateways`** — `org_id`, `agent_id`, `source` (`telegram` | `discord`), `name`, `status`,
  sealed token (`ciphertext`/`iv`/`tag`), `last4`, `token_fingerprint`, `webhook_secret_enc`,
  `config` (`allowedChats`, `allowedUserIds`, `silence`), `last_error`, `last_seen_at`, `created_by`.
- **`gateway_inbound`** — `(gateway_id, external_id)` dedup ledger written by the orchestrator. It is
  separate from `messaging_inbound` because that table has a foreign key to `workspace_connectors`.
- **`external_chats`** — `(gateway_id, external_chat_id)` → `room_id`, `chat_type`, `title`,
  `last_message_at`. One row per outside conversation; `room_id` is unique.

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
   the bot token) and the optional `allowedChats` / `allowedUserIds` allowlists.
3. Inserts `(gateway_id, external_id)` into `gateway_inbound` with `onConflictDoNothing`; a repeat
   delivery stops here.
4. Finds or creates the mirror room (`ensureMirrorRoom`): a plain **private** room named
   `Telegram · @bot · <chat>` (or `Discord · …`), the gateway's agent attached as a participant, the
   person who connected the gateway added as room admin. Mirror rooms are never `dm`, because a
   `dm` room carries a unique `(agent_dm_user_id, agent_dm_agent_id)` pair and one bot talks to many
   outside people.
5. Stores the message with `metadata.gateway = { gatewayId, platform, chatId, externalId, chatType,
   sender }` and mentions the agent, updates `last_seen_at`, then enqueues the room message like any
   other chat turn.

Because the mirror is a real room, the web chat list, realtime turns, memory, canvas, approvals and
the mobile home feed work with no extra code.

### Telegram webhook

`apps/web/src/app/api/gateways/[platform]/[gatewayId]/[secret]/route.ts` verifies the sealed secret
and forwards the raw update. On connect the API calls `setWebhook` with
`<public origin>/api/gateways/telegram/<id>/<secret>` and `allowed_updates: ["message"]`; if Telegram
refuses, the row is deleted and the error is returned, so there is never a gateway with a broken
webhook.

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

Agent replies already funnel through `deliverInboundReply` (`connectors/inbound.ts`) from the engine
and the approval hook. It now calls `deliverGatewayReply` first:

- `metadata.gateway` absent → returns `false`, the legacy connector path runs unchanged.
- silence token (`[SILENT]`, `NO_REPLY`, Chinese equivalents — `GATEWAY_SILENCE_TOKENS`) → handled,
  nothing is sent. This is how a group chat stays quiet when the agent decides not to answer.
- otherwise the reply is sent with the gateway's own class from `connectors/messaging.ts`, truncated
  to Telegram's 4096 / Discord's 2000 character limits.

---

## Web UI and API

The agent settings page renders `AgentChannelsPanel` under the connector scopes. It lists each
channel with its platform, status, `last4`, last error and whether a webhook is set, and lets an
admin paste a token to connect or disconnect. Tokens are write-only.

| Route | Purpose |
| --- | --- |
| `GET /api/workspaces/[org]/agents/[agentId]/channels` | list channels (never the token) |
| `POST …/channels` | verify the token with `getMe` / `/users/@me`, seal it, set the Telegram webhook |
| `PATCH …/channels/[channelId]` | `allowedChats`, `allowedUserIds`, `silence` |
| `DELETE …/channels/[channelId]` | `deleteWebhook`, delete mirrored rooms, delete the row |

Disconnect removes the mirrored conversations: their rooms are deleted, which cascades to messages
and external-chat rows.

---

## Mobile

`/api/mobile/home` joins `external_chats` to the org's `agent_gateways` and adds `channel` to every
chat row. `HomeScreen` prefixes the preview with `Telegram · ` / `Discord · ` so a mirrored chat is
recognisable in the same list as every other room, and `HomeChat.channel` carries the value through
`useHome`.

---

## Tests

- `packages/core/src/gateways.test.ts` — source guard, silence tokens, room naming, token shape.
- `apps/orchestrator/scripts/gateway-e2e.local.ts` — local end-to-end over a real Postgres migrated
  with `pnpm db:migrate`: sealed token → inbound → dedup → two mirror rooms → membership → message
  metadata → reply to `sendMessage` → silence → connector fall-through. Run with a local
  `DATABASE_URL`, `MESH_KEK`, `SAYABOT_LOCAL=true` and stub-free network access disabled by the
  script's own fetch stub.

Live provider tests need real bot tokens and a public URL Telegram can reach; they are not part of
the automated suite.

---

## Related docs

- [Connectors & chat](./connectors-chat.md)
- [Connector platform](./connector-platform.md)
- [Agents UI](../../web/pages/agents-ui.md)
- [Mobile home & chat](../../mobile/home-and-chat.md)
- [Connectors & Vault schemas](../../database/schema-connectors-and-vault.md)
