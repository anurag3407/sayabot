import { describe, expect, it } from "vitest"
import { getTableColumns, getTableName } from "drizzle-orm"
import * as schema from "../../src/schema/index"

describe("drizzle schema registry", () => {
  it("exports every table group", () => {
    const names = Object.keys(schema)
    for (const expected of ["orgs", "rooms", "agents", "messages", "tasks", "canvases", "vaultSecrets", "memories", "toolCalls", "orgRoleEnum", "providerEnum"]) {
      expect(names, expected).toContain(expected)
    }
  })

  it("every exported table has columns and a stable name", () => {
    const tables = Object.entries(schema).filter(
      ([, v]) => v && typeof v === "object" && getTableColumns(v as never) !== undefined,
    )
    expect(tables.length).toBeGreaterThan(10)
    for (const [, table] of tables) {
      expect(getTableName(table as never)).toMatch(/^[a-z_]+$/)
      expect(Object.keys(getTableColumns(table as never)).length).toBeGreaterThan(1)
    }
  })

  it("enum value sets are non-empty and unique", () => {
    for (const [name, value] of Object.entries(schema)) {
      if (!name.endsWith("Enum")) continue
      const values = (value as { enumValues?: string[] }).enumValues
      if (!values) continue
      expect(values.length, name).toBeGreaterThan(0)
      expect(new Set(values).size, name).toBe(values.length)
    }
  })

  it("core provider enum matches db provider enum (cross-package contract)", async () => {
    const { PROVIDERS } = await import("@sayabot/core")
    const dbProviders = (schema.providerEnum as unknown as { enumValues: string[] }).enumValues
    // db enum is the subset persisted to Postgres; every db value must be a known provider
    for (const p of dbProviders) expect(PROVIDERS, p).toContain(p)
  })

  it("room kind / turn mode enums mirror core constants", async () => {
    const core = await import("@sayabot/core")
    expect([...(schema.roomKindEnum as unknown as { enumValues: string[] }).enumValues].sort()).toEqual([...core.ROOM_KINDS].sort())
    expect([...(schema.turnModeEnum as unknown as { enumValues: string[] }).enumValues].sort()).toEqual([...core.TURN_MODES].sort())
  })
})
