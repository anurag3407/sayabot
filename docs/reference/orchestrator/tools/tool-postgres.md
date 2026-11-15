# Postgres Tool (`postgres_inspector`)

`postgres_inspector` runs **one read-only SELECT/WITH query** against the organization's configured PostgreSQL database and returns up to 100 rows. Defense is layered: a query-shape allowlist, a read-only transaction, statement timeouts, and hard row/byte caps. `dangerous: false` — the tool cannot mutate data, so no approval gate is needed.

Source files: `apps/orchestrator/src/tools/builtins/postgres.ts`, `apps/orchestrator/src/tools/secrets.ts:36-104`

---

## 🎛️ Registration

Registered when the agent has the `postgres` capability (`src/tools/index.ts:354`):

```typescript
postgresInspectorTool(args.orgId, args.agent.id)   // agentId optional
```

Tool name: `postgres_inspector`. Description: *"Run one read-only SELECT/WITH query against the organization's configured Postgres database. Limited to 100 rows, 10 second timeout, read-only transaction. Requires a connection string in Settings → Tools."*

## 📥 Schema (`postgres.ts:14-16`)

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `query` | string (1–10,000 chars) | A single SELECT or WITH query |

## 🔑 Credential resolution (`postgres.ts:19-24`)

```typescript
const config = await resolveToolCredential({ orgId, agentId, tool: "postgres_inspector" })
if (!config?.connectionString) {
  throw new Error("postgres_inspector is not configured. Add a connection string in Settings → Tools.")
}
```

Two tiers ([./secrets-broker.md](./secrets-broker.md)):

1. Agent grant tier: unrevoked/unexpired `agent_secret_grants` with the canonical env `DATABASE_URL`, joined to sealed `vault_secrets` (`connectionString`/`url` extracted from the opened secret).
2. Org tier: `org_tool_configs` row for `(orgId, "postgres_inspector")`, `configEnc` opened with `MESH_KEK` → `connectionString`.

## ⚙️ Query validation (`postgres.ts:25-31`)

```typescript
const query = input.query.trim().replace(/;\s*$/, "")
if (!/^(select|with)\b/i.test(query)) {
  throw new Error("Only a single read-only SELECT or WITH query is allowed.")
}
if (query.includes(";")) {
  throw new Error("Multiple statements are not allowed.")
}
```

- One optional trailing semicolon is stripped, then the first word must be `SELECT` or `WITH` (case-insensitive).
- Any remaining `;` inside the query is rejected — no stacked statements.
- `dangerous: false` at the spec level, so **all** calls (even anything cleverly shaped) still pass through the read-only transaction below.

## 🛡️ Execution guardrails (`postgres.ts:32-65`)

| Guard | Implementation |
| :--- | :--- |
| Connection timeouts | `connectionTimeoutMillis: 5_000`, `query_timeout: 10_000`, `statement_timeout: 10_000` on the `pg.Client` |
| Run cancellation | the run's `AbortSignal` ends the client (`signal.addEventListener("abort", () => client.end())`, `postgres.ts:38-41`) |
| Read-only transaction | `BEGIN TRANSACTION READ ONLY` + `SET LOCAL statement_timeout = '10s'` before the query (`postgres.ts:44-45`) — writes, DDL, and `COPY` fail at the server |
| Row cap | `MAX_ROWS = 100`; `truncated: true` when the result had more |
| Result-size cap | `MAX_RESULT_CHARS = 120_000`; oversized payloads degrade to the first **20 rows** with `{ truncated: true, note: "Result too large; showing 20 rows." }` (`postgres.ts:57-59`) |
| Cleanup | `finally` block issues `ROLLBACK` (ignoring errors), removes the abort listener, and closes the client (`postgres.ts:61-65`) |

Results use `rowMode: "array"` and are zipped with the column names into objects.

## 📤 Return shape

```typescript
{
  columns: string[],                     // field names from the result
  rows: Record<string, unknown>[],       // up to 100 objects
  row_count: number,                     // total rows returned by the query (before the 100-row slice)
  truncated: boolean,                    // true when row_count > 100
}
// Oversized payloads instead:
{ columns, rows: <first 20>, truncated: true, note: "Result too large; showing 20 rows." }
```

## 🗃️ Tables and events

| Concern | Details |
| :--- | :--- |
| DB tables (Sayabot) | `agent_secret_grants` ⋈ `vault_secrets`, `org_tool_configs` (read-only); audit layer writes `tool_calls` |
| Target database | a fresh `pg.Client` per call using the org/agent-configured connection string — never the Sayabot internal pool |
| Realtime events | standard audit events only (`tool.started` / `tool.finished`) |

## 🧪 Example calls

```jsonc
// Inspect a table (safe)
{ "query": "select column_name, data_type from information_schema.columns where table_name = 'orders'" }
// → { columns: ["column_name", "data_type"], rows: [...], row_count: 12, truncated: false }

// Aggregate (safe)
{ "query": "with recent as (select * from events where created_at > now() - interval '7 days')
            select status, count(*) from recent group by status" }
```

```sql
-- All of these fail before touching the database:
update orders set status = 'x' ...      -- "Only a single read-only SELECT or WITH query is allowed."
select 1; drop table orders;            -- "Multiple statements are not allowed."
insert into logs values ('hi');         -- rejected by the first-word check
```

## ⚠️ Error modes

| Condition | Model-visible result |
| :--- | :--- |
| No connection string configured | `{ ok: false, error: "postgres_inspector is not configured. Add a connection string in Settings → Tools." }` |
| Non-SELECT/WITH query | `{ ok: false, error: "Only a single read-only SELECT or WITH query is allowed." }` |
| Multi-statement query | `{ ok: false, error: "Multiple statements are not allowed." }` |
| Query exceeds 10 s / connection refused / bad credentials | `{ ok: false, error: "<pg driver error message, secret-redacted>" }` |
| Run aborted mid-query | client ended via the abort listener; error surfaces as above |

## ⚠️ Notes

1. **"Inspector" scope.** The tool exposes one query string — there are no separate list-tables/list-schemas actions; agents inspect `information_schema`/`pg_catalog` with plain SELECTs.
2. **Validation is prefix-based, not a SQL parser.** The `^(select|with)` check plus the read-only transaction is the security boundary; a `SELECT` that calls side-effect-free functions only is allowed, and anything mutating fails server-side regardless.
3. **Fresh connection per call** — no pooling of target-DB connections, so bursty agents pay the connection setup cost each call (bounded by the 5 s connect timeout).

Related docs: [./tool-system.md](./tool-system.md) · [./secrets-broker.md](./secrets-broker.md) · [./tool-github.md](./tool-github.md) · [../../database/overview.md](../../database/overview.md) · [../../database/schema-engine-tools-ops.md](../../database/schema-engine-tools-ops.md)
