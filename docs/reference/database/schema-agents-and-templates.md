# Agents & Templates Schemas

This reference documents `packages/db/src/schema/agents.ts` — the agent row itself (`agents`), its per-org LLM provider keys (`provider_keys`), programmatic API keys (`agent_api_keys`), and per-org tool configuration (`org_tool_configs`) — plus `packages/db/src/schema/templates.ts` (`agent_templates`), the marketplace-style presets agents are created from. Capabilities are stored as a single `jsonb` column typed by `AgentCapabilities` from `@sayabot/core`; provider keys and webhook secrets are always stored envelope-encrypted (`ciphertext`/`iv`/`tag`), never plaintext.

Two related tables live elsewhere on purpose: `agent_connector_grants` is in `packages/db/src/schema/connectors.ts:39` (see [Connectors & Vault schemas](./schema-connectors-and-vault.md)), and the agent read cursors (`agent_reads`) are in `packages/db/src/schema/rooms.ts:126` (see [Rooms, messages & canvas schemas](./schema-rooms-messages-canvas.md)).

Source files: `packages/db/src/schema/agents.ts`, `packages/db/src/schema/templates.ts`, `packages/db/src/schema/enums.ts`, `packages/core/src/capabilities.ts`, `packages/db/migrations/0000_conscious_natasha_romanoff.sql`, `packages/db/sql/0009_bot_platform.sql`, `packages/db/sql/0015_agent_templates_unique.sql`, `packages/db/sql/0002_rls.sql`

---

## Provider keys (`provider_keys`)

Defined at `packages/db/src/schema/agents.ts:17`. Org-scoped LLM API keys that agents reference through `agents.provider_key_id`. The raw key never leaves the encryption layer: the table stores the AES-256-GCM envelope (`ciphertext`, `iv`, `tag`) produced by `encryptSecret` from `@sayabot/llm`, plus `last4` for UI display.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Key id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace. |
| `owner_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | User who added the key (for BYO-key attribution). |
| `provider` | `provider` enum | NOT NULL | One of `openai`, `anthropic`, `google`, `groq`, `cerebras`, `openai-compatible` (`packages/db/src/schema/enums.ts:8-15`). |
| `base_url` | `text` | nullable | Custom endpoint (used for `openai-compatible` providers and proxies). |
| `label` | `text` | NOT NULL | Display name in settings. |
| `ciphertext` | `text` | NOT NULL | Base64 ciphertext of the API key (envelope crypto). |
| `iv` | `text` | NOT NULL | Base64 12-byte nonce. |
| `tag` | `text` | NOT NULL | Base64 16-byte GCM auth tag. |
| `last4` | `text` | NOT NULL | Last four characters for "key ending in …" UI. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation time. |

Indexes: `provider_keys_org_idx` on `(org_id)` (`agents.ts:34`).

**RLS**: RLS is enabled but **no client policies exist** — the comment in `packages/db/sql/0002_rls.sql:215-216` says it outright: "provider_keys, agent_api_keys and org_tool_configs intentionally have no policies: ciphertext is only reachable through the service role." Clients read the sanitized `provider_keys_public` view instead (`0002_rls.sql:220-226`), which exposes `id`, `org_id`, `owner_user_id`, `provider`, `base_url`, `label`, `last4`, `created_at` — no ciphertext columns — filtered by `is_org_member(org_id)`.

**Used by**: the orchestrator LLM runner, which decrypts the referenced key at turn time (`apps/orchestrator/src/runner/llm.ts`) and resolves per-room model overrides (`apps/orchestrator/src/runner/room-model.ts`).

---

## Agents (`agents`)

Defined at `packages/db/src/schema/agents.ts:37`. The central row per bot: identity, default model wiring, prompt, and capabilities. Base columns come from the Drizzle snapshot (`migrations/0000_conscious_natasha_romanoff.sql`); the bot-platform migration added `template_id`, `owner_user_id`, `visibility`, `avatar`, and `bio` (`packages/db/sql/0009_bot_platform.sql:63-68`). A database trigger keeps `updated_at` fresh (`packages/db/sql/0001_functions.sql:13-25`).

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Agent id; also names its computer container (`saaya-bot-${agentId}`). |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace. |
| `handle` | `text` | NOT NULL | `@`-mention handle; unique per org (see indexes). |
| `display_name` | `text` | NOT NULL | Chat-visible name. |
| `kind` | `agent_kind` enum | NOT NULL, default `"llm"` | `llm` (orchestrator runs the loop) or `external` (webhook-driven bot) (`enums.ts:7`). |
| `provider_key_id` | `uuid` | nullable, FK → `provider_keys.id`, `ON DELETE SET NULL` | Which org key this agent uses. |
| `model` | `text` | nullable | Default model identifier; null lets the runner pick the provider default. |
| `system_prompt` | `text` | NOT NULL, default `""` | Agent persona/instructions. |
| `params` | `jsonb` | NOT NULL, default `{}` | Free-form model params (temperature, max tokens, …). |
| `tool_ids` | `uuid[]` | NOT NULL, default `[]` | References into the tools registry rows this agent has enabled. |
| `webhook_url` | `text` | nullable | Outbound webhook target for `external` agents. |
| `webhook_secret_enc` | `text` | nullable | Sealed webhook signing secret (`sealSecret` envelope; plaintext never stored). |
| `template_id` | `uuid` | nullable, FK → `agent_templates.id`, `ON DELETE SET NULL` | Template the agent was created from (`0009_bot_platform.sql:64`). |
| `owner_user_id` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Private-agent owner (`0009_bot_platform.sql:65`). |
| `visibility` | `agent_visibility` enum | NOT NULL, default `"org"` | `org` (all members can add it) or `private` (owner-only) (`enums.ts:103`). |
| `avatar` | `text` | nullable | Avatar URL/emoji. |
| `bio` | `text` | nullable | Short description shown in the agents list. |
| `capabilities` | `jsonb` | NOT NULL, default `DEFAULT_CAPABILITIES` | Typed `AgentCapabilities` (`agents.ts:61`) — see below. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps (`updated_at` maintained by trigger). |

Indexes: unique `agents_org_handle_idx` on `(org_id, handle)` and `agents_org_idx` on `(org_id)` (`agents.ts:65-68`).

**Capabilities storage**: the `capabilities` jsonb is typed as `AgentCapabilities` and defaults to `DEFAULT_CAPABILITIES` from `packages/core/src/capabilities.ts:20`:

```typescript
export const DEFAULT_CAPABILITIES: AgentCapabilities = {
  canvas: true, tasks: true, sandbox: true, webSearch: true, document: true,
  github: true, postgres: true, mcp: true, computer: false, secrets: false,
  memory: true, subagents: true, cron: true, connectors: true,
}
```

The orchestrator's `buildTools()` gates tool availability on these flags, so `computer: false` / `secrets: false` by default means dangerous capabilities are strictly opt-in — matching AGENTS.md Rule 4's spirit of defaulting to least privilege.

**RLS** (`packages/db/sql/0002_rls.sql:118-122`): `agents_select` — readable by org members. Client writes are not permitted; agent CRUD runs through server actions/orchestrator as the service role.

**Used by**: nearly everything on the execution side — the turn coordinator and agent loop (`apps/orchestrator/src/coordinator/index.ts`), HTTP/SSE layer (`apps/orchestrator/src/http.ts`), plans (`apps/orchestrator/src/plans.ts`), bot replies (`apps/orchestrator/src/bot-reply.ts`), authorization (`apps/orchestrator/src/authz.ts`), push fan-out (`apps/orchestrator/src/push.ts`) — and the web app's agent management pages (`apps/web/src/app/(workspace)/[org]/agents/*`).

---

## Agent API keys (`agent_api_keys`)

Defined at `packages/db/src/schema/agents.ts:71`. Long-lived programmatic keys a bot uses to call the orchestrator API as itself. Only the SHA-style `key_hash` is stored; the full key is shown once at creation. `prefix` is both a display aid and a fast lookup handle.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Key id. |
| `agent_id` | `uuid` | NOT NULL, FK → `agents.id`, `ON DELETE CASCADE` | The bot this key authenticates. |
| `prefix` | `text` | NOT NULL, UNIQUE | Visible key prefix (also used to find the row before hashing the presented key). |
| `key_hash` | `text` | NOT NULL | Hash of the full secret; the raw key is never persisted. |
| `scopes` | `text[]` | NOT NULL, default `["messages:write"]` | What the key may do (`agents.ts:80`). |
| `label` | `text` | NOT NULL, default `"default"` | UI label. |
| `room_ids` | `uuid[]` | nullable | Optional room restriction; null = all rooms the agent belongs to. |
| `oauth_client_id` | `uuid` | nullable | Links a key to an OAuth client row when minted through that flow. |
| `expires_at` | `timestamptz` | nullable | Expiry; null = non-expiring. |
| `revoked_at` | `timestamptz` | nullable | Set on revocation. |
| `last_used_at` | `timestamptz` | nullable | Updated on each authenticated call. |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | Creation time. |

Indexes: `agent_api_keys_agent_idx` on `(agent_id)` (`agents.ts:89`).

**RLS**: enabled, no client policies (secret-bearing) — service-role only, per `packages/db/sql/0002_rls.sql:215-216`.

**Used by**: orchestrator bot authentication (`apps/orchestrator/src/bot/auth.ts`) for MCP/API callers.

---

## Org tool configs (`org_tool_configs`)

Defined at `packages/db/src/schema/agents.ts:92`. Workspace-level configuration for individual tools (e.g. search provider keys, GitHub app settings). One row per `(org, tool)`; the config blob is sealed with the KEK.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Row id. |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace. |
| `tool` | `text` | NOT NULL | Tool identifier (e.g. `web_search`, `github_bridge`). |
| `config_enc` | `text` | NOT NULL | Sealed config (envelope-encrypted JSON). |
| `enabled` | `boolean` | NOT NULL, default `true` | Kill-switch for the tool org-wide. |
| `updated_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Last editor. |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps (`updated_at` maintained by trigger). |

Indexes: unique `org_tool_configs_org_tool_idx` on `(org_id, tool)` (`agents.ts:106`).

**RLS**: enabled, no client policies (secret-bearing) — service-role only (`0002_rls.sql:215-216`). Admins read the sanitized `org_tool_configs_public` view (`id`, `org_id`, `tool`, `enabled`, `updated_at`, no config) gated by `is_org_admin(org_id)` (`0002_rls.sql:229-233`).

**Used by**: the orchestrator secrets/tools layer, which opens the sealed config before a tool executes (`apps/orchestrator/src/tools/secrets.ts`).

---

## Agent templates (`agent_templates`)

Defined at `packages/db/src/schema/templates.ts:32` (created `packages/db/sql/0009_bot_platform.sql:24-52`). Marketplace presets: a template carries the prompt, default model, capabilities, required secret slots, and starter tasks; creating an agent from one copies these values into the new `agents` row (`agents.template_id` records the origin). `org_id` is **nullable** — null rows are global templates shipped with the product; non-null rows are workspace-private templates.

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | PK, default `gen_random_uuid()` | Template id. |
| `org_id` | `uuid` | nullable, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace; **null = global template**. |
| `slug` | `text` | NOT NULL | URL/slug identifier; unique per org including the null-org case (see indexes). |
| `name` | `text` | NOT NULL | Display name. |
| `description` | `text` | NOT NULL, default `""` | Marketplace blurb. |
| `icon` | `text` | nullable | Icon identifier/emoji. |
| `category` | `text` | NOT NULL, default `"general"` | Marketplace category. |
| `system_prompt` | `text` | NOT NULL, default `""` | Copied into `agents.system_prompt` on instantiation. |
| `default_provider` | `provider` enum | nullable | Suggested provider; null = runner default. |
| `default_model` | `text` | nullable | Suggested model identifier. |
| `params` | `jsonb` | NOT NULL, default `{}` | Suggested model params. |
| `capabilities` | `jsonb` | NOT NULL, default `DEFAULT_CAPABILITIES` | Typed `AgentCapabilities` copied into new agents (`templates.ts:46`). |
| `secret_slots` | `jsonb` | NOT NULL, default `[]` | Typed `SecretSlot[]` (`templates.ts:47`) — see below. |
| `starter_tasks` | `jsonb` | NOT NULL, default `[]` | Typed `StarterTask[]` (`templates.ts:48`). |
| `created_by` | `uuid` | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Author (workspace templates). |
| `created_at` / `updated_at` | `timestamptz` | NOT NULL, default `now()` | Timestamps. |

Indexes: unique `agent_templates_org_slug_idx` on `(org_id, slug)` **with `nulls not distinct`** and `agent_templates_org_idx` on `(org_id)` (`templates.ts:53-56`). The `nulls not distinct` semantics were fixed in `packages/db/sql/0015_agent_templates_unique.sql:3-4`, which drops and recreates the index so `ON CONFLICT (org_id, slug)` works for both NULL and non-NULL `org_id` — without it, Postgres treats NULL org slugs as always-distinct and upserts of global templates would insert duplicates.

**RLS** (`packages/db/sql/0009_bot_platform.sql:50-62`): `agent_templates_read` — everyone can read global templates (`org_id is null`) and members can read their org's; `agent_templates_write` — only org admins (`is_org_admin`) may modify their org's templates. Global templates are edited via seed/migrations only.

### `SecretSlot` shape (`templates.ts:15-25`)

Each entry declares one secret the instantiated agent will need in its vault:

```typescript
export interface SecretSlot {
  envName: string
  label: string
  kind: "api_token" | "basic_auth" | "password" | "header_set" | "github_app"
  hosts: string[]
  inject: { mode: "header" | "basic" | "query" | "body"; template?: string; param?: string }
  methods?: string[]
  requiresApproval?: boolean
  required: boolean
  helpUrl?: string
}
```

`kind` mirrors the `vault_secret_kind` enum and `inject.mode` the `secret_inject` enum (`packages/db/src/schema/enums.ts:85-92`). `requiresApproval: true` marks slots whose use must pass the human approval gate (AGENTS.md Rule 4). The values land in `vault_secrets` / `agent_secret_grants` when the agent is created (see [Connectors & Vault schemas](./schema-connectors-and-vault.md)).

### `StarterTask` shape (`templates.ts:27-30`)

```typescript
export interface StarterTask {
  title: string
  description?: string
}
```

Optional task suggestions seeded onto the room/task board when an agent is instantiated from the template.

**Used by**: the marketplace UI (`apps/web/src/components/marketplace/marketplace-view.tsx`) and the seed script that installs the global catalog (`packages/db/src/seed.ts`).

---

## Discrepancy notes (code vs AGENTS.md)

- AGENTS.md's directory map mentions "agent templates" and connector grants under general agent concepts; concretely, `agent_connector_grants` is **not** in `schema/agents.ts` — it is defined in `packages/db/src/schema/connectors.ts:39` and created by `packages/db/sql/0018_workspace_connectors.sql`. AGENTS.md's tiered connector model (Tier-1 `workspace_connectors`, Tier-2 `agent_connector_grants`) matches the code.
- AGENTS.md shows a tool-spec capability gate keyed off flags like `canvas`/`webSearch`; the actual `DEFAULT_CAPABILITIES` in `packages/core/src/capabilities.ts:20` additionally includes `document` and `connectors` flags not present in AGENTS.md's example interface, and `computer` is a boolean (with the profile chosen elsewhere) rather than the nested `{ profile }` object shown in AGENTS.md.

---

## Related docs

- [Database reference overview](./overview.md)
- [Identity & invites schemas](./schema-identity-and-invites.md)
- [Rooms, messages & canvas schemas](./schema-rooms-messages-canvas.md)
- [Connectors & Vault schemas](./schema-connectors-and-vault.md)
- [Migrations catalog](./migrations-catalog.md)
- [Seed script](./seed.md)
