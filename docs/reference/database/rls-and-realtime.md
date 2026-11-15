# RLS & Realtime Deep Dive

Sayabot's authorization model lives in raw SQL, not Drizzle: `packages/db/sql/0002_rls.sql` enables Row Level Security on the core tables and builds every check on a small set of `SECURITY DEFINER` helper functions, `0001_functions.sql` installs the triggers Drizzle cannot express, `0003_realtime.sql` wires the Supabase realtime publication and broadcast policies, and `0004_rpc.sql` exposes the one RPC the web app needs. This page explains how the pieces fit, how `src/migrate.ts` applies them, and the pitfalls that follow from the design.

Source files: `packages/db/sql/0002_rls.sql`, `packages/db/sql/0003_realtime.sql`, `packages/db/sql/0001_functions.sql`, `packages/db/sql/0004_rpc.sql`, `packages/db/src/migrate.ts`

---

## The RLS pattern: `auth.uid()` and org membership

All policies answer one question — "which orgs does the caller belong to?" — through `auth.uid()`, the Supabase JWT-resolved user id. Helpers in `0002_rls.sql:4-70` are `STABLE SECURITY DEFINER` with `set search_path = public`:

| Helper | Returns true when |
| :--- | :--- |
| `is_org_member(p_org)` | Caller has any row in `org_members` for the org. |
| `is_org_admin(p_org)` | Caller's `org_members.role` is `owner` or `admin`. |
| `is_org_owner(p_org)` | Caller's role is exactly `owner`. |
| `org_has_members(p_org)` | The org has at least one member (bootstrap check). |
| `shares_org_with(p_user)` | Caller and `p_user` share any org membership. |
| `is_room_member(p_room)` | Caller is in `room_members` for the room. |
| `can_read_room(p_room)` | Caller is a room member **or** the room is `kind = 'public'` and the caller is a member of the room's org. |
| `is_room_admin(p_room)` | Caller is a room admin, or an org owner/admin of the room's org. |

The `SECURITY DEFINER` marking matters: the helpers run as the function owner, so reading `org_members` inside a policy does **not** recurse through `org_members`' own RLS policy. That recursion (and its infinite-loop error) is the classic mistake this pattern avoids.

`can_read_room` is the workhorse — messaging, canvas, tool, task, and memory policies all route through it, giving the read model: private rooms are visible to their members; public rooms to the whole org (`0002_rls.sql:51-58`).

### Policy inventory

`0002_rls.sql` enables RLS on 21 tables (`0002_rls.sql:72-92`) and creates these policies (all `to authenticated`):

- **Profiles**: `profiles_select` (own row or shares an org), `profiles_update_own` (own row only).
- **Identity**: `orgs_select` (member), `org_members_select` (own membership or fellow member).
- **Agents**: `agents_select` (org member).
- **Rooms**: `rooms_select`, `room_members_select`, `room_agents_select` (all via `can_read_room`).
- **Messaging**: `messages_select` (`can_read_room`), `messages_insert_human` (the only insert path for clients: `can_read_room` AND `sender_type = 'human'` AND `sender_id = auth.uid()` AND `status = 'complete'` — `0002_rls.sql:145-153`), `turn_sessions_select`, `agent_runs_select`.
- **Canvas**: `canvases_select`, `canvas_versions_select` (via parent canvas's room).
- **Tools**: `mcp_servers_select` (org member), `tool_calls_select` (`can_read_room`).
- **Ops**: `webhook_deliveries_select` and `audit_logs_select` (org **admin** only), `usage_events_select` (member), `model_pricing_select` (`using (true)` — public rate card).

### The ciphertext pattern: no policies at all

Three tables get RLS enabled with **zero policies**, so even `authenticated` reads nothing; only the service role bypasses RLS:

- `provider_keys`, `agent_api_keys`, `org_tool_configs` — plus `revoke all ... from anon, authenticated` and `from public` (`0002_rls.sql:213-238`). The comment says it directly: "ciphertext is only reachable through the service role."

Later migrations repeat this lock-down for every new secret-bearing or server-only table:

| Tables | Locked in | Notes |
| :--- | :--- | :--- |
| `agent_reads` | `0007` | Read cursors; orchestrator-only by design. |
| `vault_secrets`, `agent_secret_grants`, `oauth_clients`, `oauth_codes`, `oauth_tokens` | `0009` | Secret broker and OAuth token stores. |
| `bot_invites` | `0020` | `poll_token_hash` must never reach a browser. |
| `device_pairings` | `0021` | Code and device-token hashes. |
| `workspace_invites` | `0023` | Invite links are grants. |
| `desktop_hosts`, `remote_sessions`, `local_runner_jobs` | `0024` | Host tokens, SDP, prompts. |
| `mobile_push_tokens` | `0026` | Expo tokens. |
| `desktop_secret_jobs`, `desktop_mcp_calls`, `messaging_inbound` | `0030` | Sealed results, webhook dedup. |
| `account_merge_tickets` | `0031` | Merge tokens (raw token in an httpOnly cookie). |
| `org_computer_settings`, `cloud_home_copies` | `0034` | Boat key envelope, home snapshots. |

Where clients need read access to a locked table, a **safe view** exposes only non-secret columns: `provider_keys_public`, `org_tool_configs_public` (`0002_rls.sql:217-225`), `vault_secrets_public`, `agent_secret_grants_public` (`0009_bot_platform.sql:118-155`), `vector_providers_public` (`0017`), `workspace_connectors_public` (`0018`).

Two access styles coexist by design:

1. **Policies + grants** (rooms, messages, tasks, memories…): clients query directly, filtered by RLS.
2. **Lock-down + view or server action** (secrets, invites, desktop jobs): the web app reads through server-side code running as `service_role`, which bypasses RLS entirely.

`usage_rollup()` (`0022`) deliberately uses `SECURITY INVOKER` so the caller's RLS still limits what the analytics function sums, while `storage_summary()` (`0025`) uses `SECURITY DEFINER` (it must sum across tables) but re-checks membership manually and raises for outsiders (`0025_storage_summary.sql:16-18`).

### Worked example: posting a chat message

When a browser POSTs a message, the full authorization chain is:

1. PostgREST connects as `authenticated` with the user's JWT, so `auth.uid()` resolves.
2. The `messages_insert_human` policy (`0002_rls.sql:145-153`) must pass its four conjuncts: `can_read_room(room_id)` (member, or public room in a shared org), `sender_type = 'human'`, `sender_id = auth.uid()`, `status = 'complete'` — a client can never speak as an agent, as someone else, or park a `streaming` message.
3. The insert was granted explicitly in `0002_rls.sql:233` (`grant insert on public.messages to authenticated`) — RLS filters rows but the grant still has to admit the command.
4. Agent-written messages (and edits to existing rows) have no policy, so only the service role can create them — the orchestrator writes those rows server-side.

The same shape repeats for reads: any client `select` on `messages`, `agent_runs`, `tool_calls`, `tasks`, or `memories` is silently narrowed to rooms the user can read, which is why UI queries can stay naive — the database does the scoping.

---

## Functions & triggers (`0001_functions.sql`)

- **`set_updated_at()`** (`0001_functions.sql:3-11`) — generic `before update` trigger stamping `updated_at = now()`. Installed on `rooms`, `agents`, `messages`, `turn_sessions`, `tool_calls`, `canvases`, `mcp_servers`, `model_pricing`, `org_tool_configs`; later migrations add it to `meetings`/`room_schedules`/`tasks`/`room_reads` (`0005_ia.sql:3-16`), `owner_facts` (`0019`), and `bot_invites` (`0020`). Each install drops-then-creates, so re-runs stay idempotent.
- **`handle_new_user()`** (`0001_functions.sql:32-63`) — `SECURITY DEFINER` trigger `on_auth_user_created` on `auth.users`: on signup it upserts a `profiles` row, resolving `display_name` from `raw_user_meta_data` (`full_name` → `name` → `user_name` → email prefix → `'member'`) and `avatar_url` from `avatar_url`/`picture`. `on conflict (id)` fills empty/generic display names but never overwrites a real one, and keeps the first non-null avatar. `0013_auth_oauth_profiles.sql` re-creates the identical function (an idempotent refresh of Google/GitHub/email metadata handling). `0001` also backfills profiles for pre-existing `auth.users` rows.
- **Thread-root FK** (`0001_functions.sql:76-86`) — Drizzle models the `thread_root_id` column, but the self-referencing constraint is added here, guarded by an existence check: `messages.thread_root_id → messages.id on delete cascade`.

---

## Realtime (`0003_realtime.sql`)

### Publication setup

Realtime feeds run through the `supabase_realtime` publication. The script adds `messages`, `tool_calls`, and `canvases` — each addition is guarded twice: the whole block no-ops when the publication doesn't exist (non-Supabase/self-hosted databases), and each table is added only when not already in `pg_publication_tables` (`0003_realtime.sql:4-20`). `0005_ia.sql:82-98` later adds `meetings`, `tasks`, `task_comments`, and `0008_task_integrity.sql:90-101` adds `task_events`.

### Replica identity

```sql
alter table public.messages replica identity full;
```

(`0003_realtime.sql:22`) — `postgres_changes` `UPDATE`/`DELETE` payloads then carry the full old row, which the clients rely on for reconciliation.

### Broadcast/presence authorization

When the `realtime.messages` table exists, two policies authorize private channels named `room:<uuid>` (`0003_realtime.sql:24-56`):

- `mesh_room_read` (select): the topic must look like `room:%`, the referenced room must exist, and `can_read_room` must hold.
- `mesh_room_write` (insert): identical predicate.

This is what stops a user from subscribing to a private room's broadcast channel they aren't a member of — authorization is evaluated against the same helpers as table RLS.

---

## RPCs (`0004_rpc.sql` and friends)

`notify_tool_resolution(p_tool_call uuid, p_status text)` is the single RPC in `0004_rpc.sql:2-17`:

- `SECURITY DEFINER` plpgsql; rejects any `p_status` other than `approved`/`rejected` with `raise exception`.
- Emits `pg_notify('tool_call_resolved', json_build_object('toolCallId', ..., 'status', ...))` — the channel the orchestrator LISTENs on to unblock a run waiting at the human approval gate.
- Locked to the service role: `revoke all ... from public, anon, authenticated` then `grant execute ... to service_role` (`0004_rpc.sql:19-20`).

Later migrations add more RPCs in the same style, each with explicit privilege wiring:

| Function | File | Access |
| :--- | :--- | :--- |
| `usage_rollup(p_org, p_since)` | `0022_usage_rollup.sql` | `SECURITY INVOKER`; execute for `authenticated` + `service_role`. |
| `storage_summary(p_org)` | `0025_storage_summary.sql` | `SECURITY DEFINER` with manual membership check; `authenticated` + `service_role`. |
| `bump_server_turns(p_org, p_month, p_limit)` | `0033_cloud_plans.sql` | `SECURITY DEFINER`; `service_role` only. |
| `merge_guest_into_user(p_guest, p_target)` | `0031_guest_account_merge.sql` | `SECURITY DEFINER`; `service_role` only. |

---

## How migrations run (`src/migrate.ts`)

`packages/db/src/migrate.ts` is a standalone `tsx` entrypoint (invoked by `pnpm db:migrate`):

1. Loads the repo-root `.env` and requires `DATABASE_URL` (`src/migrate.ts:7-13`).
2. **Phase 1 — Drizzle**: `migrate(db, { migrationsFolder: .../migrations })` applies `0000`–`0003`, recorded in `drizzle.__drizzle_migrations` (`src/migrate.ts:18-19`). Each runs once, tracked by tag.
3. **Phase 2 — SQL**: reads `packages/db/sql/`, filters `*.sql`, sorts lexically, and executes each file with `pool.query(text)` (`src/migrate.ts:21-31`). **This phase re-applies on every run** — there is no tracking table — which is why every SQL file must be idempotent (`create or replace`, `if not exists`, `drop policy if exists ... create policy`, `do $$ ... exception when duplicate_object`).
4. Errors abort the run and set a non-zero exit code; the pool always closes in `finally` (`src/migrate.ts:33-38`).

Consequences of the two-phase design: Drizzle snapshots describe the tables; the SQL layer layers behavior (RLS, triggers, functions) on top. A `pnpm db:generate` diff never sees RLS or functions, so behavioral changes always go into a new numbered `sql/` file.

---

## Common pitfalls

- **Editing an already-applied SQL file in place.** Phase 2 re-runs everything, so edits apply to existing databases too — safe only if the file stays idempotent. New work goes in a new numbered file.
- **Non-idempotent statements.** `create type`, bare `create index`, `add constraint` fail on re-run. The codebase wraps them (`do $$ begin ... exception when duplicate_object then null; end $$`) or uses `if not exists`. `alter type ... add value` (`0029`) additionally **cannot run inside a transaction**, so that file contains only the one statement — `pool.query` runs each file outside an explicit transaction.
- **Advisory-lock scope.** `pg_advisory_lock` is session-scoped; the orchestrator must acquire it on a dedicated pooled client (see `apps/orchestrator/src/db.ts`). In SQL, `merge_guest_into_user` uses `pg_advisory_xact_lock` (`0031_guest_account_merge.sql:57`) precisely because it releases with the transaction — never mix the two patterns.
- **RLS recursion.** Writing `org_id in (select org_id from org_members where ...)` inline in a policy makes the table check itself. Always call the `SECURITY DEFINER` helpers instead.
- **`SECURITY DEFINER` needs `set search_path`.** Every definer function here sets `search_path = public`; omitting it lets a malicious schema override function references.
- **Forgetting the policy target.** Policies default to all roles; these all specify `to authenticated` so `anon` gets nothing, and `revoke ... from authenticated` is still required for lock-down tables because policies filter but grants admit.
- **Realtime on non-Supabase.** The publication and `realtime.messages` blocks are guarded, so self-hosted Postgres just skips realtime instead of failing migration.
- **pgvector is optional.** `0027` attempts `create extension vector` and downgrades failure to a notice; recall code must cope with the extension being absent.
- **`nulls not distinct` on unique indexes.** `agent_templates_org_slug_idx` was recreated in `0015` with `nulls not distinct` so global templates (`org_id is null`) also conflict-detect on `(org_id, slug)` — a plain unique index treats NULLs as distinct and `ON CONFLICT` would never fire.

---

## Related docs

- [Database reference overview](./overview.md)
- [Migrations catalog](./migrations-catalog.md)
- [Connectors & Vault schemas](./schema-connectors-and-vault.md)
- [Computers, Devices & Desktop schemas](./schema-computers-devices-desktop.md)
- [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)
- [Billing schema](./schema-billing.md)
- [Seed script](./seed.md)
