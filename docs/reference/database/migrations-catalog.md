# Migrations Catalog

This catalog documents every database migration in `packages/db`: the four Drizzle-generated migrations in `packages/db/migrations/` (the declarative schema snapshot pipeline) and the 35 hand-written SQL scripts in `packages/db/sql/` (functions, triggers, RLS, realtime, and RPCs that Drizzle cannot express). `src/migrate.ts` runs both phases in order — Drizzle first, then every `sql/*.sql` file in sorted filename order — and the SQL phase re-applies on every run, so each script is written to be idempotent.

Source files: `packages/db/migrations/0000_conscious_natasha_romanoff.sql` through `0003_gigantic_the_call.sql`, `packages/db/sql/0001_functions.sql` through `0038_agent_last_seen.sql`, `packages/db/src/migrate.ts`

---

## How migrations run

`packages/db/src/migrate.ts` executes two phases against `DATABASE_URL`:

1. **Drizzle phase** — `migrate(db, { migrationsFolder: "../migrations" })` applies the generated SQL files, tracked in the `drizzle.__drizzle_migrations` table via `meta/_journal.json`. Each runs once.
2. **SQL phase** — every `packages/db/sql/*.sql` file, `readdirSync(...).filter(...).sort()`, executed with `pool.query(text)` in lexical order. **These re-run on every migration**, so every script must be idempotent (see `packages/db/src/migrate.ts:21-31`; several files carry the comment "Idempotent: migrate.ts re-applies every file in sql/ on each run").

Run with `pnpm db:migrate` from the repo root (delegates to `pnpm --filter @sayabot/db migrate` → `tsx src/migrate.ts`). Generate new Drizzle migrations with `pnpm db:generate` after editing `packages/db/src/schema/*.ts`.

Because the SQL phase is lexical, numeric prefixes define hard ordering dependencies: helpers (`0001_functions.sql`, `0002_rls.sql`) must exist before policies that use them; tables created in Drizzle migrations are assumed present in SQL files; `0029_mcp_stdio_enum.sql` must follow the enum's creation in `0000`.

---

## Drizzle-generated migrations (`packages/db/migrations/`)

### `0000_conscious_natasha_romanoff.sql`

The initial schema. Creates 15 enum types (`0000_...sql:1-15`): `agent_kind` (`llm`, `external`), `agent_run_status` (`running`, `complete`, `error`, `halted` — no `waiting` yet), `builtin_tool` (`web_search`, `github_bridge`, `postgres_inspector`), `canvas_kind`, `mcp_transport` (`http`, `sse` only), `message_status`, `org_role`, `provider`, `room_kind`, `room_member_role`, `sender_type`, `tool_call_status`, `turn_mode`, `turn_role`, `turn_session_state`.

Creates tables:

| Table | Notes |
| :--- | :--- |
| `orgs`, `profiles`, `org_members` | Identity core; `org_members` PK `(org_id, user_id)`. |
| `provider_keys` | AES envelope `ciphertext`/`iv`/`tag`/`last4`. |
| `agents`, `agent_api_keys`, `org_tool_configs` | Agents with `handle`, webhooks (`webhook_url`, `webhook_secret_enc`); API keys with `prefix` unique + `key_hash`. |
| `rooms`, `room_members`, `room_agents` | Rooms with `turn_cap` CHECK (1–10), `moderator_agent_id`, `debate_order`. |
| `messages`, `turn_sessions`, `agent_runs` | Messaging + orchestration core. |
| `canvases`, `canvas_versions` | Canvas with `ydoc_state bytea`. |
| `mcp_servers`, `tool_calls` | Tool layer. |
| `audit_logs`, `model_pricing`, `usage_events`, `webhook_deliveries` | Ops layer; `model_pricing` PK `(provider, model)`. |

Then adds all foreign keys (`0000_...sql:275-314`) and indexes (`0000_...sql:315-338`), including unique `agents_org_handle_idx`, `org_tool_configs_org_tool_idx`, and composite room/created-time indexes.

### `0001_amusing_tarot.sql`

App IA. Creates enums `meeting_kind`, `meeting_status`, `task_kind`, `task_status` (`0001_...sql:1-4`). Creates tables `room_reads` (PK `(user_id, room_id)`), `meetings`, `room_schedules` (PK `room_id`, morning/evening and check-in minute windows), `task_comments`, `tasks` (with `serial` `number`). Alters: `profiles.preferences jsonb`, `rooms.timezone` (default `UTC`), `rooms.agent_dm_user_id`, `rooms.agent_dm_agent_id` with unique `rooms_agent_dm_idx`. Adds FKs and indexes (`meetings_room_start_idx`, `tasks_room_status_idx`, etc.).

### `0002_tranquil_mac_gargan.sql`

Creates `push_subscriptions` (`user_id` FK cascade, `endpoint`, `p256dh`, `auth`) with unique `push_subscriptions_endpoint_idx` and `push_subscriptions_user_idx`.

### `0003_gigantic_the_call.sql`

Creates `agent_reads` (PK `(agent_id, room_id)`, `last_read_at`, `updated_at`) with FKs to `agents` and `rooms`. Read cursors for pull-based bots.

---

## SQL migrations (`packages/db/sql/`)

### `0001_functions.sql` — core functions and triggers

- `public.set_updated_at()` trigger function; installed via `before update` triggers on `rooms`, `agents`, `messages`, `turn_sessions`, `tool_calls`, `canvases`, `mcp_servers`, `model_pricing`, `org_tool_configs` (`0001_functions.sql:13-29`).
- `public.handle_new_user()` — `SECURITY DEFINER` trigger on `auth.users` (`on_auth_user_created`) that upserts `profiles` with display name/avatar resolved from `raw_user_meta_data` (`full_name`, `name`, `user_name`, email prefix) and backfills existing `auth.users` into `profiles` (`0001_functions.sql:32-73`).
- Self-referencing FK `messages_thread_root_id_fkey` on `messages.thread_root_id` → `messages.id` `on delete cascade` (`0001_functions.sql:76-86`).

### `0002_rls.sql` — row level security

- Helper functions (all `STABLE SECURITY DEFINER`, `0002_rls.sql:4-70`): `is_org_member`, `is_org_admin`, `is_org_owner`, `org_has_members`, `shares_org_with`, `is_room_member`, `can_read_room`, `is_room_admin`. All resolve the caller via `auth.uid()` (Supabase).
- Enables RLS on 21 tables: `profiles`, `orgs`, `org_members`, `provider_keys`, `agents`, `rooms`, `room_members`, `room_agents`, `agent_api_keys`, `org_tool_configs`, `messages`, `turn_sessions`, `agent_runs`, `canvases`, `canvas_versions`, `mcp_servers`, `tool_calls`, `webhook_deliveries`, `usage_events`, `audit_logs`, `model_pricing` (`0002_rls.sql:72-92`).
- Policies (all `to authenticated`, select-only except where noted): `profiles_select`, `profiles_update_own`; `orgs_select`; `org_members_select`; `agents_select`; `rooms_select` (via `can_read_room`), `room_members_select`, `room_agents_select`; `messages_select` plus `messages_insert_human` (human sender, `sender_id = auth.uid()`, status `complete`); `turn_sessions_select`; `agent_runs_select`; `canvases_select`, `canvas_versions_select`; `mcp_servers_select`, `tool_calls_select`; `webhook_deliveries_select` (org admin), `usage_events_select`, `audit_logs_select` (org admin), `model_pricing_select` (`using (true)`).
- Safe views `provider_keys_public` and `org_tool_configs_public` (ciphertext excluded, org-scoped) (`0002_rls.sql:217-225`).
- Grants: select on the readable set + insert on `messages` to `authenticated`; full revoke on `provider_keys`, `agent_api_keys`, `org_tool_configs` (ciphertext reachable only via service role); `grant all ... in schema public to service_role` (`0002_rls.sql:227-240`).

### `0003_realtime.sql` — realtime publication

- Adds `messages`, `tool_calls`, `canvases` to the `supabase_realtime` publication (guarded to run only when the publication exists) (`0003_realtime.sql:4-20`).
- `alter table messages replica identity full` so `postgres_changes` delivers full old rows.
- When `realtime.messages` exists, creates broadcast/presence policies `mesh_room_read` (select) and `mesh_room_write` (insert) keyed on `realtime.topic() like 'room:%'` plus `can_read_room` (`0003_realtime.sql:24-56`).

### `0004_rpc.sql` — tool approval RPC

- `public.notify_tool_resolution(p_tool_call uuid, p_status text)` — `SECURITY DEFINER`, validates status is `approved`/`rejected`, then `pg_notify('tool_call_resolved', ...)` so the orchestrator wakes the waiting run. `EXECUTE` revoked from `public`/`anon`/`authenticated`, granted to `service_role` only (`0004_rpc.sql:2-20`).

### `0005_ia.sql` — meetings, schedules, tasks

- `set_updated_at` triggers on `meetings`, `room_schedules`, `tasks`, `room_reads` (`0005_ia.sql:3-16`).
- Enables RLS on `meetings`, `room_schedules`, `tasks`, `task_comments`, `room_reads`; creates select policies (`meetings_select`, `room_schedules_select`, `tasks_select`, `task_comments_select` through the parent task's room, `room_reads_select`) and full insert/update/delete ownership policies on `room_reads` (`0005_ia.sql:18-68`).
- Grants select on the read set; full CRUD on `room_reads` to `authenticated` (`0005_ia.sql:70-72`).
- Backfills `room_schedules` for every existing non-DM room (`0005_ia.sql:76-80`).
- Adds `meetings`, `tasks`, `task_comments` to the realtime publication (`0005_ia.sql:82-98`).

### `0006_push.sql` — web push ownership

- RLS on `push_subscriptions` with four owner-scoped policies (`push_subscriptions_select/insert/update/delete`, all `user_id = auth.uid()`) and full CRUD grant to `authenticated`.

### `0007_agent_reads.sql` — service-only cursors

- Enables RLS on `agent_reads` with **no policies** and revokes all from `anon`/`authenticated` — rows exist only for the orchestrator's service role (`0007_agent_reads.sql:3-4`).

### `0008_task_integrity.sql` — board of record

- Extends `tasks`: `due_at`, `status_changed_at`, `completed_at`, `unblock_needs` (CHECK against six values), `unblock_detail`, `blocked_by uuid[]`, `outcome_kind` (CHECK), `outcome_ref`, `fold_key`, `asked_count`, `expires_at` (default `now() + 72 hours`) (`0008_task_integrity.sql:4-15`).
- Extends `room_schedules`: `checkin_mode` (CHECK `stream`/`digest`), `digest_at`. Extends `agent_runs` with `task_id` FK + `agent_runs_task_idx`; extends `agent_reads` with `last_reported_at` (`0008_task_integrity.sql:18-30`).
- Creates `task_events` (status transition ledger with `actor_type` CHECK) + two indexes; RLS select policy via parent task's room; inserts/updates/deletes revoked for `authenticated` (`0008_task_integrity.sql:33-87`).
- `public.tasks_enforce_integrity()` function + `before update` trigger: title immutable; `done` requires `completed_at` and `outcome_kind` (`0008_task_integrity.sql:51-71`).
- Adds `task_events` to the realtime publication (`0008_task_integrity.sql:90-101`).
- Backfills `status_changed_at` and marks legacy done tasks with `outcome_kind = 'legacy'` (`0008_task_integrity.sql:103-110`).

### `0009_bot_platform.sql` — templates, secret broker, computers, OAuth

- Enums: `vault_secret_kind`, `secret_inject`, `computer_status`, `computer_profile`, `agent_visibility` (created with `duplicate_object` guards) (`0009_bot_platform.sql:5-23`).
- `agent_templates` table (nullable `org_id` for global templates, `capabilities` JSONB default, `secret_slots`, `starter_tasks`) + unique `agent_templates_org_slug_idx` (`nulls not distinct`) + org index; RLS with `agent_templates_read` (public templates readable) and `agent_templates_write` (org admins) (`0009_bot_platform.sql:26-62`).
- Extends `agents` (`template_id`, `owner_user_id`, `visibility`, `avatar`, `bio`, `capabilities`), `agent_api_keys` (`room_ids`, `oauth_client_id`, `expires_at`), `tasks` (`lead_agent_id`, `parent_task_id`, `budget_turns`, `budget_usd`, `turns_used`, `cost_usd` + 2 indexes), `turn_sessions` (`task_id` + index) (`0009_bot_platform.sql:65-95`).
- Secret broker: `vault_secrets` (+ index, RLS on, revoked for `authenticated`/`anon`) with `vault_secrets_public` view (`security_invoker`); `agent_secret_grants` (+ 4 indexes, RLS locked) with `agent_secret_grants_public` view; `org_quotas` (RLS read policy for members) (`0009_bot_platform.sql:98-172`).
- `agent_computers` table + `agent_computers_org_status_idx` + `agent_computers_idle_sweeper_idx`; RLS read policy for members (`0009_bot_platform.sql:175-200`).
- Bot invite + OAuth 2.1 stack: `room_invites` (+ 2 indexes, RLS read via room membership), `oauth_clients`, `oauth_codes`, `oauth_tokens` (all three RLS-locked to service role) (`0009_bot_platform.sql:203-275`).
- `public.notify_vault_changed()` — `SECURITY DEFINER` trigger function that `pg_notify('vault_changed', ...)`; installed as `tr_agent_secret_grants_vault_changed` and `tr_vault_secrets_vault_changed` (`0009_bot_platform.sql:278-306`).

### `0010_engine.sql` — engine v2

- `alter type agent_run_status add value if not exists 'waiting'` (`0010_engine.sql:6`).
- `agent_runs` columns: `finish_reason`, `steps`, `engine` (default `v1`), `heartbeat_at`, `parent_run_id` (self-FK), `waiting_reason`; partial index `agent_runs_heartbeat_idx` on `(status, heartbeat_at) where status = 'running'` (`0010_engine.sql:10-19`).
- `usage_events` columns: `cached_input_tokens`, `kind` (`0010_engine.sql:22-24`).
- `run_steps` table + unique `run_steps_run_idx (run_id, idx)` + `run_steps_run_id_idx`; RLS select policy resolving room membership through `agent_runs`/`rooms` (`0010_engine.sql:27-61`).
- `run_transcripts` table (unique `run_id`) + index + equivalent select policy (`0010_engine.sql:64-96`).
- `skills` table + `skills_org_slug_idx` + `skills_org_idx`; RLS `skills_select_policy` (members) and `skills_admin_policy` (admins, all) (`0010_engine.sql:99-139`).

### `0011_memory.sql` — multi-tier memory

- Enums `memory_scope`, `memory_kind`, `memory_source` (`0011_memory.sql:7-16`).
- `memories` table with generated `tsv tsvector` column; GIN index `memories_tsv_idx` plus scope/pinned/last-used indexes (`0011_memory.sql:19-48`).
- RLS: `memories_select/insert/update/delete_policy`, each requiring `is_org_member(org_id)` and, for room-scoped rows, `can_read_room(room_id)`; grants to `authenticated` and `service_role` (`0011_memory.sql:51-87`). Header note: pgvector must be enabled on the dashboard (human step).

### `0012_permissions_fix.sql` — grants + memory policy refresh

- Grants select/insert/update/delete on `agent_templates`, `org_quotas`, `agent_computers`, `room_invites`, `run_steps`, `run_transcripts`, `skills`, `memories` to `authenticated`; `grant all` on the same set to `service_role` (`0012_permissions_fix.sql:5-25`).
- Drops and re-creates the four `memories_*_policy` policies (same predicates as `0011`) (`0012_permissions_fix.sql:28-58`).

### `0013_auth_oauth_profiles.sql` — profile hook refresh

- Re-creates `public.handle_new_user()` with the same Google/GitHub/email metadata resolution as `0001` (idempotent re-assertion) (`0013_auth_oauth_profiles.sql:2-33`).

### `0014_routines.sql` — cron routines

- Enum `routine_status` (`idle`, `running`, `success`, `failed`) (`0014_routines.sql:6`).
- `routines` table (schedule_expr/kind/timezone, prompt, `next_run_at`/`last_run_at`/`last_status`/`last_error`, `run_count`, creator user/agent) + 4 indexes including the scheduler's `routines_next_run_idx (enabled, next_run_at)`.
- `routine_runs` table (execution history) + 2 desc indexes (`0014_routines.sql:35-52`).
- RLS: member-scoped select/insert/update/delete policies on both tables (`0014_routines.sql:55-86`).

### `0015_agent_templates_unique.sql` — template uniqueness fix

- Drops and recreates `agent_templates_org_slug_idx` with `nulls not distinct` so `ON CONFLICT (org_id, slug)` resolves for both global (`org_id` null) and org templates (`0015_agent_templates_unique.sql:2-4`).

### `0016_cognitive_memory.sql` — epistemic layer

- Enums `epistemic_status`, `open_loop_status`, `memory_link_type` (`0016_cognitive_memory.sql:7-15`).
- Extends `memories`: `perspective`, `emotional_salience`, `epistemic_status`, `evidence_refs`, `target_agent_id`, `decay_half_life_days`, `withdrawal_reason` + 3 indexes (`0016_cognitive_memory.sql:19-30`).
- Tables: `memory_sources` (federated provider registry, text PK), `open_loops` (commitments with status/due/blocker), `memory_links` (typed graph edges with weight) + indexes (`0016_cognitive_memory.sql:33-77`).
- RLS member policies on all three (open_loops also room-bounded); grants to `authenticated` and `service_role` (`0016_cognitive_memory.sql:80-118`).

### `0017_vector_providers.sql` — RAG providers

- Enum `vector_provider_kind` (`vector_db`, `embedding`).
- `vector_providers` table with envelope `ciphertext`/`iv`/`tag`/`last4` + org and active indexes (`0017_vector_providers.sql:12-32`).
- `vector_providers_public` view without ciphertext; RLS on the table with everything revoked from `anon`/`authenticated`/`public`; view select granted to `authenticated`, table to `service_role` (`0017_vector_providers.sql:35-57`).

### `0018_workspace_connectors.sql` — two-tier connectors

- `workspace_connectors` table (envelope `ciphertext`/`iv`/`tag`, `source` text, `status`, `auth_type`, `config`) + org and `(org_id, source)` indexes (`0018_workspace_connectors.sql:5-26`).
- `workspace_connectors_public` view without ciphertext, org-member filtered (`0018_workspace_connectors.sql:29-45`).
- `agent_connector_grants` table (`scope_config` JSONB) + `agent_connector_grants_agent_idx` (`0018_workspace_connectors.sql:48-57`).
- RLS on both; the connectors table fully revoked (service role only), grants CRUD for members on `agent_connector_grants` (`0018_workspace_connectors.sql:60-72`).

### `0019_owner_facts.sql` — owner facts

- `owner_facts` table (`key`/`label`/`value`, source `answer`/`manual`/`agent`, task/agent provenance) with CHECKs on key format (`^[a-z0-9_]{1,48}$`), value length (1–1000), and source; unique expression index `owner_facts_scope_key_idx` on `(org_id, coalesce(room_id, zero-uuid), key)` so org-wide and per-room facts share one namespace; `owner_facts_set_updated_at` trigger (`0019_owner_facts.sql:5-30`).
- RLS: `owner_facts_select` — org-wide facts to members, room facts via `can_read_room`; writes revoked for `authenticated`, everything to `service_role` (`0019_owner_facts.sql:34-46`).

### `0020_bot_invites.sql` — add-an-agent flow

- `bot_invites` table (approval-gated join links; `code` unique, request metadata, `poll_token_hash`, `status` CHECK `waiting`/`pending`/`approved`/`joined`/`declined`/`revoked`, `rejected_attempts` JSONB) + room/org status indexes + `updated_at` trigger (`0020_bot_invites.sql:6-38`).
- RLS enabled with all access revoked — read only through server actions as service role (`0020_bot_invites.sql:42-45`).

### `0021_device_pairings.sql` — phone pairings

- `device_pairings` table (`code_hash` unique, `status` CHECK `waiting`/`paired`/`revoked`, device metadata, token hash, expiry) + `device_pairings_user_idx` (`0021_device_pairings.sql:5-22`).
- RLS locked to service role (`0021_device_pairings.sql:25-27`).

### `0022_usage_rollup.sql` — analytics RPC

- Index `usage_events_org_agent_created_idx` (`0022_usage_rollup.sql:6-7`).
- `public.usage_rollup(p_org uuid, p_since timestamptz)` — `STABLE SECURITY INVOKER` SQL function grouping `usage_events` by agent/room/provider/model/kind into request, token, cache, and cost totals with `last_at`. Invoker rights keep the caller's RLS in force; execute granted to `authenticated` and `service_role` (`0022_usage_rollup.sql:9-46`).

### `0023_workspace_invites.sql` — member invites

- `workspace_invites` table (`kind` CHECK `email`/`link`/`permanent`, `role` CHECK `member`/`admin`, `code` CHECK present unless email, `max_uses`/`use_count`, expiry/revocation) + org/kind index (`0023_workspace_invites.sql:5-26`).
- RLS locked to service role — links are grants managed by server actions (`0023_workspace_invites.sql:29-31`).

### `0024_desktop_hosts.sql` — desktop app

- `desktop_hosts` table (persistent `token_hash`, `permissions`/`local_agents`/`settings`/`storage` JSONB) + `desktop_hosts_user_idx`; re-asserts the `storage` column with `add column if not exists` (`0024_desktop_hosts.sql:5-22`).
- `remote_sessions` table (WebRTC `offer`/`answer`, `control`, `status` CHECK `requested`/`answered`/`denied`/`ended`/`failed`) + host index (`0024_desktop_hosts.sql:24-38`).
- `local_runner_jobs` table (prompt queue, `status` CHECK `queued`/`running`/`done`/`failed`/`cancelled`) + host index (`0024_desktop_hosts.sql:40-56`).
- RLS on all three, fully revoked — service role only (`0024_desktop_hosts.sql:59-63`).

### `0025_storage_summary.sql` — storage RPC

- `public.storage_summary(p_org uuid)` — `STABLE SECURITY DEFINER` plpgsql function that refuses non-members (unless service role) and returns a JSONB breakdown of bytes/counts for chat, files (canvases + versions), memory, tool activity, and computer disks, with per-agent and top-10-room aggregates (`0025_storage_summary.sql:6-82`). Execute granted to `authenticated` and `service_role`.

### `0026_mobile_push_and_files.sql` — phone push + attachments

- `mobile_push_tokens` table (`token` unique) + `mobile_push_tokens_user_idx`; RLS locked to service role (`0026_mobile_push_and_files.sql:5-16`).
- Inserts the private `attachments` Supabase storage bucket (15 MB `file_size_limit` = 15728640 bytes) when the `storage.buckets` table exists; files are served via `/api/files` after room-access checks (`0026_mobile_push_and_files.sql:19-27`).

### `0027_memory_v2.sql` — semantic recall

- Best-effort `create extension if not exists vector` — failure is a notice, never an error; recall falls back to in-process cosine similarity (`0027_memory_v2.sql:9-13`).
- `memories` columns: `embedding real[]` (dimension-agnostic), `embedding_model`, `embedded_at` (`0027_memory_v2.sql:17-20`).
- Indexes: `memories_agent_room_idx`, `memories_embedding_model_idx` (re-embed scans), `memories_title_lower_idx` (case-insensitive dedup) (`0027_memory_v2.sql:23-32`).

### `0028_mcp_oauth.sql` — MCP OAuth 2.1

- `mcp_servers` columns: `auth_kind` (default `static`), `oauth_enc` (sealed `McpOAuthState`), `auth_status` (default `ok`), `catalog_app`; CHECK constraints `mcp_servers_auth_kind_check` (`static`/`oauth`) and `mcp_servers_auth_status_check` (`ok`/`pending`/`signed_out`); index `mcp_servers_catalog_app_idx` (`0028_mcp_oauth.sql:6-25`).

### `0029_mcp_stdio_enum.sql` — stdio transport

- `alter type public.mcp_transport add value if not exists 'stdio'` — the entire file, because `ADD VALUE` cannot run inside a transaction block (`0029_mcp_stdio_enum.sql:4`).

### `0030_local_apps_inbound.sql` — desktop jobs + webhook dedup

- `mcp_servers` columns: `host_id` (FK to `desktop_hosts`, `on delete set null`), `tool_cache` JSONB, `catalog_app` (re-asserted) (`0030_local_apps_inbound.sql:5-8`).
- `desktop_secret_jobs` table (password-manager reads; `status` CHECK `queued`/`running`/`done`/`failed`, `action` CHECK `search`/`read`, sealed `result_enc`) + host index (`0030_local_apps_inbound.sql:10-27`).
- `desktop_mcp_calls` table (queued MCP calls for local apps; same status CHECK) + host index (`0030_local_apps_inbound.sql:29-44`).
- `messaging_inbound` table with PK `(connector_id, external_id)` — webhook dedup (`0030_local_apps_inbound.sql:46-52`).
- RLS on all three, locked to service role (`0030_local_apps_inbound.sql:54-58`).

### `0031_guest_account_merge.sql` — guest merge

- `account_merge_tickets` table (`token_hash` unique, guest/target users, 30-minute default expiry) + guest index; RLS locked to service role (`0031_guest_account_merge.sql:7-21`).
- `public.merge_guest_into_user(p_guest uuid, p_target uuid)` — `SECURITY DEFINER` plpgsql function: validates guest vs full account via `auth.users.is_anonymous`, takes `pg_advisory_xact_lock`, walks `pg_constraint` for single-column FKs to `profiles`/`auth.users` and rewrites them (on unique violation, moves row-by-row and drops clashes, target wins), then explicitly rewrites FK-less user-id columns (`messages.sender_id`, `canvas_versions.author_id`, `task_events.actor_id`, `task_comments.author_id`, `audit_logs.actor_id`). Returns `{ moved, dropped }` counts. Single transaction; execute granted to `service_role` only (`0031_guest_account_merge.sql:32-128`).

### `0032_mac_runner_tools.sql` — Mac runner

- `local_runner_jobs` columns: `run_id` (FK to `agent_runs`), `mcp_token_enc` (one-run sealed MCP token), `mcp_token_id`, `app` (`0032_mac_runner_tools.sql:6-11`).
- Expression index `tool_calls_mac_key_idx` on `(room_id, (args -> '_mac' ->> 'key'))` so tool cards from a Mac run are found by the app's own tool-use id (`0032_mac_runner_tools.sql:14-15`).

### `0033_cloud_plans.sql` — cloud billing

- `org_plans` table (`plan` default `free` with CHECK `free`/`pro`/`team`, provider `customer_id`/`subscription_id`, `current_period_end`, `cancel_at_period_end`) + unique partial `org_plans_customer_idx` on `customer_id where customer_id is not null` (`0033_cloud_plans.sql:6-20`).
- `org_usage_monthly` table, PK `(org_id, month)` (`0033_cloud_plans.sql:23-29`).
- RLS with member-read policies `org_plans_member_read` and `org_usage_member_read`; writes revoked from everyone except `service_role`; select granted to `authenticated` (`0033_cloud_plans.sql:33-46`).
- `public.bump_server_turns(p_org uuid, p_month text, p_limit integer)` — `SECURITY DEFINER` atomic increment-and-check: upserts the month row, increments `server_turns` only when under `p_limit` (null = unlimited), returns `(allowed, used)`. Execute granted to `service_role` only (`0033_cloud_plans.sql:49-79`).

### `0034_computer_placement.sql` — placement settings

- `org_computer_settings` table (Boat key envelope columns `boat_ciphertext`/`boat_iv`/`boat_tag`/`boat_last4`, `vps_ssh_alias`, `vps_start_automatically` default false) (`0034_computer_placement.sql:4-13`).
- `cloud_home_copies` table (per-user `snapshot` JSONB, `copied_at`, `restored_at`) (`0034_computer_placement.sql:19-25`).
- RLS on both, locked to service role (`0034_computer_placement.sql:15-29`).

### `0035_model_choice.sql` — per-chat model selection

- `local_runner_jobs` columns `model` and `effort` (what a Mac run uses inside the local app; null keeps the app default) (`0035_model_choice.sql:9-10`).
- `room_agents.model_override` JSONB — "only this chat" model override, shape `{ keyId, model, effort, providerKeyId, agentModel, runner }` (`0035_model_choice.sql:11`; typed at `packages/db/src/schema/rooms.ts:25-32`).

### `0036_room_execution_mode.sql` — execution mode per chat

- `rooms.execution_mode text not null default 'ask_risky'` plus the idempotent `rooms_execution_mode_check` constraint (`'ask_risky'`, `'review_all'`). `review_all` makes the orchestrator's audited tool wrapper ask before every tool call; there is no value that skips approval for risky tools.

### `0037_execution_mode_mac.sql` — four permission modes

- `rooms.execution_mode_set_by uuid` (FK `profiles`, `on delete set null`) and `rooms_execution_mode_check` widened to `'review_all', 'ask_risky', 'auto', 'turbo'`. `auto`/`turbo` loosen only the Mac of the person who set them (the job claim checks `execution_mode_set_by` against the host owner); server tools marked dangerous keep asking in every mode.

### `0038_agent_last_seen.sql` — when an invited app last called in

- `agents.last_seen_at timestamptz` (nullable). The orchestrator stamps it on every authenticated bot call (API key or OAuth access token), at most every 30 seconds. Room settings shows "open now" from it, and the coordinator posts "app isn't open" when a turn is handed to an app that hasn't called in for 15 minutes. Idempotent (`add column if not exists`).

---

## Dependency and ordering summary

| After | Because |
| :--- | :--- |
| All Drizzle migrations before all SQL files | `src/migrate.ts` runs the Drizzle phase first; SQL scripts alter those tables. |
| `0001_functions.sql` → `0005_ia.sql`, `0019`, `0020` | `set_updated_at()` trigger function must exist. |
| `0002_rls.sql` helpers → most later policies | `is_org_member` / `can_read_room` / `is_room_member` are referenced by 0005–0034. |
| `0008` after `0005` and `0007` | Extends `tasks`/`room_schedules` (0005) and `agent_reads` (0007, Drizzle 0003). |
| `0009` after Drizzle 0000 | Uses the `provider` enum for `agent_templates.default_provider`. |
| `0011`/`0012` after `0002` | Memory policies call the RLS helpers. |
| `0030` after `0018` and `0024` | `messaging_inbound` references `workspace_connectors`; `desktop_secret_jobs`/`desktop_mcp_calls` reference `desktop_hosts`. |
| `0031` after Supabase `auth` schema | `merge_guest_into_user` reads `auth.users`. |
| `0032`/`0035` after `0024` | Extend `local_runner_jobs`. |
| `0033` after `0002` | Member-read policies use `org_members`. |
| `0035` after Drizzle 0000 | Extends `room_agents`. |
| `0029` standalone | `ALTER TYPE ... ADD VALUE` cannot run in a transaction, so the file contains only that statement. |

Realtime publication additions across the catalog: `messages`, `tool_calls`, `canvases` (`0003`); `meetings`, `tasks`, `task_comments` (`0005`); `task_events` (`0008`).

---

## Related docs

- [Database reference overview](./overview.md)
- [Connectors & Vault schemas](./schema-connectors-and-vault.md)
- [Computers, Devices & Desktop schemas](./schema-computers-devices-desktop.md)
- [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)
- [Billing schema](./schema-billing.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Seed script](./seed.md)
