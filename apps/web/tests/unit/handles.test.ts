import { describe, expect, it } from "vitest"
import { handleFromName } from "../../src/lib/agent-handle"
import { humanHandle, humanMention } from "../../src/lib/human-handle"

describe("handleFromName (agents)", () => {
  it("slugifies, strips accents, starts with a letter, caps at 39", () => {
    expect(handleFromName("Code Reviewer!")).toBe("code-reviewer")
    expect(handleFromName("Ecrivain 2")).toBe("ecrivain-2")
    expect(handleFromName("3D Artist")).toBe("d-artist")
    expect(handleFromName("123")).toBe("")
    expect(handleFromName("a".repeat(80)).length).toBeLessThanOrEqual(39)
    expect(handleFromName("a".repeat(80))).not.toMatch(/-$/)
  })
})

describe("humanHandle / humanMention", () => {
  it("normalizes to a mention-safe slug capped at 38", () => {
    expect(humanHandle("  Priya Sharma ")).toBe("priya-sharma")
    expect(humanHandle("José García")).toBe("jose-garcia")
    expect(humanHandle("a".repeat(60)).length).toBeLessThanOrEqual(38)
    expect(humanMention("Ada Lovelace")).toBe("@ada-lovelace")
  })
  it("agent and human handles agree on the same name", () => {
    expect(handleFromName("Ada Lovelace")).toBe(humanHandle("Ada Lovelace"))
  })
})
