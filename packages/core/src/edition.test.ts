import { describe, expect, it } from "vitest"
import {
  checkLimit,
  effectivePlan,
  limitMessage,
  readEdition,
  upgradeFor,
  usageMonth,
} from "./edition"

describe("edition", () => {
  it("is self-hosted unless explicitly cloud", () => {
    expect(readEdition({})).toBe("self-hosted")
    expect(readEdition({ SAYABOT_EDITION: "Cloud " })).toBe("cloud")
    expect(readEdition({ SAYABOT_EDITION: "enterprise" })).toBe("self-hosted")
  })

  it("self-hosted servers never hit a limit", () => {
    expect(checkLimit("self-hosted", "free", "agents", 10_000)).toEqual({
      allowed: true,
      used: 10_000,
      limit: null,
    })
  })

  it("cloud plans enforce their limits", () => {
    expect(checkLimit("cloud", "free", "agents", 2).allowed).toBe(true)
    expect(checkLimit("cloud", "free", "agents", 3)).toEqual({ allowed: false, used: 3, limit: 3 })
    expect(checkLimit("cloud", "team", "agents", 500).allowed).toBe(true)
  })

  it("a lapsed subscription falls back to Free", () => {
    expect(effectivePlan("pro", "active")).toBe("pro")
    expect(effectivePlan("pro", "past_due")).toBe("pro")
    expect(effectivePlan("pro", "canceled")).toBe("free")
    expect(effectivePlan(null, null)).toBe("free")
  })

  it("suggests the smallest plan that fits", () => {
    expect(upgradeFor("free", "agents", 4)).toBe("pro")
    expect(upgradeFor("free", "agents", 25)).toBe("team")
    expect(upgradeFor("team", "members", 51)).toBeNull()
  })

  it("speaks plainly", () => {
    expect(usageMonth(new Date("2026-11-14T10:00:00Z"))).toBe("2026-11")
    expect(limitMessage("serverTurnsPerMonth", "free", 300)).toContain("300 server replies")
    expect(limitMessage("computers", "free", 0)).toBe("Agent computers are part of the paid plans.")
  })
})
