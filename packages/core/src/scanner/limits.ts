import type { ProviderLimitGroup, ScannedUsageRecord } from "./types"


function formatDurationRemaining(ms: number): string {
  if (ms <= 0) return "Resetting now"
  const totalMins = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  const days = Math.floor(hours / 24)

  if (days > 0) {
    const remHours = hours % 24
    return `Resets in ${days}d ${remHours}h`
  }
  if (hours > 0) {
    return `Resets in ${hours}h ${mins}m`
  }
  return `Resets in ${mins}m`
}

/** Computes local subscription limits and pooled rolling windows from recent usage records */
export function estimateLocalLimits(
  records: ScannedUsageRecord[],
): ProviderLimitGroup[] {
  const now = Date.now()
  const fiveHoursMs = 5 * 3600 * 1000
  const sevenDaysMs = 7 * 86400 * 1000

  // Filter records by provider
  const antigravityRecs = records.filter((r) => r.provider === "antigravity")
  const claudeRecs = records.filter((r) => r.provider === "claude")
  const codexRecs = records.filter((r) => r.provider === "codex")

  const groups: ProviderLimitGroup[] = []

  // 1. Antigravity Limits
  if (antigravityRecs.length > 0) {
    const recent5h = antigravityRecs.filter((r) => r.timestampMs >= now - fiveHoursMs)
    const recent7d = antigravityRecs.filter((r) => r.timestampMs >= now - sevenDaysMs)

    const tokens5h = recent5h.reduce(
      (sum, r) =>
        sum +
        r.totals.uncachedInputTokens +
        r.totals.cachedInputTokens +
        r.totals.outputTokens,
      0,
    )
    const tokens7d = recent7d.reduce(
      (sum, r) =>
        sum +
        r.totals.uncachedInputTokens +
        r.totals.cachedInputTokens +
        r.totals.outputTokens,
      0,
    )

    // Benchmark tier allowance: 250k tokens per 5h window, 5M per week
    const cap5h = 250_000
    const cap7d = 5_000_000
    const used5h = Math.min(100, Math.round((tokens5h / cap5h) * 100))
    const used7d = Math.min(100, Math.round((tokens7d / cap7d) * 100))

    // Oldest record in 5h window determines reset time
    const oldest5h = recent5h.length > 0 ? Math.min(...recent5h.map((r) => r.timestampMs)) : now
    const resetTime5h = new Date(oldest5h + fiveHoursMs)
    const msUntilReset5h = Math.max(0, resetTime5h.getTime() - now)

    // Weekly reset aligns to Sunday midnight
    const resetTime7d = new Date()
    resetTime7d.setUTCDate(resetTime7d.getUTCDate() + (7 - resetTime7d.getUTCDay()))
    resetTime7d.setUTCHours(0, 0, 0, 0)
    const msUntilReset7d = Math.max(0, resetTime7d.getTime() - now)

    const elapsedFrac5h = 1 - msUntilReset5h / fiveHoursMs
    const expectedUsedFrac5h = elapsedFrac5h * 100
    const pace5h: "ahead" | "on" | "under" =
      used5h > expectedUsedFrac5h + 15 ? "ahead" : used5h < expectedUsedFrac5h - 15 ? "under" : "on"

    groups.push({
      provider: "antigravity",
      label: "Antigravity",
      color: "#6366f1",
      plan: "Google CloudCode Pro",
      accountName: "Personal (Gemini 3.8 & Claude 4.5)",
      lastChecked: new Date().toISOString(),
      windows: [
        {
          id: "ag-5h",
          label: "5-Hour Session Window",
          kind: "session",
          usedPercent: used5h,
          remainingPercent: 100 - used5h,
          resetsAt: resetTime5h.toISOString(),
          windowDurationMins: 300,
          resetsInText: formatDurationRemaining(msUntilReset5h),
          pace: pace5h,
          paceRemainingPercent: Math.max(0, 100 - used5h),
        },
        {
          id: "ag-weekly",
          label: "Weekly Quota Allowance",
          kind: "weekly",
          usedPercent: used7d,
          remainingPercent: 100 - used7d,
          resetsAt: resetTime7d.toISOString(),
          windowDurationMins: 10080,
          resetsInText: formatDurationRemaining(msUntilReset7d),
          pace: used7d > 50 ? "ahead" : "under",
          paceRemainingPercent: Math.max(0, 100 - used7d),
        },
      ],
    })
  }

  // 2. Claude Code Limits
  if (claudeRecs.length > 0) {
    const recent5h = claudeRecs.filter((r) => r.timestampMs >= now - fiveHoursMs)
    const recent7d = claudeRecs.filter((r) => r.timestampMs >= now - sevenDaysMs)

    const tokens5h = recent5h.reduce(
      (sum, r) =>
        sum +
        r.totals.uncachedInputTokens +
        r.totals.cachedInputTokens +
        r.totals.outputTokens,
      0,
    )
    const tokens7d = recent7d.reduce(
      (sum, r) =>
        sum +
        r.totals.uncachedInputTokens +
        r.totals.cachedInputTokens +
        r.totals.outputTokens,
      0,
    )

    const cap5h = 300_000
    const cap7d = 6_000_000
    const used5h = Math.min(100, Math.round((tokens5h / cap5h) * 100))
    const used7d = Math.min(100, Math.round((tokens7d / cap7d) * 100))

    const oldest5h = recent5h.length > 0 ? Math.min(...recent5h.map((r) => r.timestampMs)) : now
    const resetTime5h = new Date(oldest5h + fiveHoursMs)
    const msUntilReset5h = Math.max(0, resetTime5h.getTime() - now)

    const resetTime7d = new Date()
    resetTime7d.setUTCDate(resetTime7d.getUTCDate() + (7 - resetTime7d.getUTCDay()))
    resetTime7d.setUTCHours(0, 0, 0, 0)
    const msUntilReset7d = Math.max(0, resetTime7d.getTime() - now)

    groups.push({
      provider: "claude",
      label: "Claude Code",
      color: "#d97706",
      plan: "Anthropic Max Tier",
      accountName: "Claude Code CLI",
      lastChecked: new Date().toISOString(),
      windows: [
        {
          id: "claude-5h",
          label: "5-Hour Sliding Window",
          kind: "session",
          usedPercent: used5h,
          remainingPercent: 100 - used5h,
          resetsAt: resetTime5h.toISOString(),
          windowDurationMins: 300,
          resetsInText: formatDurationRemaining(msUntilReset5h),
          pace: used5h > 60 ? "ahead" : "under",
          paceRemainingPercent: Math.max(0, 100 - used5h),
        },
        {
          id: "claude-weekly",
          label: "Weekly Pool Window",
          kind: "weekly",
          usedPercent: used7d,
          remainingPercent: 100 - used7d,
          resetsAt: resetTime7d.toISOString(),
          windowDurationMins: 10080,
          resetsInText: formatDurationRemaining(msUntilReset7d),
          pace: used7d > 50 ? "ahead" : "on",
          paceRemainingPercent: Math.max(0, 100 - used7d),
        },
      ],
    })
  }

  // 3. Codex Limits
  if (codexRecs.length > 0) {
    const recent7d = codexRecs.filter((r) => r.timestampMs >= now - sevenDaysMs)
    const tokens7d = recent7d.reduce(
      (sum, r) =>
        sum +
        r.totals.uncachedInputTokens +
        r.totals.cachedInputTokens +
        r.totals.outputTokens,
      0,
    )
    const used7d = Math.min(100, Math.round((tokens7d / 10_000_000) * 100))

    const resetTime7d = new Date()
    resetTime7d.setUTCDate(resetTime7d.getUTCDate() + (7 - resetTime7d.getUTCDay()))
    resetTime7d.setUTCHours(0, 0, 0, 0)
    const msUntilReset7d = Math.max(0, resetTime7d.getTime() - now)

    groups.push({
      provider: "codex",
      label: "Codex",
      color: "#10a37f",
      plan: "OpenAI Codex Subscription",
      accountName: "Codex CLI",
      lastChecked: new Date().toISOString(),
      windows: [
        {
          id: "codex-weekly",
          label: "Weekly Subscription Allowance",
          kind: "weekly",
          usedPercent: used7d,
          remainingPercent: 100 - used7d,
          resetsAt: resetTime7d.toISOString(),
          windowDurationMins: 10080,
          resetsInText: formatDurationRemaining(msUntilReset7d),
          pace: "under",
          paceRemainingPercent: Math.max(0, 100 - used7d),
        },
      ],
    })
  }

  return groups
}
