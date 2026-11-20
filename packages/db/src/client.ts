import { drizzle } from "drizzle-orm/node-postgres"
import pg from "pg"
import { createPgConfig } from "@electric-sql/pglite/node-postgres"
import { createRequire } from "node:module"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import * as schema from "./schema"

export interface CreateDbOptions {
  max?: number
  dataDir?: string
}

function ensurePgliteSymlink(): void {
  try {
    const req = createRequire(import.meta.url)
    const pgliteEntry = req.resolve("@electric-sql/pglite")
    const distDir = path.dirname(pgliteEntry)
    const releaseLink = path.join(distDir, "release")
    if (!fs.existsSync(releaseLink)) {
      try {
        fs.symlinkSync(".", releaseLink, "dir")
      } catch {}
    }
  } catch {}
}

export function isLocalConnection(connectionString?: string): boolean {
  if (!connectionString) return false
  const s = connectionString.trim().toLowerCase()
  return s === "local" || s.startsWith("pglite:") || s.startsWith("memory:")
}

export function getDefaultLocalDataDir(): string {
  const base = process.env.SAYABOT_DATA_DIR || path.join(os.homedir(), ".sayabot", "data")
  return path.join(base, "db")
}

export function createDb(connectionString?: string, options?: CreateDbOptions) {
  if (isLocalConnection(connectionString) || (!connectionString && process.env.SAYABOT_LOCAL === "true")) {
    ensurePgliteSymlink()
    let config: any
    const conn = (connectionString || "").trim().toLowerCase()
    if (conn === "memory" || conn === "pglite://memory" || conn === "memory:") {
      config = createPgConfig()
    } else {
      let dataDir = options?.dataDir
      if (!dataDir && connectionString?.startsWith("pglite://")) {
        const raw = connectionString.slice("pglite://".length)
        if (raw && raw !== "memory") dataDir = raw
      }
      if (!dataDir) {
        dataDir = getDefaultLocalDataDir()
      }
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true })
      }
      config = createPgConfig(dataDir)
    }

    if (config?.connection?.parse) {
      const origParse = config.connection.parse.bind(config.connection)
      config.connection.parse = function (query: any, more: any) {
        if (query && query.types && !Array.isArray(query.types)) {
          query.types = undefined
        }
        return origParse(query, more)
      }
    }

    const pool = new pg.Pool(config)
    const db = drizzle(pool, { schema })
    return { pool, db, isLocal: true }
  }

  const connStr = connectionString || ""
  const isSupabasePooler = connStr.includes(".pooler.supabase.com")
  const defaultMax = isSupabasePooler ? 4 : 10
  const max =
    options?.max ??
    (process.env.DATABASE_POOL_MAX ? parseInt(process.env.DATABASE_POOL_MAX, 10) : defaultMax)
  const pool = new pg.Pool({
    connectionString: connStr,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  const db = drizzle(pool, { schema })
  return { pool, db, isLocal: false }
}

export type Db = ReturnType<typeof createDb>["db"]
export type DbPool = pg.Pool

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL
  if (!url) {
    if (process.env.SAYABOT_LOCAL === "true") return "local"
    throw new Error("DATABASE_URL is not set")
  }
  return url
}
