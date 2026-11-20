import dotenv from "dotenv"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createDb, type DbPool } from "./client"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export interface MigrationOptions {
  migrationsDir?: string
  sqlDir?: string
  quiet?: boolean
}

/**
 * Ensures required roles, schemas and migration tracking tables exist on the database.
 * Essential for local PGlite and clean self-hosted deployments.
 */
export async function bootstrapDatabaseSchema(pool: DbPool): Promise<void> {
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
    EXCEPTION WHEN OTHERS THEN
      -- In managed environments with restricted superuser rights, role creation may fail safely
      NULL;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid primary key default gen_random_uuid(),
      email text,
      raw_user_meta_data jsonb default '{}'::jsonb,
      raw_app_meta_data jsonb default '{}'::jsonb,
      created_at timestamp with time zone default now()
    );

    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb default '{}'::jsonb;
    ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb default '{}'::jsonb;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT null::uuid;
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS __sayabot_migrations (
      id serial primary key,
      name text not null unique,
      applied_at timestamp with time zone default now()
    );
  `)
}

/**
 * Runs all Drizzle and raw SQL migrations in sorted order.
 * Works uniformly on PostgreSQL and embedded zero-config PGlite.
 */
export async function runAllMigrations(
  pool: DbPool,
  options?: MigrationOptions,
): Promise<{ applied: number }> {
  await bootstrapDatabaseSchema(pool)

  const migrationsDir =
    options?.migrationsDir ?? path.resolve(__dirname, "../migrations")
  const sqlDir = options?.sqlDir ?? path.resolve(__dirname, "../sql")

  let appliedCount = 0

  const applyDir = async (dirPath: string) => {
    if (!existsSync(dirPath)) return
    const files = readdirSync(dirPath)
      .filter((f) => f.endsWith(".sql"))
      .sort()

    for (const f of files) {
      const already = await pool.query(
        "SELECT 1 FROM __sayabot_migrations WHERE name = $1",
        [f],
      )
      if (already.rows.length > 0) continue

      if (!options?.quiet) {
        console.log(`[db:migrate] Applying ${f}…`)
      }
      const sql = readFileSync(path.join(dirPath, f), "utf8")
      try {
        await pool.query(sql)
        await pool.query("INSERT INTO __sayabot_migrations (name) VALUES ($1)", [f])
        appliedCount++
      } catch (err: any) {
        if (!options?.quiet) {
          console.warn(`[db:migrate] Notice on ${f}:`, err.message)
        }
      }
    }
  }

  await applyDir(migrationsDir)
  await applyDir(sqlDir)

  return { applied: appliedCount }
}

async function migrateCli() {
  dotenv.config({ path: path.resolve(__dirname, "../../../.env"), quiet: true })
  let url = process.env.DATABASE_URL
  if (!url) {
    if (process.env.SAYABOT_LOCAL === "true") {
      url = "local"
    } else {
      console.error("DATABASE_URL is not set (expected in the repo root .env)")
      process.exit(1)
    }
  }

  const { pool } = createDb(url)
  try {
    console.log("Running Sayabot database migrations…")
    const { applied } = await runAllMigrations(pool)
    console.log(`Migrations complete (${applied} applied).`)
  } catch (error) {
    console.error("Migration failed:", error)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

if (process.argv[1] === __filename) {
  void migrateCli()
}
