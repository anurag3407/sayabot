import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import * as schema from "./schema"

export function createDb(connectionString: string, options?: { max?: number }) {
  const isSupabasePooler = connectionString.includes(".pooler.supabase.com")
  const defaultMax = isSupabasePooler ? 4 : 10
  const max =
    options?.max ??
    (process.env.DATABASE_POOL_MAX ? parseInt(process.env.DATABASE_POOL_MAX, 10) : defaultMax)
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  const db = drizzle(pool, { schema })
  return { pool, db }
}

export type Db = ReturnType<typeof createDb>["db"]
export type DbPool = pg.Pool

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not set")
  return url
}
