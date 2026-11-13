import { describe, expect, it } from "vitest"
import {
  lastCodexRateLimits,
  parseAntigravityQuota,
  parseClaudeUsage,
  parseCodexRateLimits,
  windowLabel,
} from "./plan-limits"

describe("parseClaudeUsage", () => {
  it("reads the 5-hour and weekly windows", () => {
    const windows = parseClaudeUsage({
      five_hour: { utilization: 38, resets_at: "2026-11-14T03:00:00Z" },
      seven_day: { utilization: 19.5, resets_at: "2026-11-18T00:00:00Z" },
      seven_day_opus: null,
      extra_usage: { is_enabled: false },
    })
    expect(windows).toEqual([
      { label: "5-hour", usedPercent: 38, resetsAt: "2026-11-14T03:00:00.000Z", windowMinutes: 300 },
      { label: "Weekly", usedPercent: 19.5, resetsAt: "2026-11-18T00:00:00.000Z", windowMinutes: 10080 },
    ])
  })

  it("returns nothing for an answer it does not recognise", () => {
    expect(parseClaudeUsage(null)).toEqual([])
    expect(parseClaudeUsage({ five_hour: { utilization: "lots" } })).toEqual([])
  })
})

describe("parseCodexRateLimits", () => {
  const now = Date.parse("2026-11-14T00:00:00Z")

  it("reads the windows Codex logged", () => {
    const result = parseCodexRateLimits(
      {
        primary: { used_percent: 12, window_minutes: 300, resets_at: 1_794_623_000 },
        secondary: { used_percent: 31, window_minutes: 10080, resets_at: 1_794_900_000 },
        plan_type: "plus",
      },
      now,
    )
    expect(result.plan).toBe("plus")
    expect(result.windows.map((w) => [w.label, w.usedPercent])).toEqual([
      ["5-hour", 12],
      ["Weekly", 31],
    ])
  })

  it("treats a window that has reset since Codex logged it as fresh", () => {
    const result = parseCodexRateLimits(
      { primary: { used_percent: 90, window_minutes: 300, resets_at: 1_700_000_000 } },
      now,
    )
    expect(result.windows[0]).toMatchObject({ usedPercent: 0, resetsAt: null })
  })
})

describe("lastCodexRateLimits", () => {
  it("finds the newest reading and skips broken lines", () => {
    const log = [
      JSON.stringify({ timestamp: "2026-11-12T01:00:00Z", payload: { type: "token_count", rate_limits: { primary: { used_percent: 1 } } } }),
      JSON.stringify({ timestamp: "2026-11-12T02:00:00Z", payload: { type: "token_count", rate_limits: { primary: { used_percent: 5 } } } }),
      '{"timestamp":"2026-11-12T03:00:00Z","payload":{"rate_limits":{"prim',
    ].join("\n")
    const found = lastCodexRateLimits(log)
    expect(found?.observedAt).toBe("2026-11-12T02:00:00.000Z")
    expect((found?.rateLimits.primary as { used_percent: number }).used_percent).toBe(5)
  })

  it("ignores logs with no limits", () => {
    expect(lastCodexRateLimits('{"payload":{"rate_limits":null}}')).toBeNull()
  })
})

describe("parseAntigravityQuota", () => {
  it("turns remaining fractions into used percentages per group", () => {
    const windows = parseAntigravityQuota({
      groups: [
        {
          displayName: "Gemini Pro",
          buckets: [
            { window: "5h", remainingFraction: 0.76, resetTime: "2026-11-14T05:30:00Z" },
            { window: "weekly", remainingFraction: 0.5 },
          ],
        },
      ],
    })
    expect(windows).toEqual([
      { label: "Gemini Pro · 5-hour", usedPercent: 24, resetsAt: "2026-11-14T05:30:00.000Z", windowMinutes: 300 },
      { label: "Gemini Pro · Weekly", usedPercent: 50, resetsAt: null, windowMinutes: 10080 },
    ])
  })
})

describe("windowLabel", () => {
  it("names common windows", () => {
    expect(windowLabel(300)).toBe("5-hour")
    expect(windowLabel(10080)).toBe("Weekly")
    expect(windowLabel(43200)).toBe("Monthly")
  })
})
