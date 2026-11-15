# Connector Tools

Connector tools let an agent search and act on the workspace's external platforms — Google Drive, Slack, GitHub, Discord, Telegram, WhatsApp, and the password managers (1Password, Bitwarden, Proton Pass). Every tool delegates to `ConnectorService`, which decrypts the workspace connector's OAuth/API token per call (AES-256-GCM under `MESH_KEK`), validates the agent's grant in `agent_connector_grants`, and enforces the grant's scope (allowed folders, channels, repos, recipients, vaults, read-only). Reads are safe; anything that mutates the outside world — posting to Slack/Discord/Telegram/WhatsApp, reading a password — is `dangerous: true` and passes the human approval gate.

Source files: `apps/orchestrator/src/tools/builtins/connectors.ts`, `apps/orchestrator/src/connectors/service.ts`, `apps/orchestrator/src/connectors/types.ts`, `apps/orchestrator/src/tools/index.ts:232-260`

---

## 🎛️ Registration (`src/tools/index.ts:232-260`)

`connectorTools(opts)` is only included when `caps.connectors` is true **and** the agent has at least one active grant. `buildTools` queries:

```sql
agent_connector_grants ⋈ workspace_connectors
  where orgId = agent.org AND agentId = agent.id AND workspace_connectors.status = 'active'
```

and passes the **distinct `source` list** into `connectorTools({ orgId, agentId, roomId, sources })`. Each source then contributes its tool subset (`connectors.ts:357-404`):

| Source | Tools registered |
| :--- | :--- |
| `google_drive` | `gdrive_search`, `gdrive_read_file` |
| `slack` | `slack_search`, `slack_read_thread`, `slack_send_message` |
| `github` | `github_search_code`, `github_get_file`, `github_get_issue_or_pr` |
| `discord` | `discord_list_channels`, `discord_read_messages`, `discord_send_message` |
| `telegram` | `telegram_read_messages`, `telegram_send_message` |
| `whatsapp` | `whatsapp_send_message`, `whatsapp_send_template` |
| `onepassword` / `bitwarden` / `protonpass` | `<source>_search`, `<source>_read` |

When called without `sources` (e.g. from tests), the default is `["google_drive", "slack", "github"]` (`connectors.ts:358`). Jira is reachable through the Atlassian marketplace app rather than native tools (`connectors/types.ts:13`).

## 🔐 Scope enforcement (`src/connectors/service.ts`)

Every tool call runs the same two-step check inside `ConnectorService`:

1. **`getDecryptedConnector(orgId, source)`** (`service.ts:37-68`): loads the `workspace_connectors` row for the org, rejects missing/non-`active` connectors (`"Connector '<name>' is currently <status>."`), decrypts the credential with `decryptSecret({ ciphertext, iv, tag }, MESH_KEK)` + `unwrapConnectorSecret`, and returns `{ connector, token }`.
2. **`getAgentScope(agentId, connectorId)`** (`service.ts:73-90`): loads the agent's `agent_connector_grants` row; a missing grant throws `"Access Denied: This agent is not granted access to this connector."`. The grant's `scopeConfig` is a `ConnectorScopeConfig` (`types.ts:56-67`):

```typescript
export interface ConnectorScopeConfig {
  allowedFolders?: string[]     // Google Drive folder ids
  allowedChannels?: string[]    // Slack/Discord channel ids or Telegram chat ids
  allowedRepos?: string[]       // GitHub "owner/name"
  allowedRecipients?: string[]  // WhatsApp numbers, country code first
  allowedVaults?: string[]      // password-manager vault names/ids
  readOnly?: boolean            // no send tools at all, even with approval
}
```

Sends additionally pass `assertCanSend` (throws on `readOnly`) and `assertChannel`/recipient checks (`service.ts:259-268, 344-352`).

## 🔎 Tool reference

### Google Drive

**`gdrive_search`** — safe. Search files, spreadsheets and meeting notes.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `query` | string (min 1) | — | Search keywords or document title |
| `limit` | int 1–20 | `8` | Max results |

Searches within `scope.allowedFolders` (`service.ts:100-109`). Returns `{ query, count, files: [{ id, title, url, mime_type, last_modified, author }] }`.

**`gdrive_read_file`** — safe.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `file_id` | string (min 1) | Google Drive file ID from search results |

Returns `{ id, title, url, content, metadata }`; scope grant is verified but folders are not re-checked for a direct read (`service.ts:111-121`).

### Slack

**`slack_search`** — safe. Search messages across allowed channels.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `query` | string (min 1) | — | Search terms or topic |
| `limit` | int 1–20 | `10` | Max results |

Returns `{ query, count, messages: [{ id, title, url, content, channel, author, thread_ts }] }`.

**`slack_read_thread`** — safe.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `channel_id` | string (min 1) | Slack channel ID (e.g. `C123456`) |
| `thread_ts` | string (min 1) | Thread parent timestamp |

Channel must be in `allowedChannels` when the grant restricts them, otherwise `"Access Denied: Agent is not granted access to channel <id>"` (`service.ts:152-169`). Returns `{ id, title, url, discussion, reply_count }`.

**`slack_send_message`** — **dangerous** (approval gate). Post as the workspace bot.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `channel` | string (min 1) | Channel ID (`C123…`) or name without `#` |
| `text` | string (1–40,000) | Message text (Slack mrkdwn) |
| `thread_ts` | string | optional; reply inside that thread |

Requires a non-read-only grant and in-scope channel; returns `{ ok: true, channel, ts }`.

### GitHub

**`github_search_code`** — safe. Code search across allowed repos (`scope.allowedRepos` passed to the connector, `service.ts:173-188`).

| Parameter | Type | Default |
| :--- | :--- | :--- |
| `query` | string (min 1) | — |
| `limit` | int 1–20 | `10` |

Returns `{ query, count, items: [{ id, title, url, repo, path }] }`.

**`github_get_file`** — safe.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `repo` | string (min 1) | — | `owner/name` |
| `path` | string (min 1) | — | File path relative to repo root |
| `ref` | string | `"main"` | Branch, tag, or commit SHA |

Repo must be in `allowedRepos` when set (`service.ts:190-212`). Returns `{ title, url, content, metadata }`.

**`github_get_issue_or_pr`** — safe.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `repo` | string (min 1) | `owner/name` |
| `issue_number` | int ≥ 1 | Issue or PR number |

Same repo allowlist; returns `{ id, title, url, content, metadata }`.

> This is the **grant-scoped** connector toolset. The separate `github_bridge` tool ([./tool-github.md](./tool-github.md)) uses the org `github_bridge` tool credential and adds a `commit_file` action.

### Discord

**`discord_list_channels`** — safe.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `guild_id` | string, optional | Server ID; defaults to the one set on the connector |

With no guild configured it returns `{ guilds: [...], channels: [] }`; otherwise `{ guilds: [], channels: [...] }` filtered to `allowedChannels` (`service.ts:291-304`).

**`discord_read_messages`** — safe.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `channel_id` | string (min 1) | — | Discord channel ID |
| `limit` | int 1–100 | `25` | Max messages, newest first |

Returns `{ channel_id, count, messages }`.

**`discord_send_message`** — **dangerous**.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `channel_id` | string (min 1) | Discord channel ID |
| `content` | string (1–2,000) | Message text (Discord markdown) |

`assertCanSend` + `assertChannel` apply; returns `{ ok: true, ...sent }`.

### Telegram

**`telegram_read_messages`** — safe.

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `limit` | int 1–100 | `25` | Messages people sent the bot in the last 24 h, each with its chat ID |

Messages are filtered to `allowedChannels` (chat IDs) when set (`service.ts:325-330`).

**`telegram_send_message`** — **dangerous**.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `chat_id` | string (min 1) | Numeric chat ID from `telegram_read_messages`, or `@channelname` |
| `text` | string (1–4,096) | Message text |

Returns `{ ok: true, message_id }`.

### WhatsApp

**`whatsapp_send_message`** — **dangerous**. Text from the business number; works only within the 24-hour customer service window (otherwise use the template tool).

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `to` | string (min 7) | Phone number with country code, e.g. `+14155550123` |
| `text` | string (1–4,096) | Message text |

**`whatsapp_send_template`** — **dangerous**. Sends an approved template (needed to start a conversation).

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `to` | string (min 7) | — | Phone number with country code |
| `template` | string (min 1) | — | Template name as approved in WhatsApp Manager, e.g. `hello_world` |
| `language` | string (2–10) | `"en_US"` | Template language |

Both normalize the number (`normalizePhone`) and require it to be in `scope.allowedRecipients` when the grant restricts recipients (`service.ts:339-359`); returns `{ ok: true, message_id }`.

### Password managers (`onepassword` / `bitwarden` / `protonpass`)

Two parameterized tools are generated per source (`connectors.ts:368-395`). `NATIVE_CONNECTOR_SOURCES` (`types.ts:14-24`) lists all nine native sources.

**`<source>_search`** — safe. Find items by name; **returns titles and ids only, never the secret**.

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `query` | string (1–200) | Item name or fragment |
| `vault` | string (≤ 80), optional | Vault name/id, when the agent is limited to some vaults |

Grant `allowedVaults` override the connector config's vault list (`service.ts:371-395`).

**`<source>_read`** — **dangerous** (approval gate, because the result includes the password).

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `query` | string (1–200) | Item id or exact name from search |
| `vault` | string (≤ 80), optional | Vault name/id |

Executes `service.queryPassword({ ..., action: "read", signal })`.

## 📊 Tables, events, errors

| Concern | Details |
| :--- | :--- |
| DB tables | `workspace_connectors` (credentials + status), `agent_connector_grants` (agent ↔ connector + `scopeConfig`); read per call |
| Realtime events | none emitted by the tools themselves; only the standard audit events (`tool.started` / `tool.finished` / `tool.approval_requested` for dangerous sends) |
| Secrets | tokens decrypted per call, never persisted to `tool_calls` (audit layer redacts args/results) |
| Common errors | `"No connector configured for '<source>' in this workspace."`, `"Connector '<name>' is currently <status>."`, `"Access Denied: This agent is not granted access to this connector."`, `"Access Denied: this agent has read-only access to <Slack/Discord/…>."`, `"Access Denied: <label> <channel> is outside this agent's allowed list (…)."`, `"Access Denied: +<number> is not one of the numbers this agent may message."` |

## 🧪 Examples (from `builtins/connectors.test.ts`)

```typescript
// Default sources register 8 tools; only the send tool is dangerous
// (connectors.test.ts:40-57):
const tools = connectorTools(defaultOpts)
expect(tools.map((t) => t.name)).toEqual([
  "gdrive_search", "gdrive_read_file",
  "slack_search", "slack_read_thread", "slack_send_message",
  "github_search_code", "github_get_file", "github_get_issue_or_pr",
])
for (const tool of tools) {
  expect(tool.dangerous).toBe(tool.name === "slack_send_message")
}

// Messaging sources: every *_send_* tool is gated (connectors.test.ts:774-791)
for (const tool of connectorTools({ ...defaultOpts, sources: ["discord", "telegram", "whatsapp"] })) {
  expect(tool.dangerous).toBe(/_send_/.test(tool.name))
}

// Out-of-scope reads reject at the service layer, e.g.
// "Access Denied: Agent is not granted access to channel C01234567" (connectors.test.ts:460-465)
```

Related docs: [./tool-system.md](./tool-system.md) · [./tool-github.md](./tool-github.md) · [./approvals.md](./approvals.md) · [./secrets-broker.md](./secrets-broker.md) · [../../database/schema-connectors-and-vault.md](../../database/schema-connectors-and-vault.md) · [../../connectors.md](../../../connectors.md)
