# Connector Platform (Service, Scopes, Rate Limiting, Inbound)

The connector platform is the tiered credential and scope layer that every external integration — Google Drive, Slack, GitHub, Discord, Telegram, WhatsApp, and the password managers — runs on. Tier 1 is the workspace connector (one OAuth/API token per org per source, AES-256-GCM sealed under `MESH_KEK`); tier 2 is the per-agent grant in `agent_connector_grants` that narrows what each agent may touch. This page documents the shared `ConnectorService`, the type contracts, the retry/rate-limit primitive, and the inbound chat-message intake that turns outside platform messages into room turns.

Source files: `apps/orchestrator/src/connectors/service.ts`, `apps/orchestrator/src/connectors/types.ts`, `apps/orchestrator/src/connectors/rate-limiter.ts`, `apps/orchestrator/src/connectors/inbound.ts`

---

## 🗄️ Database Tables (`packages/db/src/schema/connectors.ts`)

| Table                    | Key columns                                                                                                                                                                                        | Purpose                                                                                                                                 |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace_connectors`   | `org_id`, `source` (text), `name`, `status` (default `"active"`), `auth_type` (default `"token"`), `ciphertext`/`iv`/`tag` (envelope-encrypted secret), `last4`, `config` (jsonb), `error_message` | One row per workspace integration; the credential is sealed with `MESH_KEK` at insert time. Indexed on `org_id` and `(org_id, source)`. |
| `agent_connector_grants` | `org_id`, `agent_id`, `connector_id`, `scope_config` (jsonb, default `{}`)                                                                                                                         | Tier-2 agent scoping. Cascades on connector or agent delete.                                                                            |
| `messaging_inbound`      | `connector_id` + `external_id` (unique index `messaging_inbound_pk`), `message_id`                                                                                                                 | Dedup ledger so a retried platform webhook never starts a second agent turn.                                                            |

Row types `WorkspaceConnectorRow` and `AgentConnectorGrantRow` are inferred selects exported from `@sayabot/db`.

## 📐 Type Contracts (`src/connectors/types.ts`)

```typescript
export type ConnectorSource =
  | "google_drive"
  | "slack"
  | "github"
  | "jira"
  | "discord"
  | "telegram"
  | "whatsapp"
  | "onepassword"
  | "bitwarden"
  | "protonpass"
  | "supabase"
  | "cloudflare_r2"
  | "backblaze_b2"
  | "s3_storage"
  | "huggingface"
  | "composio"

/** Sources with native tools in the orchestrator. Jira is reached through the Atlassian app. */
export const NATIVE_CONNECTOR_SOURCES: ConnectorSource[] = [
  "google_drive",
  "slack",
  "github",
  "discord",
  "telegram",
  "whatsapp",
  "onepassword",
  "bitwarden",
  "protonpass",
  "supabase",
  "cloudflare_r2",
  "backblaze_b2",
  "s3_storage",
  "huggingface",
  "composio",
]

/** The subset served by `CloudStorageClient` (see [Cloud storage](./connectors-storage.md)). */
export const STORAGE_CONNECTOR_SOURCES: ConnectorSource[] = [
  "supabase",
  "cloudflare_r2",
  "backblaze_b2",
  "s3_storage",
  "huggingface",
]
```

Every connector client normalizes results into a `ConnectorDoc` (`types.ts:26-46`): `id`, `source`, `title`, `content`, `url`, and a free-form `metadata` bag with conventional keys (`author`, `lastModified`, `mimeType`, `folderId`, `channelId`, `channelName`, `threadTs`, `repo`, `path`, `issueNumber`, `labels`). Search options (`ConnectorSearchOptions`) carry `query`, `limit`, and the scope arrays the service passes down from the grant.

The grant scope shape is the security contract between the settings UI and every tool call (`types.ts:56-67`):

```typescript
export interface ConnectorScopeConfig {
  allowedFolders?: string[] // Google Drive folder ids
  /** Slack/Discord channel IDs or Telegram chat IDs this agent may read and post to. */
  allowedChannels?: string[]
  allowedRepos?: string[] // GitHub "owner/name"
  /** WhatsApp numbers (country code first) this agent may message. */
  allowedRecipients?: string[]
  /** Password-manager vault names or ids this agent may read. */
  allowedVaults?: string[]
  /** Composio app (toolkit) slugs this agent may use; empty = the whole catalog. */
  allowedApps?: string[]
  /** No send tools at all, even with approval. */
  readOnly?: boolean
}
```

## 🔐 Credential Decryption (`src/connectors/service.ts:37-68`)

`ConnectorService` is constructed with injectable `db`, `fetchFn`, and `kek` (used by tests); the production singleton comes from `getConnectorService()` (`service.ts:398-405`). `getDecryptedConnector(orgId, source)` runs the Tier-1 check on every call — nothing is cached in plaintext:

1. Selects the first `workspace_connectors` row for `(orgId, source)`. Missing row → `"No connector configured for '<source>' in this workspace."`
2. Rejects any status other than `"active"` → `"Connector '<name>' is currently <status>."`
3. Decrypts with `decryptSecret({ ciphertext, iv, tag }, kek)` where `kek` falls back to `getEnv().MESH_KEK`, then runs `unwrapConnectorSecret(...)` (`packages/llm/src/connector-secret.ts:2-18`) to split the plaintext into `{ token, inboundSecret }`. The stored plaintext is either the bare token or a JSON envelope `{"token": "...", "inboundSecret": "..."}` — the inbound secret is the per-connector webhook key (see [Inbound intake](#-inbound-chat-intake-srcconnectorsinboundts)).

## 🎫 Agent Scope Grants (`src/connectors/service.ts:73-90`)

`getAgentScope(agentId, connectorId)` loads the agent's `agent_connector_grants` row. A missing grant throws `"Access Denied: This agent is not granted access to this connector."` — grant existence is itself the access check; the returned `scopeConfig` (default `{}`, i.e. unrestricted within the connector) only narrows further.

## 🗄️ Storage Target Resolution (`src/connectors/service.ts:88-160`)

Storage tools are per-agent, not per-org: an org usually has several storage connectors connected at
once (the Supabase workspace default plus a bucket on R2, say), so `getStorageTarget({ orgId, agentId,
preferredProvider })` decides which one an agent actually writes to.

1. Joins `agent_connector_grants` → `workspace_connectors` for this agent, keeping `status = 'active'`
   rows whose source is in `STORAGE_CONNECTOR_SOURCES`.
2. Among the granted connectors, the agent's `storageProvider` param wins when it granted that source;
   otherwise the first granted one is used. It decrypts that row and returns
   `{ connector, token, granted: true }`.
3. With no storage grant at all it falls back to the workspace's first active storage connector in
   `STORAGE_CONNECTOR_SOURCES` order (preferring `preferredProvider` when given) and returns
   `granted: false`. No active storage connector → `null`, and the storage tools are not registered.

The tool layer reads `allowedPrefixes` / `readOnly` from the grant of the connector that was actually
picked, so a prefix scope always belongs to the bucket in use.

## 🎛️ Service Actions

Each action method follows the identical pattern: decrypt Tier-1, load Tier-2 scope, enforce scope, then delegate to the platform client. All read actions are non-dangerous; send actions are wrapped as `dangerous: true` tools by `src/tools/builtins/connectors.ts` (see ../tools/tool-connectors.md).

| Method                                      | Scope enforcement                                                                                                                                                                                                                                                                      |
| :------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `searchGoogleDrive`                         | `scope.allowedFolders` (plus the connector's `config.domain` when it is a folder id) passed into the Drive client's search filter, matched with `in ancestors` so nested files are found.                                                                                              |
| `readGoogleDriveFile`                       | Grant existence only (any granted agent can read any file).                                                                                                                                                                                                                            |
| `searchSlack`                               | If the caller passes a `channel` and the grant has `allowedChannels`, `SlackConnector.assertChannelAllowed` checks it (names or ids, see below). Otherwise the search is filtered to `allowedChannels`, or to the connector's `config.defaultChannel` when the grant sets no channels. |
| `readSlackThread`                           | `SlackConnector.assertChannelAllowed(channelId, scope.allowedChannels)` → `"Access Denied: Slack channel <channel> is outside this agent's allowed list (…)."`. Names and ids are interchangeable.                                                                                     |
| `searchGitHubCode`                          | `scope.allowedRepos` passed to the GitHub code-search filter; with no repo scope, the connector's `config.defaultOrg` becomes an `org:<name>` qualifier.                                                                                                                               |
| `getGitHubFile` / `readGitHubFile`          | `repo` must be in `allowedRepos` when set; `owner/name` split tolerates a missing owner segment.                                                                                                                                                                                       |
| `getGitHubIssueOrPr` / `readGitHubIssue`    | Same repo allowlist check.                                                                                                                                                                                                                                                             |
| `postSlackMessage`                          | `assertCanSend` + `assertChannel`, then `SlackConnector.postMessage(channel, text, threadTs)`.                                                                                                                                                                                         |
| `listDiscordChannels`                       | Guild from `connector.config.guildId` (or falls back to `listGuilds()`); filters the channel list to `allowedChannels` when set.                                                                                                                                                       |
| `readDiscordMessages`                       | `assertChannel` on `channelId`.                                                                                                                                                                                                                                                        |
| `sendDiscordMessage`                        | `assertCanSend` + `assertChannel`.                                                                                                                                                                                                                                                     |
| `readTelegramMessages`                      | `getUpdates` when the bot has no webhook; when chat-with-an-agent is on (webhook set) it returns the messages the inbound intake already recorded for this connector, so the tool works in both modes. Filtered to `allowedChannels` (chat ids) when set.                              |
| `sendTelegramMessage`                       | `assertCanSend` + `assertChannel` on `chatId`.                                                                                                                                                                                                                                         |
| `sendWhatsAppText` / `sendWhatsAppTemplate` | `assertCanSend`, then `normalizePhone(to)` compared against normalized `allowedRecipients`; rejects with `"+<number> is not one of the numbers this agent may message."`. Uses `connector.config.phoneNumberId`.                                                                       |
| `queryPassword`                             | Merges `scope.allowedVaults` into the connector's `PasswordConfig` before delegating to `queryPasswordManager` (`passwords.ts`).                                                                                                                                                       |
| `listComposioApps` / `searchComposioTools`  | Catalog and one app's tools through `ComposioConnector`; `scope.allowedApps` filters the list and gates the requested app (`assertComposioApp`).                                                                                                                                        |
| `executeComposioTool`                       | `assertComposioTool` (the slug must start with a granted app), then `readOnly` refuses anything that is not a read verb, then the tool runs as `config.userId ?? org:<orgId>` — never a caller-supplied user.                                                                          |
| `connectComposioApp`                        | `assertComposioApp`, then `POST /connected_accounts/link` for that app and the workspace user.                                                                                                                                                                                       |

The two private guards (`service.ts:258-268`):

```typescript
private assertCanSend(scope: ConnectorScopeConfig, label: string) {
  if (scope.readOnly) throw new Error(`Access Denied: this agent has read-only access to ${label}.`)
}

private assertChannel(scope: ConnectorScopeConfig, channel: string, label: string) {
  const allowed = scope.allowedChannels
  if (allowed && allowed.length > 0 && !allowed.includes(channel.replace(/^#/, ""))) {
    throw new Error(`Access Denied: ${label} ${channel} is outside this agent's allowed list (...)`)
  }
}
```

## 🔁 Retry & Rate Limiting (`src/connectors/rate-limiter.ts`)

The module exports a single function, `fetchWithRetry(url, init, options)`. There is no token-bucket limiter class in this codebase — rate limiting is _reactive_: the wrapper retries on `429` and transient `5xx` with backoff, honoring the server's `Retry-After` header.

| Option        | Default | Meaning                                           |
| :------------ | :------ | :------------------------------------------------ |
| `maxRetries`  | `3`     | Retry attempts for 429 / 500–504 / network errors |
| `baseDelayMs` | `500`   | Exponential base: `baseDelayMs * 2^(attempt-1)`   |
| `maxDelayMs`  | `8000`  | Ceiling for any computed delay                    |
| `timeoutMs`   | `25000` | Per-attempt `AbortController` timeout             |
| `fetchFn`     | `fetch` | Injectable for tests                              |

Algorithm per attempt (`rate-limiter.ts:26-82`):

1. Race the fetch against a `setTimeout(() => controller.abort(), timeoutMs)`.
2. On a 2xx response, return immediately.
3. On `429` or `500 <= status <= 504` while attempts remain: compute `baseDelayMs * 2^(attempt-1)`, then override it with `Retry-After` when present — parsed either as integer seconds or as an HTTP date (`Math.max(0, date - Date.now())`). Add `0–250 ms` random jitter (anti thundering-herd), cap at `maxDelayMs`, sleep, retry.
4. Any other non-OK status returns the response as-is (callers handle their own error shapes).
5. A thrown network error retries with the same backoff — except `AbortError`, which propagates immediately (so caller-level cancellation is never swallowed).

Clients in `slack.ts`, `messaging.ts`, `github.ts`, and `google-drive.ts` all issue requests through this wrapper.

## 📥 Inbound Chat Intake (`src/connectors/inbound.ts`)

Inbound lets a Telegram bot, Discord bot, or WhatsApp number act as a _room participant_: outside messages arrive via webhook (or the Discord gateway, see connectors-chat.md) and become room messages that mention the configured agent.

**Platform webhooks** are parsed by `eventsFromPayload(platform, raw)` (`inbound.ts:47-85`):

- `telegram`: takes `payload.message`; ignores bot senders (`from.is_bot`) and empty text; yields `{ externalId: message_id, chatId: chat.id, sender: @username|first_name, text }`.
- `whatsapp`: walks the Meta Cloud API `entry[].changes[].value.messages[]` tree, keeping only `type === "text"` messages; `sender` is `+<from>`.
- `discord` returns `[]` — Discord messages arrive via the persistent gateway process, not the HTTP webhook.

**Wiring** is stored on the connector row under `config.inbound`:

```typescript
interface InboundConfig {
  enabled?: boolean
  roomId?: string // room the message is posted to
  agentId?: string // agent that gets @-mentioned and answers
  allowedChats?: string[] // optional chat-id allowlist
}
```

`acceptInbound(args)` (`inbound.ts:99-175`) is the single entry point both the HTTP webhook and the trusted Discord gateway call. Its validation cascade, in order:

1. `connectorId` must look like a UUID (`/^[0-9a-f-]{36}$/i`) → `"bad connector"`.
2. `externalId` (≤200 chars), `chatId` (≤80 chars), and non-empty text required → `"empty"`.
3. Connector must exist, match the platform, and be `active` → `"connector not active"`.
4. `config.inbound` must be `enabled` with both `roomId` and `agentId` → `"chat is not turned on"`.
5. Decrypt the connector secret; `inboundSecret` must exist → `"chat is not turned on"`. HTTP callers must pass `key === inboundSecret` → `"bad key"`. The Discord gateway passes `trusted: true` because it already authenticated with the bot token.
6. `allowedChats` (when set) must include `chatId` → `"chat not allowed"`.
7. The configured agent must be a member of the room via `room_agents` and belong to the connector's org → `"agent is not in that room"`; the room must exist in the same org → `"room not found"`.
8. **Dedup claim**: `insert ... onConflictDoNothing` into `messaging_inbound (connector_id, external_id)`. Zero rows returned → `"duplicate"` (webhook replay is a no-op).
9. Persist a `messages` row: `senderType: "human"`, `senderId: null`, `status: "complete"`, `mentions: [agent.handle.toLowerCase()]`, and `metadata.inbound = { platform, connectorId, chatId, externalId, sender }` for later reply routing. Body is built by `inboundRoomText(handle, sender, text)` (`inbound.ts:41-45`): `@<handle> <sender> says:\n<body>` with sender scrubbed of newlines and capped at 80 chars, body capped at 8 000 chars.
10. Backfill `messaging_inbound.message_id`, then `enqueueRoomMessage(room.id, message.id)` (`src/jobs/index.ts:108`) so the pg-boss queue triggers a room turn.

`deliverInboundReply(metadata, text)` (`inbound.ts:178-196`) closes the loop: it reads `metadata.inbound` back from the room message via `readInbound()`, re-decrypts the connector token, and sends the reply (trimmed to 4 000 chars) back to the originating chat through `TelegramConnector.sendMessage`, `DiscordConnector.sendMessage`, or `WhatsAppConnector.sendText`. The caller (the agent-loop reply path) logs failures.

## 🧷 Endpoint Overrides (Tests)

`ConnectorService` takes an optional `endpoints: Partial<Record<ConnectorSource, string>>` map (`service.ts`). `endpointFor(source)` returns the override for a source, and every client built by the service receives it as a `baseUrl` (`SlackConnector`, `GitHubConnector`, `GoogleDriveConnector`, `DiscordConnector`, `TelegramConnector`, `WhatsAppConnector`, `CloudStorageClient` for Hugging Face). `queryPasswordManager` gets `allowLocalBase` from the same map, because it otherwise refuses non-HTTPS URLs.

Production never sets `endpoints`; the integration suite does, so the **real** client code (URL construction, auth headers, response parsing, grant checks) runs against a local stub HTTP server instead of a mocked `fetch`. `setConnectorService(service)` (exported from `service.ts`) swaps the singleton for the duration of a test and `setConnectorService(null)` clears it.

Self-hosted S3 gateways only answer path-style requests, so `s3_storage` always sets `forcePathStyle`; the web probe also sets it when the endpoint is loopback (`localhost`, `127.0.0.1`, `[::1]`), which is what lets the stub server stand in for R2/B2.

## 🧪 Tests

| Test file                                                 | Covers                                                                                                           |
| :-------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| `apps/orchestrator/src/connectors/inbound.test.ts`        | Payload parsing (`eventsFromPayload`), `inboundRoomText` formatting, and the `acceptInbound` validation cascade. |
| `apps/orchestrator/src/connectors/messaging.test.ts`      | The Telegram/Discord/WhatsApp clients the service delegates to.                                                  |
| `apps/orchestrator/src/connectors/passwords.test.ts`      | `queryPasswordManager` dispatch.                                                                                 |
| `apps/orchestrator/src/connectors/desktop-online.test.ts` | Desktop bridge presence used by `queryPassword`.                                                                 |
| `tests/integration/connectors-stub.test.ts`               | Every native source end to end against a stub vendor (including `composio`): granted connector → scope → tool call, and Jira's non-native route. |

---

Related docs:

- [Connector tools and scope enforcement](../tools/tool-connectors.md) — the agent-facing tool layer on top of this service
- [Chat platform connectors](./connectors-chat.md) — Slack/Discord/Telegram/WhatsApp clients and the Discord gateway
- [Content & knowledge connectors](./connectors-content.md) — GitHub, Google Drive, password vaults
- [Secrets broker](../tools/secrets-broker.md) — the other way agents consume credentials
- [Orchestrator service overview](../engine/service-overview.md) — where these modules sit in the server
