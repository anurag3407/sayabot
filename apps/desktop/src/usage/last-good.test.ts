import { describe, expect, it } from "vitest"
import type { PlanLimits } from "@sayabot/core/scanner"
import { withLastGood } from "./index"

const NOW = Date.parse("2026-11-15T12:00:00Z")

function claude(used: number | null, observedAt = NOW): PlanLimits {
  return {
    provider: "claude",
    label: "Claude",
    plan: "max",
    windows:
      used === null
        ? []
        : [{ label: "5-hour", usedPercent: used, resetsAt: null, windowMinutes: 300 }],
    observedAt: new Date(observedAt).toISOString(),
    error: used === null ? "Claude is busy. Showing the last reading." : null,
  }
}

function makeReading(
  provider: PlanLimits["provider"],
  label: string,
  used: number | null,
  observedAt = NOW,
): PlanLimits {
  return {
    provider,
    label,
    plan: "pro",
    windows:
      used === null
        ? []
        : [{ label: "5-hour", usedPercent: used, resetsAt: null, windowMinutes: 300 }],
    observedAt: new Date(observedAt).toISOString(),
    error: used === null ? "Busy. Showing last reading." : null,
  }
}

describe("withLastGood", () => {
  it("shows the last good reading when Claude is rate-limited", () => {
    withLastGood(claude(30, NOW - 60_000), NOW - 60_000)
    const shown = withLastGood(claude(null), NOW)
    expect(shown.windows[0]?.usedPercent).toBe(30)
  })

  it("lets a reading older than half a day go", () => {
    withLastGood(claude(30, NOW - 13 * 60 * 60_000), NOW - 13 * 60 * 60_000)
    expect(withLastGood(claude(null), NOW).windows).toHaveLength(0)
  })

  it("tracks OpenCode, Pi, Cursor, Copilot and ZCode independently without crosstalk", () => {
    withLastGood(makeReading("opencode", "OpenCode", 45, NOW - 1000), NOW - 1000)
    withLastGood(makeReading("pi", "pi", 12, NOW - 1000), NOW - 1000)
    withLastGood(makeReading("cursor", "Cursor", 80, NOW - 1000), NOW - 1000)
    withLastGood(makeReading("copilot", "Copilot", 25, NOW - 1000), NOW - 1000)
    withLastGood(makeReading("zcode", "ZCode", 60, NOW - 1000), NOW - 1000)

    expect(withLastGood(makeReading("opencode", "OpenCode", null), NOW).windows[0]?.usedPercent).toBe(45)
    expect(withLastGood(makeReading("pi", "pi", null), NOW).windows[0]?.usedPercent).toBe(12)
    expect(withLastGood(makeReading("cursor", "Cursor", null), NOW).windows[0]?.usedPercent).toBe(80)
    expect(withLastGood(makeReading("copilot", "Copilot", null), NOW).windows[0]?.usedPercent).toBe(25)
    expect(withLastGood(makeReading("zcode", "ZCode", null), NOW).windows[0]?.usedPercent).toBe(60)
  })
})
