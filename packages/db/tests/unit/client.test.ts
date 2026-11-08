import { afterEach, describe, expect, it, vi } from "vitest"

const poolEnd = vi.fn(async () => {})
vi.mock("pg", () => ({
  default: { Pool: class { async connect() { return { query: async () => {}, release() {} } } async query() { return {} } async end() { return poolEnd() } } },
}))

import { createDb, requireDatabaseUrl } from "../../src/client"

describe("createDb / requireDatabaseUrl", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks() })

  it("creates a db+pool pair without connecting", () => {
    const { db, pool } = createDb("postgres://u:p@host:5432/db")
    expect(db).toBeDefined()
    expect(pool).toBeDefined()
    expect(typeof pool.query).toBe("function")
  })

  it("accepts an explicit pool max and falls back to env", () => {
    expect(() => createDb("postgres://u:p@h/db", { max: 5 })).not.toThrow()
    vi.stubEnv("DATABASE_POOL_MAX", "9")
    expect(() => createDb("postgres://u:p@h/db")).not.toThrow()
  })

  it("requireDatabaseUrl throws a helpful error when unset", () => {
    vi.stubEnv("DATABASE_URL", "")
    expect(() => requireDatabaseUrl()).toThrow(/DATABASE_URL/)
    vi.stubEnv("DATABASE_URL", "postgres://x")
    expect(requireDatabaseUrl()).toBe("postgres://x")
  })
})
