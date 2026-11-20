import pg from "pg"
import { z } from "zod"
import type { ToolSpec } from "../audited"
import { resolveToolCredential } from "../secrets"

const MAX_ROWS = 100
const MAX_RESULT_CHARS = 120_000

export function postgresInspectorTool(orgId: string, agentId?: string): ToolSpec {
  return {
    name: "postgres_inspector",
    description:
      "Run one read-only SELECT/WITH query against the organization's configured Postgres database. Limited to 100 rows, 10 second timeout, read-only transaction. Requires a connection string in Settings → Tools.",
    schema: z.object({
      query: z.string().min(1).max(10_000),
    }),
    dangerous: false,
    execute: async (input: { query: string }, signal?: AbortSignal) => {
      const config = await resolveToolCredential({ orgId, agentId, tool: "postgres_inspector" })
      if (!config?.connectionString) {
        throw new Error(
          "postgres_inspector is not configured. Add a connection string in Settings → Tools.",
        )
      }
      const query = input.query.trim().replace(/;\s*$/, "")
      if (!/^(select|with)\b/i.test(query)) {
        throw new Error("Only a single read-only SELECT or WITH query is allowed.")
      }
      if (query.includes(";")) {
        throw new Error("Multiple statements are not allowed.")
      }
      const client = new pg.Client({
        connectionString: config.connectionString,
        connectionTimeoutMillis: 5_000,
        query_timeout: 10_000,
        statement_timeout: 10_000,
      })
      const abort = () => {
        void client.end().catch(() => {})
      }
      signal?.addEventListener("abort", abort, { once: true })
      try {
        await client.connect()
        await client.query("begin transaction read only")
        await client.query("set local statement_timeout = '10s'")
        const result = await client.query({ text: query, rowMode: "array" })
        const columns = result.fields.map((f) => f.name)
        const rows = result.rows
          .slice(0, MAX_ROWS)
          .map((row) => Object.fromEntries(columns.map((c, i) => [c, (row as unknown[])[i]])))
        const payload = {
          columns,
          rows,
          row_count: result.rows.length,
          truncated: result.rows.length > MAX_ROWS,
        }
        if (JSON.stringify(payload).length > MAX_RESULT_CHARS) {
          return {
            columns,
            rows: rows.slice(0, 20),
            truncated: true,
            note: "Result too large; showing 20 rows.",
          }
        }
        return payload
      } finally {
        await client.query("rollback").catch(() => {})
        signal?.removeEventListener("abort", abort)
        await client.end().catch(() => {})
      }
    },
  }
}
