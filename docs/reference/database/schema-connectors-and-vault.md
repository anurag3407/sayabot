# Connectors & Vault Schemas

This reference documents the Drizzle schemas that back Sayabot's two secret-bearing subsystems: **workspace connectors** (`workspace_connectors`, `agent_connector_grants`, `messaging_inbound`) and the **secrets vault** (`vault_secrets`, `agent_secret_grants`, `org_quotas`). Both follow the Tier-1 / Tier-2 model — workspace admins store encrypted credentials, individual agents receive scoped grants — and both never store plaintext: connector tokens are sealed with AES-256-GCM into separate `ciphertext` / `iv` / `tag` columns, while vault secrets are sealed into a single `sealed` envelope string.

Source files: `packages/db/src/schema/connectors.ts`, `packages/db/src/schema/vault.ts`, `packages/db/src/schema/enums.ts` (shared enums)

---

## Workspace Connectors (`workspace_connectors`)

Tier-1 workspace-level connector credentials, defined at `packages/db/src/schema/connectors.ts:15`. One row per connected external service (Slack, Google Drive, GitHub, Jira, and the chat platforms Discord, Telegram, WhatsApp). The secret is encrypted with AES-256-GCM via `MESH_KEK` and stored split across three columns; the orchestrator decrypts it only server-side when executing an authorized connector call.

| Column           | SQL type      | Constraints / Default                              | Description                                                                                                                                                                                                                             |
| :--------------- | :------------ | :------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `uuid`        | PK, `gen_random_uuid()` default                    | Connector row identifier.                                                                                                                                                                                                               |
| `org_id`         | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`      | Owning workspace.                                                                                                                                                                                                                       |
| `owner_user_id`  | `uuid`        | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Admin who connected the service.                                                                                                                                                                                                        |
| `source`         | `text`        | NOT NULL                                           | Connector type as free text: `google_drive`, `slack`, `github`, `jira`, `discord`, `telegram`, `whatsapp` (comment at `packages/db/src/schema/connectors.ts:23`). Not a Postgres enum — new providers can be added without a migration. |
| `name`           | `text`        | NOT NULL                                           | Human-readable display name.                                                                                                                                                                                                            |
| `status`         | `text`        | NOT NULL, default `"active"`                       | Connection health/lifecycle flag.                                                                                                                                                                                                       |
| `auth_type`      | `text`        | NOT NULL, default `"token"`                        | Credential style (e.g. `token` vs OAuth variants).                                                                                                                                                                                      |
| `ciphertext`     | `text`        | NOT NULL                                           | Base64 AES-256-GCM ciphertext of the raw token.                                                                                                                                                                                         |
| `iv`             | `text`        | NOT NULL                                           | Base64 12-byte initialization vector.                                                                                                                                                                                                   |
| `tag`            | `text`        | NOT NULL                                           | Base64 16-byte GCM auth tag.                                                                                                                                                                                                            |
| `last4`          | `text`        | NOT NULL                                           | Last four characters of the token for UI display.                                                                                                                                                                                       |
| `config`         | `jsonb`       | NOT NULL, default `{}`                             | Provider-specific configuration (folders, channels, repos).                                                                                                                                                                             |
| `last_synced_at` | `timestamptz` | nullable                                           | Last successful sync with the provider.                                                                                                                                                                                                 |
| `error_message`  | `text`        | nullable                                           | Last sync/connection error, if any.                                                                                                                                                                                                     |
| `created_at`     | `timestamptz` | NOT NULL, default `now()`                          | Row creation time.                                                                                                                                                                                                                      |
| `updated_at`     | `timestamptz` | NOT NULL, default `now()`                          | Last update time.                                                                                                                                                                                                                       |

Indexes (`packages/db/src/schema/connectors.ts:37-40`):

- `workspace_connectors_org_idx` on `(org_id)`
- `workspace_connectors_source_idx` on `(org_id, source)`

Row types exported: `WorkspaceConnectorRow`, `NewWorkspaceConnectorRow` (`packages/db/src/schema/connectors.ts:82-83`).

---

## Agent Connector Grants (`agent_connector_grants`)

Tier-2 agent scoping, defined at `packages/db/src/schema/connectors.ts:45`. A grant binds one agent to one workspace connector and carries the scope document that the orchestrator validates before every search/read/mutation. Plaintext-adjacent data never appears here — only the JSON scope.

| Column         | SQL type      | Constraints / Default                                         | Description                                                       |
| :------------- | :------------ | :------------------------------------------------------------ | :---------------------------------------------------------------- |
| `id`           | `uuid`        | PK, `gen_random_uuid()` default                               | Grant row identifier.                                             |
| `org_id`       | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`                 | Owning workspace.                                                 |
| `agent_id`     | `uuid`        | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE`               | Agent receiving the grant.                                        |
| `connector_id` | `uuid`        | NOT NULL, FK → `workspace_connectors.id`, `ON DELETE CASCADE` | Connector being granted.                                          |
| `scope_config` | `jsonb`       | NOT NULL, default `{}`                                        | Scope document, e.g. `{ readOnly: true, allowedFolders: [...] }`. |
| `created_at`   | `timestamptz` | NOT NULL, default `now()`                                     | Grant creation time.                                              |

Indexes (`packages/db/src/schema/connectors.ts:61-63`): `agent_connector_grants_agent_idx` on `(org_id, agent_id)`.

Row types exported: `AgentConnectorGrantRow`, `NewAgentConnectorGrantRow` (`packages/db/src/schema/connectors.ts:84-85`).

---

## Messaging Inbound Deduplication (`messaging_inbound`)

Defined at `packages/db/src/schema/connectors.ts:67`. A small dedupe ledger for inbound chat-platform messages: because messaging webhooks (Discord, Telegram, WhatsApp) retry on timeout, this table records each external message ID so a retried webhook does not start a second agent turn.

| Column         | SQL type      | Constraints / Default                                         | Description                                                   |
| :------------- | :------------ | :------------------------------------------------------------ | :------------------------------------------------------------ |
| `connector_id` | `uuid`        | NOT NULL, FK → `workspace_connectors.id`, `ON DELETE CASCADE` | Connector the message arrived on. Part of the uniqueness key. |
| `external_id`  | `text`        | NOT NULL                                                      | Provider-side message ID. Part of the uniqueness key.         |
| `message_id`   | `uuid`        | nullable                                                      | Sayabot `messages.id` created for the first delivery.         |
| `created_at`   | `timestamptz` | NOT NULL, default `now()`                                     | First-seen time.                                              |

Index: unique `messaging_inbound_pk` on `(connector_id, external_id)` (`packages/db/src/schema/connectors.ts:77`) — the dedupe constraint itself.

---

## Secrets Vault (`vault_secrets`)

Defined at `packages/db/src/schema/vault.ts:22`. Org-owned secrets that are not tied to a specific connector provider: arbitrary API tokens, basic-auth pairs, passwords, header sets, GitHub App credentials. The plaintext (optionally a JSON structure) is sealed with `sealSecret()` into one `sealed` envelope string.

| Column          | SQL type                 | Constraints / Default                              | Description                                                                                                         |
| :-------------- | :----------------------- | :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `id`            | `uuid`                   | PK, `gen_random_uuid()` default                    | Secret identifier.                                                                                                  |
| `org_id`        | `uuid`                   | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`      | Owning workspace.                                                                                                   |
| `owner_user_id` | `uuid`                   | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | User who stored the secret.                                                                                         |
| `label`         | `text`                   | NOT NULL                                           | Human-readable name used in UIs and `$SECRET{...}` references.                                                      |
| `kind`          | `vault_secret_kind` enum | NOT NULL                                           | One of `api_token`, `basic_auth`, `password`, `header_set`, `github_app` (`packages/db/src/schema/enums.ts:85-91`). |
| `sealed`        | `text`                   | NOT NULL                                           | Single-column sealed envelope (ciphertext+iv+tag combined) from `sealSecret()`.                                     |
| `last4`         | `text`                   | NOT NULL                                           | Last four characters for identification.                                                                            |
| `last_used_at`  | `timestamptz`            | nullable                                           | Last time a grant consumed this secret.                                                                             |
| `rotated_at`    | `timestamptz`            | nullable                                           | Last rotation time.                                                                                                 |
| `created_at`    | `timestamptz`            | NOT NULL, default `now()`                          | Row creation time.                                                                                                  |

Index: `vault_secrets_org_idx` on `(org_id)` (`packages/db/src/schema/vault.ts:38`).

---

## Agent Secret Grants (`agent_secret_grants`)

Defined at `packages/db/src/schema/vault.ts:41`. The vault counterpart of `agent_connector_grants`: it binds one vault secret to one agent and describes exactly how the orchestrator may inject it into an outbound HTTP request (header, basic auth, query param, or body field), to which hosts, and under which approval requirements. Agents reference secrets only through the unique `placeholder` token — plaintext is never visible to the model.

| Column              | SQL type      | Constraints / Default                                           | Description                                                                                                                                   |
| :------------------ | :------------ | :-------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | `uuid`        | PK, `gen_random_uuid()` default                                 | Grant identifier.                                                                                                                             |
| `org_id`            | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`                   | Owning workspace.                                                                                                                             |
| `agent_id`          | `uuid`        | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE`                 | Agent receiving the grant.                                                                                                                    |
| `secret_id`         | `uuid`        | NOT NULL, FK → `vault_secrets.id`, `ON DELETE CASCADE`          | Secret being granted.                                                                                                                         |
| `env_name`          | `text`        | NOT NULL                                                        | Environment-variable style name (e.g. `PROD_API_KEY`). Unique per agent.                                                                      |
| `placeholder`       | `text`        | NOT NULL, UNIQUE                                                | Placeholder token (e.g. `$SECRET{PROD_API_KEY}`) agents write in prompts/config.                                                              |
| `allowed_hosts`     | `text[]`      | NOT NULL                                                        | Host allowlist; the broker refuses injections to other hosts.                                                                                 |
| `inject`            | `jsonb`       | NOT NULL, default `{ mode: "header" }`, typed `GrantInjectSpec` | Injection spec: `mode` of `header` \| `basic` \| `query` \| `body`, optional `template` or `param` (`packages/db/src/schema/vault.ts:16-20`). |
| `methods`           | `text[]`      | nullable                                                        | Optional HTTP method restriction (e.g. `["GET","POST"]`).                                                                                     |
| `requires_approval` | `boolean`     | NOT NULL, default `false`                                       | When true, use of this grant must pass the human approval gate.                                                                               |
| `expires_at`        | `timestamptz` | nullable                                                        | Grant expiry.                                                                                                                                 |
| `revoked_at`        | `timestamptz` | nullable                                                        | Set when the grant is revoked.                                                                                                                |
| `last_used_at`      | `timestamptz` | nullable                                                        | Last consumption time.                                                                                                                        |
| `created_at`        | `timestamptz` | NOT NULL, default `now()`                                       | Grant creation time.                                                                                                                          |
| `created_by`        | `uuid`        | nullable, FK → `profiles.id`, `ON DELETE SET NULL`              | Admin who created the grant.                                                                                                                  |

Indexes (`packages/db/src/schema/vault.ts:66-71`):

- unique `agent_secret_grants_agent_env_idx` on `(agent_id, env_name)`
- `agent_secret_grants_agent_idx` on `(agent_id)`
- `agent_secret_grants_secret_idx` on `(secret_id)`
- `agent_secret_grants_placeholder_idx` on `(placeholder)`

Note: the `secret_inject` Postgres enum (`header`, `basic`, `query`, `body`; `packages/db/src/schema/enums.ts:92`) mirrors the inject modes, but the `inject` column itself is `jsonb` so a `GrantInjectSpec` can carry `template`/`param` fields alongside the mode.

---

## Organization Quotas (`org_quotas`)

Defined at `packages/db/src/schema/vault.ts:74`. One row per workspace bounding compute and secret usage; `org_id` is the primary key, so quotas are always exactly one row per org.

| Column                  | SQL type  | Constraints / Default                   | Description                                      |
| :---------------------- | :-------- | :-------------------------------------- | :----------------------------------------------- |
| `org_id`                | `uuid`    | PK, FK → `orgs.id`, `ON DELETE CASCADE` | The workspace being limited.                     |
| `max_agents`            | `integer` | NOT NULL, default `25`                  | Maximum agents in the workspace.                 |
| `max_computers`         | `integer` | NOT NULL, default `5`                   | Maximum provisioned agent computers.             |
| `max_running_computers` | `integer` | NOT NULL, default `2`                   | Concurrently running computers cap.              |
| `max_disk_mb_total`     | `integer` | NOT NULL, default `20480`               | Total sandbox disk budget in MB (20 GB default). |
| `max_secrets`           | `integer` | NOT NULL, default `50`                  | Maximum vault secrets.                           |
| `egress_mode`           | `text`    | NOT NULL, default `"open"`              | Outbound network posture for sandboxes.          |
| `egress_allowlist`      | `text[]`  | NOT NULL, default `[]`                  | Hosts allowed when egress is restricted.         |

---

## Encryption and access pattern

1. Tier-1: an admin creates the connector/vault secret; the web app encrypts with `encryptSecret(...)` (split `ciphertext`/`iv`/`tag`) or `sealSecret(...)` (single `sealed` string) using `MESH_KEK` before insert.
2. Tier-2: grants are created per agent. The orchestrator's `ConnectorService` decrypts the Tier-1 credential only after verifying the agent's `scope_config` grant, and the secret broker rewrites `$SECRET{...}` placeholders at request time.
3. All agent-visible surfaces reference secrets by `placeholder` or by connector name — no table in this schema stores plaintext, and RLS in `packages/db/sql/0002_rls.sql` confines reads to the owning org.

---

## Related docs

## Agent gateways

`agent_gateways` (per-agent Telegram/Discord bot accounts), `gateway_inbound` (delivery dedup ledger) and `external_chats` (the bound chat's room) live in `packages/db/src/schema/gateways.ts`, `packages/db/sql/0041_agent_gateways.sql` and `packages/db/sql/0042_gateway_one_channel.sql`. `bound_chat_id` and `room_id` pin each gateway to one chat and one room. Tokens use the same sealed envelope as connectors, so `decryptSecret` + `unwrapConnectorSecret` read both. See [agent gateways](../orchestrator/platform/agent-gateways.md) and the [migrations catalog](./migrations-catalog.md).

---

- [Database reference overview](./overview.md)
- [Computers, Devices & Desktop schemas](./schema-computers-devices-desktop.md)
- [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)
- [Billing schema](./schema-billing.md)
- [Migrations catalog](./migrations-catalog.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Seed script](./seed.md)
