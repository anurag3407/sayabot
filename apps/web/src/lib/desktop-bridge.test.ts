import { describe, expect, it } from "vitest"
import { canReadPlanLimits, readPlanLimits, resetsIn } from "./desktop-bridge"

describe("resetsIn", () => {
  const now = Date.parse("2026-11-14T00:00:00Z")
  it.each([
    ["2026-11-14T00:00:30Z", "soon"],
    ["2026-11-14T00:45:00Z", "in 45m"],
    ["2026-11-14T02:14:00Z", "in 2h 14m"],
    ["2026-11-17T00:00:00Z", "in 3 days"],
  ])("%s → %s", (iso, expected) => {
    expect(resetsIn(iso, now)).toBe(expected)
  })
  it("says nothing without a time", () => {
    expect(resetsIn(null, now)).toBeNull()
  })
})

describe("outside the Mac app", () => {
  it("reports no bridge instead of failing", async () => {
    expect(canReadPlanLimits()).toBe(false)
    expect(await readPlanLimits()).toBeNull()
  })
})
