import { describe, expect, it } from "vitest"
import {
  lastCodexRateLimits,
  parseAntigravityQuota,
  parseClaudeUsage,
  parseCodexRateLimits,
  parseCopilotLimits,
  parseCursorUsage,
  parseOpenCodeQuota,
  parseOpenRouterQuota,
  parseZCodeQuota,
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
      {
        label: "5-hour",
        usedPercent: 38,
        resetsAt: "2026-11-14T03:00:00.000Z",
        windowMinutes: 300,
      },
      {
        label: "Weekly",
        usedPercent: 19.5,
        resetsAt: "2026-11-18T00:00:00.000Z",
        windowMinutes: 10080,
      },
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
      JSON.stringify({
        timestamp: "2026-11-12T01:00:00Z",
        payload: { type: "token_count", rate_limits: { primary: { used_percent: 1 } } },
      }),
      JSON.stringify({
        timestamp: "2026-11-12T02:00:00Z",
        payload: { type: "token_count", rate_limits: { primary: { used_percent: 5 } } },
      }),
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
      {
        label: "Gemini Pro · 5-hour",
        usedPercent: 24,
        resetsAt: "2026-11-14T05:30:00.000Z",
        windowMinutes: 300,
      },
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

describe("parseOpenRouterQuota", () => {
  it("reads key credit limit and usage", () => {
    const res = parseOpenRouterQuota({
      data: {
        label: "My Key",
        limit: 50,
        usage: 12.5,
        is_free_tier: false,
      },
    })
    expect(res.plan).toBe("Capped")
    expect(res.windows).toEqual([
      {
        label: "Credit Limit",
        usedPercent: 25,
        resetsAt: null,
        windowMinutes: null,
      },
    ])
  })

  it("reads total credits from credits endpoint", () => {
    const res = parseOpenRouterQuota(null, {
      data: {
        total_credits: 100,
        total_usage: 40,
      },
    })
    expect(res.plan).toBe("Credits")
    expect(res.windows).toEqual([
      {
        label: "Credits",
        usedPercent: 40,
        resetsAt: null,
        windowMinutes: null,
      },
    ])
  })
})

describe("parseOpenCodeQuota", () => {
  it("reads free tier quota", () => {
    const res = parseOpenCodeQuota({
      plan: "zen-free",
      free_tier: {
        usage: 250000,
        limit: 1000000,
        window_minutes: 300,
      },
    })
    expect(res.plan).toBe("zen-free")
    expect(res.windows).toEqual([
      {
        label: "5-hour",
        usedPercent: 25,
        resetsAt: null,
        windowMinutes: 300,
      },
    ])
  })

  it("reads structured windows array", () => {
    const res = parseOpenCodeQuota({
      data: {
        plan: "pro",
        windows: [{ label: "Daily", used_percent: 15, resets_at: "2026-11-23T00:00:00Z" }],
      },
    })
    expect(res.plan).toBe("pro")
    expect(res.windows).toEqual([
      {
        label: "Daily",
        usedPercent: 15,
        resetsAt: "2026-11-23T00:00:00.000Z",
        windowMinutes: null,
      },
    ])
  })
})

describe("parseCursorUsage", () => {
  it("reads fast requests from gpt4 quota", () => {
    const res = parseCursorUsage({
      plan: "pro",
      gpt4: {
        numRequests: 150,
        maxRequestUsage: 500,
        startOfMonth: "2026-11-01T00:00:00Z",
      },
    })
    expect(res.plan).toBe("pro")
    expect(res.windows).toEqual([
      {
        label: "Fast Requests",
        usedPercent: 30,
        resetsAt: "2026-12-01T00:00:00.000Z",
        windowMinutes: 43200,
      },
    ])
  })

  it("reads spend limits", () => {
    const res = parseCursorUsage({
      spend: {
        spendCents: 2000,
        limitCents: 10000,
      },
    })
    expect(res.windows).toEqual([
      {
        label: "Monthly Spend",
        usedPercent: 20,
        resetsAt: null,
        windowMinutes: 43200,
      },
    ])
  })
})

describe("parseCopilotLimits", () => {
  it("reads rate limit headers", () => {
    const res = parseCopilotLimits(
      { sku: "individual_monthly" },
      {
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "80",
        "x-ratelimit-reset": "1794623000",
      },
    )
    expect(res.plan).toBe("Individual Monthly")
    expect(res.windows).toEqual([
      {
        label: "Hourly Quota",
        usedPercent: 20,
        resetsAt: "2026-11-14T02:23:20.000Z",
        windowMinutes: 60,
      },
    ])
  })

  it("returns plan name with empty windows when no rate limit headers are present", () => {
    const res = parseCopilotLimits({ plan_type: "copilot_for_business" })
    expect(res.plan).toBe("Copilot For Business")
    expect(res.windows).toEqual([])
  })
})

describe("parseZCodeQuota", () => {
  it("reads Z.ai credit limit and refresh cycle", () => {
    const res = parseZCodeQuota({
      data: {
        plan: "GLM Coding Plan Pro",
        credit_limit: {
          used: 250,
          limit: 1000,
          refresh_cycle_minutes: 300,
          resets_at: "2026-11-22T16:00:00Z",
        },
      },
    })
    expect(res.plan).toBe("GLM Coding Plan Pro")
    expect(res.windows).toEqual([
      {
        label: "5-hour",
        usedPercent: 25,
        resetsAt: "2026-11-22T16:00:00.000Z",
        windowMinutes: 300,
      },
    ])
  })

  it("reads multi-window structure", () => {
    const res = parseZCodeQuota({
      windows: [
        { label: "5-hour", used_percent: 10 },
        { label: "Weekly", used_percent: 45 },
      ],
    })
    expect(res.windows).toEqual([
      { label: "5-hour", usedPercent: 10, resetsAt: null, windowMinutes: null },
      { label: "Weekly", usedPercent: 45, resetsAt: null, windowMinutes: null },
    ])
  })
})
