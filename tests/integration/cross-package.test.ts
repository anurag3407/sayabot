// Cross-package contract tests living at the repo root.
// Run via: pnpm --filter sayabot test:integration  (vitest run tests/) — no workspace deps needed beyond the packages themselves.
import { describe, expect, it } from "vitest"
import { extractHandles, redactSecrets, TURN_MODES } from "@sayabot/core"
import { sealSecret, openSecret } from "@sayabot/llm"
import * as schema from "@sayabot/db/schema"

describe("core <-> llm <-> db contracts", () => {
  it("mentions extracted by core are the handles the orchestrator will plan turns for", () => {
    expect(extractHandles("please @ada and @bolt review this" )).toEqual(["ada", "bolt"])
    expect(extractHandles("no mentions here")).toEqual([])
  })

  it("secrets sealed by llm never survive core redaction in plaintext form", () => {
    const kek = Buffer.alloc(32, 3).toString("base64")
    const sealed = sealSecret("sk-1234567890abcdefghij", kek)
    expect(sealed).not.toContain("sk-1234567890abcdefghij")
    expect(openSecret(sealed, kek)).toBe("sk-1234567890abcdefghij")
    expect(redactSecrets("key is sk-1234567890abcdefghij").text).not.toContain("sk-1234567890abcdefghij")
  })

  it("db turn_mode enum values equal core TURN_MODES", () => {
    const dbModes = (schema.turnModeEnum as unknown as { enumValues: string[] }).enumValues
    expect([...dbModes].sort()).toEqual([...TURN_MODES].sort())
  })

  it("every db table name is snake_case (migration snapshot stability)", async () => {
    // Walk exported objects for drizzle table markers (Symbol(drizzle:Name)).
    let count = 0
    for (const v of Object.values(schema)) {
      if (!v || typeof v !== "object") continue
      for (const sym of Object.getOwnPropertySymbols(v as object)) {
        if (String(sym).includes("drizzle:Name")) {
          const name = (v as Record<symbol, unknown>)[sym]
          if (typeof name === "string") { expect(name).toMatch(/^[a-z_]+$/); count++ }
        }
      }
    }
    expect(count).toBeGreaterThan(15)
  })
})
