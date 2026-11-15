import { describe, expect, it } from "vitest"
import type { PlanLimits } from "@sayabot/core/scanner"
import { mergePlanLimits, STALE_READING_MS } from "@/lib/plan-limits-store"

const NOW = Date.parse("2026-11-15T12:00:00Z")

function reading(
  provider: PlanLimits["provider"],
  used: number | null,
  observedAt = NOW,
): PlanLimits {
  return {
    provider,
    label: provider,
    plan: null,
    windows:
      used === null
        ? []
        : [{ label: "5-hour", usedPercent: used, resetsAt: null, windowMinutes: 300 }],
    observedAt: new Date(observedAt).toISOString(),
    error: used === null ? "Claude didn't answer (error 429)." : null,
  }
}

describe("mergePlanLimits", () => {
  it("takes a fresh good reading", () => {
    const merged = mergePlanLimits([reading("claude", 10)], [reading("claude", 40)], NOW)
    expect(merged[0]?.windows[0]?.usedPercent).toBe(40)
  })

  it("keeps the last good reading when a provider fails", () => {
    const merged = mergePlanLimits(
      [reading("claude", 10, NOW - 60_000)],
      [reading("claude", null)],
      NOW,
    )
    expect(merged[0]?.windows).toHaveLength(1)
    expect(merged[0]?.error).toBeNull()
  })

  it("ignores an empty read (the app could not be asked)", () => {
    const previous = [reading("claude", 10), reading("codex", 20)]
    expect(mergePlanLimits(previous, [], NOW)).toBe(previous)
  })

  it("lets a very old reading go", () => {
    const merged = mergePlanLimits(
      [reading("claude", 10, NOW - STALE_READING_MS - 1)],
      [reading("claude", null)],
      NOW,
    )
    expect(merged[0]?.windows).toHaveLength(0)
  })

  it("shows a failure when there was never a good reading", () => {
    const merged = mergePlanLimits(null, [reading("claude", null)], NOW)
    expect(merged[0]?.error).toContain("429")
  })
})
