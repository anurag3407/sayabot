# Billing Schema

This reference documents `packages/db/src/schema/billing.ts`, which holds Sayabot Cloud's plan and metering tables: `org_plans` (a workspace's subscription plan and payment-provider references) and `org_usage_monthly` (per-calendar-month usage rollups). Both tables are **Cloud-only** (`SAYABOT_EDITION=cloud`): self-hosted servers create them via migration but never fill them, and nothing reads them on self-hosted deployments. The companion SQL in `packages/db/sql/0033_cloud_plans.sql` adds the RLS policies, grants, the `plan` CHECK constraint, and the atomic `bump_server_turns()` RPC.

Source files: `packages/db/src/schema/billing.ts`, `packages/db/sql/0033_cloud_plans.sql`, `packages/db/src/schema/ops.ts` (raw usage events)

---

## Workspace Plans (`org_plans`)

Defined at `packages/db/src/schema/billing.ts:8`. One row per workspace; `org_id` is the primary key. Row creation and updates are driven by the Stripe webhook flow on the Cloud deployment — no client can write (see RLS below).

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `org_id` | `uuid` | PK, FK → `orgs.id`, `ON DELETE CASCADE` | The subscribed workspace. |
| `plan` | `text` | NOT NULL, default `"free"` | Plan tier. The Drizzle schema keeps this free-form; the SQL migration adds `org_plans_plan_check` restricting it to `free`, `pro`, or `team` (`packages/db/sql/0033_cloud_plans.sql:17`). |
| `status` | `text` | NOT NULL, default `"active"` | Payment provider's subscription status: `active`, `trialing`, `past_due`, `canceled`, … (`packages/db/sql/0033_cloud_plans.sql:9`). |
| `provider` | `text` | nullable | Payment provider, e.g. `stripe`. |
| `customer_id` | `text` | nullable | Provider customer id. Uniquely indexed when non-null (see below). |
| `subscription_id` | `text` | nullable | Provider subscription id. |
| `current_period_end` | `timestamptz` | nullable | End of the current billing period. |
| `cancel_at_period_end` | `boolean` | NOT NULL, default `false` | True when cancellation is scheduled at period end. |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Last webhook-driven update. |

Index from SQL (not in the Drizzle schema): unique partial `org_plans_customer_idx` on `(customer_id)` with `where customer_id is not null` (`packages/db/sql/0033_cloud_plans.sql:19-20`), so one provider customer maps to at most one workspace plan.

---

## Monthly Usage Rollups (`org_usage_monthly`)

Defined at `packages/db/src/schema/billing.ts:22`. One row per workspace per calendar month (UTC, formatted `"2026-11"`), with the composite primary key `(org_id, month)`. This is the fast-read rollup behind Cloud's turn limits; the fine-grained source is `usage_events` (see [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)).

| Column | SQL type | Constraints / Default | Description |
| :--- | :--- | :--- | :--- |
| `org_id` | `uuid` | NOT NULL, FK → `orgs.id`, `ON DELETE CASCADE`, part of PK | The workspace. |
| `month` | `text` | NOT NULL, part of PK | Calendar month in UTC, `"2026-11"` format. |
| `server_turns` | `integer` | NOT NULL, default `0` | Count of server-side agent replies this month. |
| `updated_at` | `timestamptz` | NOT NULL, default `now()` | Last increment time. |

---

## How the row is incremented: `bump_server_turns()`

The SQL migration ships an atomic `SECURITY DEFINER` function used by the orchestrator to count one server reply and check the plan limit in the same step (`packages/db/sql/0033_cloud_plans.sql:49-76`):

```sql
create or replace function public.bump_server_turns(p_org uuid, p_month text, p_limit integer)
returns table (allowed boolean, used integer)
```

Behavior:

1. `insert ... on conflict (org_id, month) do nothing` guarantees the month's row exists.
2. `update ... set server_turns = server_turns + 1 ... where ... (p_limit is null or server_turns < p_limit)` increments only when under the limit. The single `UPDATE` is atomic, so parallel turns cannot overshoot the limit.
3. If the update matched no row (limit reached), it re-reads the current count and returns `(false, used)`; otherwise `(true, used)`.

Permissions (`packages/db/sql/0033_cloud_plans.sql:78-79`): `EXECUTE` is revoked from `public`, `anon`, and `authenticated`, and granted only to `service_role`.

---

## RLS and grants

Both tables enable Row Level Security with member-read policies (`packages/db/sql/0033_cloud_plans.sql:33-46`):

- `org_plans_member_read`: `for select using (org_id in (select org_id from org_members where user_id = auth.uid()))`
- `org_usage_member_read`: same predicate on `org_usage_monthly`.

Members can see their workspace's plan and usage — the billing page reads it on the server, but the phone and future clients may read it directly. Writes are server-only:

```sql
revoke insert, update, delete on public.org_plans, public.org_usage_monthly from anon, authenticated, public;
grant select on public.org_plans, public.org_usage_monthly to authenticated;
grant all on public.org_plans, public.org_usage_monthly to service_role;
```

---

## RLS policy inventory

Every policy on the two billing tables, verbatim in purpose:

| Policy | Table | Command | Predicate |
| :--- | :--- | :--- | :--- |
| `org_plans_member_read` | `org_plans` | `SELECT` | `org_id in (select org_id from org_members where user_id = auth.uid())` |
| `org_usage_member_read` | `org_usage_monthly` | `SELECT` | same membership predicate |

Neither table has insert/update/delete policies for client roles — combined with the explicit `revoke insert, update, delete ... from anon, authenticated, public`, only the `service_role` (which bypasses RLS) can write. This matches the table's purpose: rows change exclusively through the payment webhook and the turn-counting RPC, both server-side.

---

## Where the numbers come from

- **`server_turns`**: incremented only by `bump_server_turns()` — one call per server-side agent reply. It is a counter of turns, not tokens.
- **Token and dollar detail**: lives one layer down in `usage_events` (`packages/db/src/schema/ops.ts:37`), which records per-call `input_tokens`, `output_tokens`, `cached_input_tokens`, `cost_usd`, `ttft_ms`, and `latency_ms`, grouped by `provider` and `model`. Rates per million tokens live in `model_pricing` (`packages/db/src/schema/ops.ts:80`), populated by the seed script (see [Seed script](./seed.md)).
- **Analytics reads**: server code aggregates `usage_events` through the `usage_rollup(p_org, p_since)` SQL function (`packages/db/sql/0022_usage_rollup.sql`) for per-agent/per-room/per-model breakdowns; `org_usage_monthly` is only the compact monthly counter used for plan-limit checks.

---

## `bump_server_turns()` truth table

| Situation | Result |
| :--- | :--- |
| Month row missing | Row is created (`server_turns = 0`), then incremented. |
| Under `p_limit` (or `p_limit` is null) | `(allowed = true, used = new count)` |
| Exactly at/over `p_limit` | `(allowed = false, used = current count)` — no increment happened. |
| Parallel calls racing | Each `UPDATE` is a single atomic statement, so the sum of increments never exceeds the limit; losers re-read the count and return `false`. |

The function is `SECURITY DEFINER` with `search_path = public`, and `EXECUTE` is revoked from `public`, `anon`, and `authenticated` before being granted to `service_role` (`packages/db/sql/0033_cloud_plans.sql:78-79`).

---

## Cloud vs self-hosted

Per the doc comment at `packages/db/src/schema/billing.ts:4-6`, these tables are only meaningful when `SAYABOT_EDITION=cloud`. Self-hosted servers run the same migration (so the schema is uniform everywhere) but never fill the tables and never call `bump_server_turns()`. Plan limits for self-hosted workspaces come from `org_quotas` (see [Connectors & Vault schemas](./schema-connectors-and-vault.md)) instead, which caps agents, computers, disk, and secrets without a payment provider.

Note that the `plan` CHECK constraint (`free`/`pro`/`team`) exists only in the SQL migration, not in the Drizzle schema — `pnpm db:generate` will not reproduce it if the table is regenerated, so treat `sql/0033_cloud_plans.sql` as the source of truth for database-level plan validation.

---

## Related docs

- [Database reference overview](./overview.md)
- [Connectors & Vault schemas](./schema-connectors-and-vault.md)
- [Computers, Devices & Desktop schemas](./schema-computers-devices-desktop.md)
- [Engine, Tools & Ops schemas](./schema-engine-tools-ops.md)
- [Migrations catalog](./migrations-catalog.md)
- [RLS & Realtime deep dive](./rls-and-realtime.md)
- [Seed script](./seed.md)
