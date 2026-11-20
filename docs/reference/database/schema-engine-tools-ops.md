# Engine, Tools & Ops Schemas

This reference documents the Drizzle schemas behind agent execution and observability: the engine tables that record per-step execution detail and transcripts (`run_steps`, `run_transcripts`, `skills`), the tool layer including MCP server registration and the audited `tool_calls` ledger (`mcp_servers`, `tool_calls`), and the ops tables for webhooks, usage metering, audit logging, model pricing, and web-push subscriptions (`webhook_deliveries`, `usage_events`, `audit_logs`, `model_pricing`, `push_subscriptions`). These tables are written on every turn, so their indexes are shaped around room/time and run-scoped reads.

Source files: `packages/db/src/schema/engine.ts`, `packages/db/src/schema/tools.ts`, `packages/db/src/schema/ops.ts`, `packages/db/src/schema/messages.ts` (parent `agent_runs` table), `packages/db/src/schema/enums.ts` (status enums)

---

## Engine: Run Steps (`run_steps`)

Defined at `packages/db/src/schema/engine.ts:14`. One row per step of an agent run — model calls, tool invocations, compaction, memory recall, plan updates, subagent spawns, and verification passes. The `(run_id, idx)` unique index enforces ordered steps per run.

| Column        | SQL type      | Constraints / Default                               | Description                                                                                                                             |
| :------------ | :------------ | :-------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | `uuid`        | PK, `gen_random_uuid()` default                     | Step identifier.                                                                                                                        |
| `run_id`      | `uuid`        | NOT NULL, FK → `agent_runs.id`, `ON DELETE CASCADE` | Parent run in `messages.ts`.                                                                                                            |
| `idx`         | `integer`     | NOT NULL                                            | Zero-based ordinal of the step within the run.                                                                                          |
| `kind`        | `text`        | NOT NULL                                            | Step type: `model`, `tool`, `compaction`, `recall`, `plan`, `subagent`, or `verify` (comment at `packages/db/src/schema/engine.ts:22`). |
| `input_ref`   | `text`        | nullable                                            | Reference to the step's input (e.g. transcript offset) instead of an inline copy.                                                       |
| `output`      | `jsonb`       | nullable                                            | Step output payload.                                                                                                                    |
| `usage`       | `jsonb`       | nullable                                            | Token/usage accounting for the step.                                                                                                    |
| `started_at`  | `timestamptz` | NOT NULL, default `now()`                           | Step start time.                                                                                                                        |
| `finished_at` | `timestamptz` | nullable                                            | Step completion time.                                                                                                                   |

Indexes (`packages/db/src/schema/engine.ts:30-31`):

- unique `run_steps_run_idx` on `(run_id, idx)` — no duplicate ordinals per run.
- `run_steps_run_id_idx` on `(run_id)` — run-scoped scans.

---

## Engine: Run Transcripts (`run_transcripts`)

Defined at `packages/db/src/schema/engine.ts:35`. The working conversation state for a run: the message list the model sees, how far it has been compacted, and the current structured plan. One row per run (`run_id` is `UNIQUE`).

| Column                  | SQL type      | Constraints / Default                                       | Description                                                              |
| :---------------------- | :------------ | :---------------------------------------------------------- | :----------------------------------------------------------------------- |
| `id`                    | `uuid`        | PK, `gen_random_uuid()` default                             | Row identifier.                                                          |
| `run_id`                | `uuid`        | NOT NULL, UNIQUE, FK → `agent_runs.id`, `ON DELETE CASCADE` | The run this transcript belongs to.                                      |
| `messages`              | `jsonb`       | NOT NULL, default `[]`                                      | The transcript message list.                                             |
| `compacted_through_idx` | `integer`     | NOT NULL, default `0`                                       | Messages up to and including this index have been folded into a summary. |
| `plan`                  | `jsonb`       | nullable                                                    | Current structured execution plan (updated via `update_plan`).           |
| `version`               | `integer`     | NOT NULL, default `1`                                       | Transcript format/schema version.                                        |
| `created_at`            | `timestamptz` | NOT NULL, default `now()`                                   | Row creation time.                                                       |
| `updated_at`            | `timestamptz` | NOT NULL, default `now()`                                   | Last write time.                                                         |

Index: `run_transcripts_run_id_idx` on `(run_id)` (`packages/db/src/schema/engine.ts:50`).

---

## Engine: Skills (`skills`)

Defined at `packages/db/src/schema/engine.ts:53`. Reusable procedures taught by humans or agents (via `skill_teach`) and injected into relevant runs. Scoped per org with a unique slug.

| Column        | SQL type      | Constraints / Default                              | Description                                    |
| :------------ | :------------ | :------------------------------------------------- | :--------------------------------------------- |
| `id`          | `uuid`        | PK, `gen_random_uuid()` default                    | Skill identifier.                              |
| `org_id`      | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`      | Owning workspace.                              |
| `slug`        | `text`        | NOT NULL                                           | URL-safe identifier; unique per org.           |
| `title`       | `text`        | NOT NULL                                           | Display name.                                  |
| `description` | `text`        | NOT NULL                                           | When/how to use the skill, shown to the model. |
| `body`        | `text`        | NOT NULL                                           | The procedure itself (Markdown).               |
| `files`       | `jsonb`       | NOT NULL, default `{}`                             | Attached reference files (name → content).     |
| `version`     | `integer`     | NOT NULL, default `1`                              | Bumped on edits.                               |
| `visibility`  | `text`        | NOT NULL, default `"org"`                          | Visibility scope (org-wide by default).        |
| `created_by`  | `uuid`        | nullable, FK → `profiles.id`, `ON DELETE SET NULL` | Author.                                        |
| `created_at`  | `timestamptz` | NOT NULL, default `now()`                          | Creation time.                                 |
| `updated_at`  | `timestamptz` | NOT NULL, default `now()`                          | Last edit time.                                |

Indexes (`packages/db/src/schema/engine.ts:71-74`):

- unique `skills_org_slug_idx` on `(org_id, slug)`
- `skills_org_idx` on `(org_id)`

---

## Tools: MCP Servers (`mcp_servers`)

Defined at `packages/db/src/schema/tools.ts:16`. Registered Model Context Protocol servers, either org-wide or scoped to one room. Supports `http`, `sse`, and `stdio` transports; credentials are sealed into `headers_enc`, and OAuth servers keep their registration/PKCE/tokens sealed in `oauth_enc`. Desktop-only local apps attach to a `desktop_hosts` row via `host_id`.

| Column            | SQL type             | Constraints / Default                                                                 | Description                                                                           |
| :---------------- | :------------------- | :------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------ |
| `id`              | `uuid`               | PK, `gen_random_uuid()` default                                                       | Server identifier.                                                                    |
| `org_id`          | `uuid`               | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`                                         | Owning workspace.                                                                     |
| `room_id`         | `uuid`               | nullable, FK → `rooms.id`, `ON DELETE CASCADE`                                        | Optional room scoping; null means org-wide.                                           |
| `name`            | `text`               | NOT NULL                                                                              | Server display name.                                                                  |
| `transport`       | `mcp_transport` enum | NOT NULL, default `"http"`                                                            | `http`, `sse`, or `stdio` (`packages/db/src/schema/enums.ts:44`).                     |
| `url`             | `text`               | NOT NULL                                                                              | Server endpoint URL (or command context for stdio).                                   |
| `headers_enc`     | `text`               | nullable                                                                              | Sealed auth headers (AES-256-GCM envelope).                                           |
| `auth_kind`       | `text`               | NOT NULL, default `"static"`                                                          | `"static"` (headers or nothing) or `"oauth"` (browser sign-in backed by `oauth_enc`). |
| `oauth_enc`       | `text`               | nullable                                                                              | Sealed `McpOAuthState`: client registration, PKCE verifier, state, tokens.            |
| `auth_status`     | `text`               | NOT NULL, default `"ok"`                                                              | `"ok"`, `"pending"` (sign-in started), or `"signed_out"` (tokens gone or refused).    |
| `catalog_app`     | `text`               | nullable                                                                              | Marketplace app id this row was made from, when it came from the catalog.             |
| `host_id`         | `uuid`               | nullable, FK → `desktop_hosts.id`, `ON DELETE SET NULL`                               | Computer that runs a desktop-only local app (Obsidian, Paper, Apple apps).            |
| `tool_cache`      | `jsonb`              | nullable, typed `{ at: string; tools: Array<{ name: string; description?: string }> } | null`                                                                                 | Last `tools/list` result from a desktop app, so a turn doesn't wait on the computer to start. |
| `dangerous_tools` | `text[]`             | NOT NULL, default `[]`                                                                | Tool names that require the human approval gate.                                      |
| `enabled`         | `boolean`            | NOT NULL, default `true`                                                              | Kill switch for the server.                                                           |
| `created_by`      | `uuid`               | nullable, FK → `profiles.id`, `ON DELETE SET NULL`                                    | Admin who registered the server.                                                      |
| `created_at`      | `timestamptz`        | NOT NULL, default `now()`                                                             | Creation time.                                                                        |
| `updated_at`      | `timestamptz`        | NOT NULL, default `now()`                                                             | Last update time.                                                                     |

Indexes: `mcp_servers_org_idx` on `(org_id)`, `mcp_servers_room_idx` on `(room_id)` (`packages/db/src/schema/tools.ts:46`).

---

## Tools: Tool Calls (`tool_calls`)

Defined at `packages/db/src/schema/tools.ts:49`. The audited ledger of every tool invocation — this is the table behind the human approval gate for `dangerous: true` tools. A dangerous call is recorded with `status = "pending_approval"` and blocks until a human approves or rejects.

| Column        | SQL type                | Constraints / Default                                | Description                                                                                                       |
| :------------ | :---------------------- | :--------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `id`          | `uuid`                  | PK, `gen_random_uuid()` default                      | Call identifier (the approval reference).                                                                         |
| `run_id`      | `uuid`                  | nullable, FK → `agent_runs.id`, `ON DELETE SET NULL` | Run that invoked the tool.                                                                                        |
| `room_id`     | `uuid`                  | NOT NULL, FK → `rooms.id`, `ON DELETE CASCADE`       | Room the call happened in.                                                                                        |
| `message_id`  | `uuid`                  | nullable, FK → `messages.id`, `ON DELETE SET NULL`   | Message the call is attached to.                                                                                  |
| `tool_name`   | `text`                  | NOT NULL                                             | Tool that was invoked.                                                                                            |
| `args`        | `jsonb`                 | NOT NULL, default `{}`                               | Sanitized tool arguments.                                                                                         |
| `result`      | `jsonb`                 | nullable                                             | Tool result payload.                                                                                              |
| `status`      | `tool_call_status` enum | NOT NULL, default `"running"`                        | `pending_approval`, `approved`, `rejected`, `running`, `done`, `error` (`packages/db/src/schema/enums.ts:45-52`). |
| `approved_by` | `uuid`                  | nullable, FK → `profiles.id`, `ON DELETE SET NULL`   | Human who approved the call.                                                                                      |
| `resolved_at` | `timestamptz`           | nullable                                             | When approval/execution resolved.                                                                                 |
| `error`       | `text`                  | nullable                                             | Error message on failure.                                                                                         |
| `created_at`  | `timestamptz`           | NOT NULL, default `now()`                            | Call start.                                                                                                       |
| `updated_at`  | `timestamptz`           | NOT NULL, default `now()`                            | Last state change.                                                                                                |

Indexes (`packages/db/src/schema/tools.ts:68-71`):

- `tool_calls_room_idx` on `(room_id, created_at)` — room tool-card timelines.
- `tool_calls_run_idx` on `(run_id)` — run replay.

---

## Ops: Webhook Deliveries (`webhook_deliveries`)

Defined at `packages/db/src/schema/ops.ts:18`. Delivery log for room webhook ingress — one row per attempt, with status code, latency, and error for debugging external integrations.

| Column        | SQL type      | Constraints / Default                              | Description                         |
| :------------ | :------------ | :------------------------------------------------- | :---------------------------------- |
| `id`          | `uuid`        | PK, `gen_random_uuid()` default                    | Delivery identifier.                |
| `org_id`      | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`      | Owning workspace.                   |
| `room_id`     | `uuid`        | nullable, FK → `rooms.id`, `ON DELETE CASCADE`     | Target room, if any.                |
| `agent_id`    | `uuid`        | nullable, FK → `agents.id`, `ON DELETE CASCADE`    | Agent the delivery targeted.        |
| `message_id`  | `uuid`        | nullable, FK → `messages.id`, `ON DELETE SET NULL` | Message produced from the delivery. |
| `attempt`     | `integer`     | NOT NULL, default `1`                              | Attempt number for retries.         |
| `status_code` | `integer`     | nullable                                           | HTTP status the sender received.    |
| `response_ms` | `integer`     | nullable                                           | Processing latency.                 |
| `error`       | `text`        | nullable                                           | Error detail.                       |
| `created_at`  | `timestamptz` | NOT NULL, default `now()`                          | Attempt time.                       |

Index: `webhook_deliveries_org_idx` on `(org_id, created_at)` (`packages/db/src/schema/ops.ts:34`).

---

## Ops: Usage Events (`usage_events`)

Defined at `packages/db/src/schema/ops.ts:37`. Raw per-call LLM metering. Rollups for Cloud plans live in `org_usage_monthly` (see [Billing schema](./schema-billing.md)); this is the fine-grained source.

| Column                | SQL type        | Constraints / Default                            | Description                                                         |
| :-------------------- | :-------------- | :----------------------------------------------- | :------------------------------------------------------------------ |
| `id`                  | `uuid`          | PK, `gen_random_uuid()` default                  | Event identifier.                                                   |
| `org_id`              | `uuid`          | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`    | Billed workspace.                                                   |
| `room_id`             | `uuid`          | nullable, FK → `rooms.id`, `ON DELETE CASCADE`   | Room the call served.                                               |
| `agent_id`            | `uuid`          | nullable, FK → `agents.id`, `ON DELETE SET NULL` | Agent that made the call.                                           |
| `provider`            | `text`          | NOT NULL                                         | LLM provider (`openai`, `anthropic`, …).                            |
| `model`               | `text`          | NOT NULL                                         | Model identifier.                                                   |
| `input_tokens`        | `integer`       | NOT NULL, default `0`                            | Input tokens billed.                                                |
| `output_tokens`       | `integer`       | NOT NULL, default `0`                            | Output tokens billed.                                               |
| `cached_input_tokens` | `integer`       | NOT NULL, default `0`                            | Cache-hit input tokens.                                             |
| `kind`                | `text`          | NOT NULL, default `"llm"`                        | Event kind (LLM calls by default; other meters may use the column). |
| `cost_usd`            | `numeric(12,6)` | NOT NULL, default `0` (number mode)              | Computed cost in USD.                                               |
| `ttft_ms`             | `integer`       | nullable                                         | Time to first token.                                                |
| `latency_ms`          | `integer`       | nullable                                         | Total call latency.                                                 |
| `created_at`          | `timestamptz`   | NOT NULL, default `now()`                        | Event time.                                                         |

Indexes (`packages/db/src/schema/ops.ts:57-60`):

- `usage_events_org_created_idx` on `(org_id, created_at)` — org usage rollups.
- `usage_events_room_created_idx` on `(room_id, created_at)` — room cost breakdowns.

---

## Ops: Audit Logs (`audit_logs`)

Defined at `packages/db/src/schema/ops.ts:63`. Workspace-level audit trail for sensitive actions (settings changes, approvals, connector edits).

| Column       | SQL type      | Constraints / Default                         | Description                                       |
| :----------- | :------------ | :-------------------------------------------- | :------------------------------------------------ |
| `id`         | `uuid`        | PK, `gen_random_uuid()` default               | Log identifier.                                   |
| `org_id`     | `uuid`        | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE` | Owning workspace.                                 |
| `actor_type` | `text`        | NOT NULL                                      | Actor kind (e.g. human vs agent vs system).       |
| `actor_id`   | `uuid`        | nullable                                      | Actor identifier (no FK — actors may be deleted). |
| `action`     | `text`        | NOT NULL                                      | Action code.                                      |
| `target`     | `text`        | nullable                                      | Target resource reference.                        |
| `metadata`   | `jsonb`       | NOT NULL, default `{}`                        | Structured context for the action.                |
| `created_at` | `timestamptz` | NOT NULL, default `now()`                     | Event time.                                       |

Index: `audit_logs_org_created_idx` on `(org_id, created_at)` (`packages/db/src/schema/ops.ts:77`).

---

## Ops: Model Pricing (`model_pricing`)

Defined at `packages/db/src/schema/ops.ts:80`. Per-model unit prices used to compute `usage_events.cost_usd`. Composite primary key `(provider, model)` — no surrogate id.

| Column            | SQL type        | Constraints / Default               | Description                    |
| :---------------- | :-------------- | :---------------------------------- | :----------------------------- |
| `provider`        | `text`          | NOT NULL, part of PK                | LLM provider.                  |
| `model`           | `text`          | NOT NULL, part of PK                | Model identifier.              |
| `input_per_mtok`  | `numeric(12,6)` | NOT NULL, default `0` (number mode) | USD per million input tokens.  |
| `output_per_mtok` | `numeric(12,6)` | NOT NULL, default `0` (number mode) | USD per million output tokens. |
| `updated_at`      | `timestamptz`   | NOT NULL, default `now()`           | Last price update.             |

---

## Ops: Push Subscriptions (`push_subscriptions`)

Defined at `packages/db/src/schema/ops.ts:96`. Web Push subscriptions for browser notifications (distinct from the Expo tokens in `mobile_push_tokens`).

| Column       | SQL type      | Constraints / Default                             | Description                               |
| :----------- | :------------ | :------------------------------------------------ | :---------------------------------------- |
| `id`         | `uuid`        | PK, `gen_random_uuid()` default                   | Subscription identifier.                  |
| `user_id`    | `uuid`        | NOT NULL, FK → `profiles.id`, `ON DELETE CASCADE` | Subscriber.                               |
| `endpoint`   | `text`        | NOT NULL, UNIQUE                                  | Push service endpoint URL.                |
| `p256dh`     | `text`        | NOT NULL                                          | Client public key for payload encryption. |
| `auth`       | `text`        | NOT NULL                                          | Auth secret for payload encryption.       |
| `created_at` | `timestamptz` | NOT NULL, default `now()`                         | Registration time.                        |

Indexes (`packages/db/src/schema/ops.ts:108-111`):

- unique `push_subscriptions_endpoint_idx` on `(endpoint)` — one row per browser endpoint.
- `push_subscriptions_user_idx` on `(user_id)`.

---

## Parent table: `agent_runs`

`run_steps` and `tool_calls` hang off `agent_runs` (defined at `packages/db/src/schema/messages.ts:71`), which records one row per agent execution: `session_id`/`room_id`/`task_id`/`agent_id`/`message_id` linkage, `step` and `steps` counters, `role` (`turn_role` enum), `status` (`agent_run_status` enum: `running`, `complete`, `error`, `halted`, `waiting`), `finish_reason`, `heartbeat_at`, `parent_run_id` for subagents, `waiting_reason`, and token/cost/latency columns (`input_tokens`, `output_tokens`, `cost_usd`, `ttft_ms`, `latency_ms`). Engine V2 runs set `engine = "v2"`; the column defaults to `"v1"`.

---

## Related docs

- [Database reference overview](./overview.md)
- [Connectors & Vault schemas](./schema-connectors-and-vault.md)
- [Computers, Devices & Desktop schemas](./schema-computers-devices-desktop.md)
- [Billing schema](./schema-billing.md)
- [Migrations catalog](./migrations-catalog.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Seed script](./seed.md)
