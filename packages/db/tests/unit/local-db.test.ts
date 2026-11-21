import { describe, expect, it } from "vitest"
import { createDb, isLocalConnection, requireDatabaseUrl } from "../../src/client"
import { runAllMigrations } from "../../src/migrate"
import { seedLocalWorkspace } from "../../src/seed"

describe("Local Zero-Config PGlite Database", () => {
  it("detects local connection strings", () => {
    expect(isLocalConnection("local")).toBe(true)
    expect(isLocalConnection("pglite://memory")).toBe(true)
    expect(isLocalConnection("memory:")).toBe(true)
    expect(isLocalConnection("postgres://localhost:5432/db")).toBe(false)
  })

  it("boots in-memory PGlite instance and supports advisory locks", async () => {
    const { db, pool, isLocal } = createDb("memory")
    expect(isLocal).toBe(true)
    expect(db).toBeDefined()
    expect(pool).toBeDefined()

    const res = await pool.query("SELECT 100 as num")
    expect(res.rows[0].num).toBe(100)

    // Advisory lock check
    const client = await pool.connect()
    const lockRes = await client.query("SELECT pg_advisory_lock(hashtext($1)::bigint)", [
      "test-key",
    ])
    expect(lockRes.rows).toBeDefined()
    const unlockRes = await client.query("SELECT pg_advisory_unlock(hashtext($1)::bigint)", [
      "test-key",
    ])
    expect(unlockRes.rows[0].pg_advisory_unlock).toBe(true)
    client.release()

    await pool.end()
  }, 60_000)

  it("runs migrations and seeds local workspace on in-memory PGlite", async () => {
    const { db, pool } = createDb("memory")

    // Run all migrations
    const { applied } = await runAllMigrations(pool, { quiet: true })
    expect(applied).toBeGreaterThan(0)

    // Seed local workspace
    const workspace = await seedLocalWorkspace(db, pool)
    expect(workspace.orgId).toBe("00000000-0000-0000-0000-000000000002")
    expect(workspace.userId).toBe("00000000-0000-0000-0000-000000000001")
    expect(workspace.agentId).toBe("00000000-0000-0000-0000-000000000003")
    expect(workspace.roomId).toBe("00000000-0000-0000-0000-000000000004")

    // Verify created records in DB
    const orgCheck = await pool.query("SELECT name FROM orgs WHERE id = $1", [workspace.orgId])
    expect(orgCheck.rows[0].name).toBe("Local Workspace")

    const agentCheck = await pool.query(
      "SELECT display_name, handle, capabilities FROM agents WHERE id = $1",
      [workspace.agentId],
    )
    expect(agentCheck.rows[0].display_name).toBe("Saya")
    expect(agentCheck.rows[0].handle).toBe("saya")
    expect(agentCheck.rows[0].capabilities.orchestrator).toBe(true)

    const roomCheck = await pool.query("SELECT name FROM rooms WHERE id = $1", [workspace.roomId])
    expect(roomCheck.rows[0].name).toBe("general")

    await pool.end()
  }, 60_000)
})
