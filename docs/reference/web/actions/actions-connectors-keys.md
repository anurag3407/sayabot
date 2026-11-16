# Connectors, Provider Keys, Vault & MCP (Server Actions)

This page documents the server actions behind the workspace "Connectors" and "Tools" settings: workspace connector CRUD with envelope-encrypted tokens, per-agent connector grants, provider API keys, the vault of org-wide secrets with per-agent grants, vector/embedding providers, MCP server registration, and the OAuth client helpers that connect external AI accounts (GitHub Copilot, OpenRouter) to the workspace.

Source files: `apps/web/src/lib/actions/connectors.ts`, `apps/web/src/lib/actions/keys.ts`, `apps/web/src/lib/actions/vault.ts`, `apps/web/src/lib/actions/vector-keys.ts`, `apps/web/src/lib/actions/mcp.ts`, `apps/web/src/lib/mcp-oauth.ts`, `apps/web/src/lib/connectors/types.ts`, `apps/web/src/lib/connectors/copilot.ts`, `apps/web/src/lib/connectors/openrouter.ts`, `apps/web/src/lib/connectors/pkce.ts`, `apps/web/src/lib/provider-key-store.ts`

---

## 🔗 Workspace connectors (`actions/connectors.ts`)

### Sources and credentials

`connectorSourceSchema` (`connectors.ts:20`) accepts: `google_drive`, `slack`, `github`, `jira`, `discord`, `telegram`, `whatsapp`, `onepassword`, `bitwarden`, `protonpass`. A connector is stored in `workspace_connectors` with the token sealed as `ciphertext` / `iv` / `tag` (AES-256-GCM via `encryptSecret(rawToken, getKek())` — `connectors.ts:114`) plus a `last4` preview and a free-form `config` JSON object.

### `saveWorkspaceConnector(_prev, formData)`

Org-admin form action that creates or updates (`connectorId` present → update, `connectors.ts:119`):

- Name 1–80 chars; per-source config fields: `driveDomain` → `config.domain`, `defaultChannel`, `defaultOrg`, `guildId` (Discord, digits 5–25), `phoneNumberId` (WhatsApp, digits 5–25, **required** for WhatsApp — `connectors.ts:81`).
- Password managers (`onepassword`, `bitwarden`, `protonpass`) choose `authMode`: `"computer"` (the Sayabot app signed in on a user's computer; token falls back to `"desktop"`) or `"api"` (token ≥ 4 chars). 1Password API mode additionally requires an https `connectUrl` (`connectors.ts:95`); Bitwarden records `region: "us" | "eu"` (`connectors.ts:106`).
- Telegram tokens must match `^\d+:[A-Za-z0-9_-]{20,}$` (the @BotFather format, `connectors.ts:110`).
- Updates keep the previous inbound webhook secret: if the stored envelope wraps an `inboundSecret`, the new token is re-wrapped with it via `wrapConnectorSecret` / `unwrapConnectorSecret` (`connectors.ts:130`); an unreadable old envelope is simply replaced.
- Update sets `status: "active"`, clears `error_message`; insert sets `auth_type: "token"`, `status: "active"`, `owner_user_id`. Audits `workspace_connector.updated` / `workspace_connector.created`.

### `deleteWorkspaceConnector(input)`

Org-admin plain-object action; the connector must belong to the org. Audit `workspace_connector.deleted` (`connectors.ts:209`).

### `testWorkspaceConnector(orgSlug, connectorId)`

Org-admin probe that decrypts the token (`unwrapConnectorSecret(decryptSecret(...))`, `connectors.ts:266`) and calls each provider's cheap identity endpoint:

| Source | Endpoint probe |
| :--- | :--- |
| `google_drive` | `GET googleapis.com/drive/v3/about?fields=user` → "Connected as \<email\>" |
| `slack` | `POST slack.com/api/auth.test` → "Connected to workspace … as @user" |
| `github` | `GET api.github.com/user` → "Connected as GitHub user @login" |
| `discord` | `GET discord.com/api/v10/users/@me` with `Bot <token>` → bot username |
| `telegram` | `GET api.telegram.org/bot<token>/getMe` — the response body/URL are never echoed back |
| password managers | `computer` mode reports "Saved for the app signed in on a computer…"; 1Password Connect pings `<connectUrl>/v1/vaults`; Bitwarden pings `api.bitwarden(.eu|.com)/public/secrets` |
| `whatsapp` | `GET graph.facebook.com/v21.0/<phoneNumberId>` → verified name + phone |

On success the row is set `active` with `last_synced_at` and the result reports latency; on failure the error message is scrubbed of the raw token (`split(token).join("[token]")` — `connectors.ts:397`) and the row is set `status: "error"` with `error_message`. A decryption failure marks the connector errored with "Decryption failed; check workspace master key" (`connectors.ts:281`).

### Per-agent grants

- `saveAgentConnectorGrant(_prev, formData)` (`connectors.ts:412`) — org-admin. Builds a `scope_config` from form text lists: `allowedFolders`, `allowedChannels` (leading `#` stripped), `allowedRepos`, `allowedRecipients` (phone numbers normalized to digits, `^\d{7,15}$`), `allowedVaults` (max 20, ≤ 80 chars, may not start with `-`), and `readOnly`. Upserts into `agent_connector_grants` per `(org, agent, connector)`; audit `agent_connector_grant.saved`.
- `deleteAgentConnectorGrant(input)` (`connectors.ts:521`) — org-admin hard delete; audit `agent_connector_grant.deleted`.

### Inbound chat wiring (`saveConnectorChat`)

`saveConnectorChat(_prev, formData)` (`connectors.ts:559`) points a Telegram, Discord, or WhatsApp connector at one room + one agent (the agent must already be in that room — "mention rooms only wake agents who are in them"). It:

1. Parses `allowedChats` (≤ 30 ids matching `^[-A-Za-z0-9_]{1,80}$`).
2. Decrypts the stored token; reuses the existing `inboundSecret` or mints one (`randomBytes(24).toString("base64url")`), then re-seals the envelope (`connectors.ts:598`).
3. Writes `config.inbound = { enabled, roomId, agentId, allowedChats }`.
4. Builds the callback `` `${getAppUrl()}/api/messaging/<source>/<connectorId>?k=<inboundSecret>` `` (`connectors.ts:613`) — this is the webhook consumed by `app/api/messaging/[platform]/[connectorId]` (see the webhooks/OAuth API reference).
5. For Telegram, calls `setWebhook` / `deleteWebhook` on the Bot API with `secret_token` = the inbound secret and `allowed_updates: ["message"]`; Telegram rejections become "Saved, but Telegram said: …" (`connectors.ts:622`). Discord/WhatsApp return instructions to configure intents / Meta callback URLs manually.

---

## 🗝️ Provider keys (`actions/keys.ts` + `lib/provider-key-store.ts`)

`storeProviderKey` (`provider-key-store.ts:25`) is the **single write path** for AI-account keys — Settings → AI providers, the Manage-AI-accounts dialog, and the OpenRouter/Copilot sign-ins all land here. It:

- Resolves the provider from `@/lib/ai-accounts`; custom servers require a `baseUrl` (`http(s)://`); local servers (Ollama, LM Studio) get the placeholder secret `"no-key-needed"` (`provider-key-store.ts:44`).
- Envelope-encrypts the secret (`encryptSecret(secret, getKek())`) into `provider_keys` with `ciphertext`/`iv`/`tag`/`last4`/`label` (≤ 60 chars).
- With `verify: true`, reads the provider's model list with the new key; a key the provider refuses (regex `REFUSED` — "refused this key", "HTTP 401/403", Copilot token refusals) is **deleted again** and its error returned (`provider-key-store.ts:84`); an unreachable provider yields "Saved, but its model list could not be read yet".
- Audits `provider_key.created` and revalidates; the result only ever carries `last4`.

Actions on top of it:

- `saveProviderKey(_prev, formData)` (`keys.ts:28`) — org-admin form action; provider must be one of the `PROVIDERS` enum from `@sayabot/core`, label 1–60 chars.
- `connectAccountAction(input)` (`keys.ts:54`) — org-admin object action with `verify: true`; success message is `"<note>"`, `"Connected · N models"`, or `"Connected"`.
- `deleteProviderKey(input)` (`keys.ts:80`) — org-admin hard delete; audit `provider_key.deleted` with label and last4.
- `testProviderKey(orgSlug, keyId, modelOverride?)` (`keys.ts:106`) — decrypts via `providerKeyToApiKey(...)`, builds a language model with `createLanguageModel`, and sends the prompt `"Reply with the single word: ok"` with a 25-second timeout and 8 output tokens; failures are redacted through `redactSecrets`. The model id defaults to `defaultModel(provider)`, then `DEV_OPENAI_COMPAT_MODEL`; custom endpoints without a model fail with "Enter a model name to test custom endpoints".

---

## 🧨 Vault secrets (`actions/vault.ts`)

Org-wide secrets in `vault_secrets`, sealed with `sealSecret(rawValue, getKek())` (single-column envelope) plus `last4`. Kinds: `api_token`, `basic_auth`, `password`, `header_set`, `github_app` (`vault.ts:20`).

- `saveVaultSecret(_prev, formData)` (`vault.ts:28`) — org-admin; label 1–80, value required. Audit `vault.secret_created` (metadata: label, kind, last4). The full row (without the seal) is returned.
- `rotateVaultSecret(_prev, formData)` (`vault.ts:85`) — org-admin; re-seals and stamps `rotated_at`; audit `vault.secret_rotated`.
- `deleteVaultSecret(_prev, formData)` (`vault.ts:131`) — org-admin delete scoped by org; audit `vault.secret_deleted`.
- `grantSecret(_prev, formData)` (`vault.ts:164`) — the secret broker's per-agent grant row in `agent_secret_grants`:
  - `envName` must match `^[A-Z][A-Z0-9_]{1,63}$` (e.g. `STRIPE_API_KEY`).
  - `allowedHosts` — at least one, each validated by `isValidHostPattern` from `@sayabot/core` (domains or `*.domain` wildcards; IPs and bare wildcards rejected — `vault.ts:193`).
  - `injectMode` ∈ `header | basic | query | body`; `requiresApproval` from a truthy flag.
  - A random `placeholder` `saaya_ph_<32 hex chars>` is stored so the orchestrator can substitute the real secret at request time without the model ever seeing it (`vault.ts:201`).
  - Audit `vault.grant_created`.
- `revokeGrant(_prev, formData)` (`vault.ts:235`) — soft-revokes by `revoked_at`; audit `vault.grant_revoked`.

---

## 🧮 Vector & embedding providers (`actions/vector-keys.ts`)

`vector_providers` rows (`kind: "vector_db" | "embedding"`) hold an encrypted credential, an optional `endpoint_url`, and `config` (`indexName`, `dimension`, `namespace`).

- `saveVectorProvider(_prev, formData)` (`vector-keys.ts:22`) — org-admin. Embedded providers (`pglite`, `fastembed_local`) need no key — the literal `"local-embedded-key"` is stored and `last4` shows `"local"`. `openai_compatible` may also omit the key (stored as `"no-key"`, `last4` `"local"`) for a local server with no auth. Every other provider needs a credential ≥ 4 chars. Endpoint must start with `http(s)://` or `postgres(ql)://`. The first provider of a kind, or one saved with `makeActive`, becomes active and deactivates all others of that kind. Audit `vector_provider.created`.
- `setActiveVectorProvider(input)` (`vector-keys.ts:121`) — org-admin; deactivates all of the same kind, activates the target; audit `vector_provider.activated`.
- `deleteVectorProvider(input)` (`vector-keys.ts:166`) — org-admin; if the deleted row was active, the oldest remaining provider of that kind is promoted. Audit `vector_provider.deleted`.
- `testVectorProvider(orgSlug, providerId)` (`vector-keys.ts:216`) — provider-specific probes with 10-second timeouts: Pinecone `POST /describe_index_stats` (requires an index host URL), Qdrant `GET /collections`, Gemini `text-embedding-004:embedContent`, Voyage `voyage-3` embeddings, OpenAI `text-embedding-3-small` embeddings; pgvector-style providers get a connection-string format check; embedded providers answer instantly. Failures are redacted via `redactSecrets`.

---

## 🧩 MCP servers (`actions/mcp.ts`)

MCP servers live in `mcp_servers` (transport `http` | `sse`, optional room scoping, `dangerous_tools` list). Header credentials are sealed in `headers_enc` as `sealSecret(JSON.stringify({ headers }), getKek())` (`mcp.ts:96`).

- `addMcpServer(_prev, formData)` (`mcp.ts:60`) — org-admin; name 1–60, URL `http(s)://`, headers must be a JSON object of strings (`parseHeaders`, `mcp.ts:33`), optional room must belong to the org. Audit `mcp_server.created`.
- `updateMcpServer(_prev, formData)` (`mcp.ts:114`) — org-admin; toggles `enabled`, edits `dangerous_tools`, and optionally URL/headers. Audit `mcp_server.updated`.
- `setMcpServerRoomAction({ orgSlug, serverId, roomId })` (`mcp.ts:478`) — org-admin; sets `mcp_servers.room_id`: `null` lets agents in every room use the app, a room id limits it to that room (which must belong to the org). Used by "Only this room" / "Use in all rooms" in [room settings](../pages/room-settings-ui.md). Audit `mcp_server.scope_changed`.
- `listMcpTools(orgSlug, serverId)` (`mcp.ts:158`) — org-admin; connects with `createMCPClient` from `@ai-sdk/mcp` using `redirect: "error"` (no browser-side redirects) and the OAuth provider from `mcpAuthProviderFor` (see below), returns `{ name, description }` per tool. `stdio` servers (program-run-on-use) report "This program runs when an agent uses it."
- `invokeMcpTool(orgSlug, serverId, toolName, argsJson)` (`mcp.ts:191`) — org-admin "Try a tool": args must be a JSON object; returns `result.content` and flags `isError`.
- `saveOrgToolConfig(_prev, formData)` (`mcp.ts:238`) — org-admin settings for built-in tools in `org_tool_configs` (`config_enc` sealed JSON, unique per `(org_id, tool)`). Built-in ids (`mcp.ts:25`): `github_bridge` (GitHub token), `web_search` (provider + optional key/baseUrl; keyless providers `duckduckgo`/`searxng` need no key, others keep the previously saved key when the field is left blank), `document_extract` (provider `docling`/`marker`/`tesseract`/`vision_llm` and `fallbackToVision`), `terminal_sandbox` (`local`/`docker` or hosted), and `postgres_inspector` (PostgreSQL connection string, must start `postgres(ql)://`). Audit `tool_config.updated`.
- `testWebSearchAction(_prev, formData)` (`mcp.ts:365`) and `testDocumentOcrAction(_prev, formData)` (`mcp.ts:416`) — org-admin test actions that fall back to the saved key from `org_tool_configs` and delegate to the orchestrator (`testWebSearchInOrchestrator` / `testDocumentOcrInOrchestrator`, see the server-actions overview). OCR defaults to a Docling sample PDF and reports tables, page count, markdown preview, and whether it fell back to vision.

---

## 🔐 MCP OAuth bookkeeping (`lib/mcp-oauth.ts`)

Helper glue between MCP servers and the OAuth state stored per row (`mcp_servers.oauth_enc`):

- `mcpOAuthRedirectUrl()` — `` `${getAppUrl()}/api/mcp/oauth/callback` `` (`mcp-oauth.ts:12`), the callback vendors redirect back to.
- `persistMcpOAuth(serverId)` — returns a callback the LLM package calls to save the sealed sign-in state (`sealMcpOAuthState(state, getKek())`, `mcp-oauth.ts:17`); refreshed tokens are persisted transparently.
- `readMcpOAuth(row)` — opens the sealed state; unreadable/missing state returns `null`.
- `mcpAuthProviderFor(row)` (`mcp-oauth.ts:40`) — builds a `StoredMcpOAuthProvider` for rows with `auth_kind: "oauth"`; throws "Sign in first" when no tokens exist, and flips `auth_status: "signed_out"` when a refresh is refused.

---

## 🤝 Connector OAuth clients (`lib/connectors/`)

### GitHub Copilot device flow (`copilot.ts`)

- Constants (`copilot.ts:3`): client id `Iv1.b507a08c87ecfe81` (the official Copilot CLI client), device-code URL `github.com/login/device/code`, access-token URL `github.com/login/oauth/access_token`, internal token URL `api.github.com/copilot_internal/v2/token`.
- `startCopilotDeviceFlow()` requests a device code (`scope: "read:user"`) and returns `{ deviceCode, userCode, verificationUri, expiresIn, interval }`.
- `pollCopilotDeviceCode(deviceCode)` maps GitHub errors to `pending | slow_down | expired | denied` and hands back the GitHub token when granted.
- `getCopilotInternalToken(githubToken)` exchanges it for the short-lived Copilot token (masquerading as `GitHubCopilotChat/0.22.4`, `vscode/1.96.2` — `copilot.ts:92`) and derives the plan (`individual | business | enterprise`) from the `sku`. A non-OK response fails with "Could not verify active GitHub Copilot subscription".

### OpenRouter PKCE flow (`openrouter.ts` + `pkce.ts`)

- `buildOpenRouterOAuthUrl(callbackUrl)` (`openrouter.ts:67`) — generates a 64-byte code verifier, S256 challenge, and auth URL at `https://openrouter.ai/auth` with `callback_url`, `code_challenge`, `code_challenge_method=S256`.
- `exchangeOpenRouterCode(code, codeVerifier)` POSTs to `https://openrouter.ai/api/v1/auth/keys` and returns `{ apiKey }` from `data.key`.
- `getOpenRouterKeyDetails(apiKey)` (`openrouter.ts:111`) reads `/auth/key` (label, usage, limit, free tier flag, rate limit) and `/credits` (remaining balance) in parallel.
- `openRouterFailureExplanation(errorMessage, modelId)` (`openrouter.ts:159`) maps HTTP 402 / privacy-policy blocks / free-tier 429s to friendly explanations (`OPENROUTER_FAILURES`); `isFreeOpenRouterModel` detects `:free` ids or zero pricing; `OPENROUTER_FREE_MODELS_PREFERENCE` ranks free tool-calling fallbacks.
- `pkce.ts` — `generateCodeVerifier(length = 64)` and `generateCodeChallenge(verifier)` using WebCrypto SHA-256, base64url-encoded, working in browser and Node (`pkce.ts:17`).

### Shared types (`types.ts`)

`ConnectorProvider` (openrouter, openai, copilot, anthropic, google, groq, cerebras, opencode, command-code, deepseek, minimax, grok, kimi, qwen, cursor, custom), `SubscriptionTier` (per-provider subscription labels plus `byok`), `ConnectorAccount` (id, provider, label, email, status `connected | needs_setup | expired | rate_limited`, subscription badge/tier/balance, models count, last4, baseUrl), and `DeviceCodeFlow` (`types.ts:38`–63).

---

Related docs: [Settings UI](../pages/settings-ui.md), [Security model](../../architecture/security-model.md), [System overview](../../architecture/system-overview.md), [Auth & authorization](../../architecture/auth-and-authorization.md)
