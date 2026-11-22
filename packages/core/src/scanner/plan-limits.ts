/**
 * Plan limits ("how much of my Claude / Codex / Antigravity allowance is left"), as each tool's
 * own service reports them. Pure parsers only: the reading (Keychain, files, network) lives in
 * the Mac app, so sign-in tokens never leave it. Every value here comes from the provider; when a
 * reading is missing the window is left out rather than guessed.
 */

export type PlanProvider =
  | "claude"
  | "codex"
  | "antigravity"
  | "opencode"
  | "pi"
  | "cursor"
  | "copilot"
  | "zcode"

export interface PlanWindow {
  /** "5-hour", "Weekly", "Weekly · Opus", "Gemini Pro · 5-hour" */
  label: string
  /** 0-100, as the provider reported it. */
  usedPercent: number
  /** ISO time the window resets, if known. */
  resetsAt: string | null
  windowMinutes: number | null
}

export interface PlanLimits {
  provider: PlanProvider
  label: string
  /** "max", "pro", "plus"… when the provider says. */
  plan: string | null
  windows: PlanWindow[]
  /** When this reading was taken (or, for Codex, when Codex last saw it). */
  observedAt: string
  /** Why there is no reading, in plain words. */
  error: string | null
}

const clampPercent = (value: number) => Math.max(0, Math.min(100, value))

export function windowLabel(minutes: number | null | undefined): string {
  if (!minutes || minutes <= 0) return "Limit"
  if (minutes === 300) return "5-hour"
  if (minutes === 10_080) return "Weekly"
  if (minutes >= 40_000 && minutes <= 45_000) return "Monthly"
  if (minutes % 1440 === 0) return `${minutes / 1440}-day`
  if (minutes % 60 === 0) return `${minutes / 60}-hour`
  return `${minutes}-minute`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isoOrNull(value: unknown): string | null {
  if (typeof value === "string") {
    const time = Date.parse(value)
    return Number.isFinite(time) ? new Date(time).toISOString() : null
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    // Seconds or milliseconds since the epoch.
    return new Date(value < 1e12 ? value * 1000 : value).toISOString()
  }
  return null
}

/**
 * Anthropic's plan usage answer (what Claude Code's /usage shows):
 * `{ five_hour: { utilization: 0-100, resets_at }, seven_day: {...}, seven_day_opus: {...} }`.
 */
export function parseClaudeUsage(answer: unknown): PlanWindow[] {
  if (!isRecord(answer)) return []
  const slots: Array<[string, string, number]> = [
    ["five_hour", "5-hour", 300],
    ["seven_day", "Weekly", 10_080],
    ["seven_day_opus", "Weekly · Opus", 10_080],
    ["seven_day_sonnet", "Weekly · Sonnet", 10_080],
  ]
  const windows: PlanWindow[] = []
  for (const [key, label, minutes] of slots) {
    const slot = answer[key]
    if (!isRecord(slot) || typeof slot.utilization !== "number") continue
    windows.push({
      label,
      usedPercent: clampPercent(slot.utilization),
      resetsAt: isoOrNull(slot.resets_at),
      windowMinutes: minutes,
    })
  }
  return windows
}

/**
 * The `rate_limits` object Codex writes into its session logs with every token count:
 * `{ primary: { used_percent, window_minutes, resets_at }, secondary: {...}, plan_type }`.
 * A window whose reset time has passed since Codex wrote it is reported as fresh (0% used).
 */
export function parseCodexRateLimits(
  rateLimits: unknown,
  now = Date.now(),
): { windows: PlanWindow[]; plan: string | null } {
  if (!isRecord(rateLimits)) return { windows: [], plan: null }
  const windows: PlanWindow[] = []
  for (const key of ["primary", "secondary"] as const) {
    const slot = rateLimits[key]
    if (!isRecord(slot) || typeof slot.used_percent !== "number") continue
    const minutes = typeof slot.window_minutes === "number" ? slot.window_minutes : null
    const resetsAt = isoOrNull(slot.resets_at)
    const elapsed = resetsAt !== null && Date.parse(resetsAt) <= now
    windows.push({
      label: windowLabel(minutes),
      usedPercent: elapsed ? 0 : clampPercent(slot.used_percent),
      resetsAt: elapsed ? null : resetsAt,
      windowMinutes: minutes,
    })
  }
  const plan = typeof rateLimits.plan_type === "string" ? rateLimits.plan_type : null
  return { windows, plan }
}

/** Finds the newest Codex `rate_limits` in a chunk of session log lines (newest last). */
export function lastCodexRateLimits(
  logText: string,
): { rateLimits: Record<string, unknown>; observedAt: string | null } | null {
  const lines = logText.split("\n")
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index]
    if (!line || !line.includes('"rate_limits"')) continue
    try {
      const entry = JSON.parse(line) as Record<string, unknown>
      const payload = isRecord(entry.payload) ? entry.payload : null
      const rateLimits = payload && isRecord(payload.rate_limits) ? payload.rate_limits : null
      if (rateLimits && (isRecord(rateLimits.primary) || isRecord(rateLimits.secondary))) {
        return { rateLimits, observedAt: isoOrNull(entry.timestamp) }
      }
    } catch {
      // A line cut off at the start of the chunk, or one still being written.
    }
  }
  return null
}

/**
 * Google Code Assist's `retrieveUserQuotaSummary` answer, which Antigravity meters against:
 * `{ groups: [{ displayName, buckets: [{ window, displayName, resetTime, remainingFraction }] }] }`.
 */
export function parseAntigravityQuota(answer: unknown): PlanWindow[] {
  if (!isRecord(answer) || !Array.isArray(answer.groups)) return []
  const windows: PlanWindow[] = []
  for (const group of answer.groups) {
    if (!isRecord(group) || !Array.isArray(group.buckets)) continue
    const groupName = typeof group.displayName === "string" ? group.displayName.trim() : ""
    for (const bucket of group.buckets) {
      if (!isRecord(bucket) || typeof bucket.remainingFraction !== "number") continue
      const text = `${bucket.window ?? ""} ${bucket.displayName ?? ""}`
      const minutes = /week/i.test(text) ? 10_080 : /5\s*-?\s*h|five/i.test(text) ? 300 : null
      const windowName =
        minutes !== null
          ? windowLabel(minutes)
          : typeof bucket.displayName === "string" && bucket.displayName.trim()
            ? bucket.displayName.trim()
            : "Limit"
      windows.push({
        label: groupName ? `${groupName} · ${windowName}` : windowName,
        usedPercent: clampPercent(100 - bucket.remainingFraction * 100),
        resetsAt: isoOrNull(bucket.resetTime),
        windowMinutes: minutes,
      })
    }
  }
  return windows
}

/**
 * OpenRouter quota & credit balance parser (used by Pi, OpenCode, and BYOK setups):
 * Reads API key balance/usage and credit limits.
 */
export function parseOpenRouterQuota(
  keyData: unknown,
  creditsData?: unknown,
): { windows: PlanWindow[]; plan: string | null } {
  const windows: PlanWindow[] = []
  let plan: string | null = null

  if (isRecord(keyData)) {
    const data = isRecord(keyData.data) ? keyData.data : keyData
    const usage = typeof data.usage === "number" ? data.usage : null
    const limit = typeof data.limit === "number" ? data.limit : null
    const isFree = data.is_free_tier === true
    plan = isFree ? "Free Tier" : limit ? "Capped" : "Pay-as-you-go"

    if (limit !== null && limit > 0 && usage !== null) {
      windows.push({
        label: "Credit Limit",
        usedPercent: clampPercent((usage / limit) * 100),
        resetsAt: null,
        windowMinutes: null,
      })
    }
  }

  if (!windows.length && isRecord(creditsData)) {
    const data = isRecord(creditsData.data) ? creditsData.data : creditsData
    const totalCredits = typeof data.total_credits === "number" ? data.total_credits : null
    const totalUsage = typeof data.total_usage === "number" ? data.total_usage : null
    if (totalCredits !== null && totalCredits > 0 && totalUsage !== null) {
      windows.push({
        label: "Credits",
        usedPercent: clampPercent((totalUsage / totalCredits) * 100),
        resetsAt: null,
        windowMinutes: null,
      })
      if (!plan) plan = "Credits"
    }
  }

  if (!windows.length && isRecord(keyData)) {
    const data = isRecord(keyData.data) ? keyData.data : keyData
    if (typeof data.usage === "number") {
      windows.push({
        label: "Usage",
        usedPercent: 0,
        resetsAt: null,
        windowMinutes: null,
      })
    }
  }

  return { windows, plan }
}

/**
 * OpenCode quota parser: handles free-tier, Zen rate limits, and credit limits.
 */
export function parseOpenCodeQuota(answer: unknown): { windows: PlanWindow[]; plan: string | null } {
  if (!isRecord(answer)) return { windows: [], plan: null }
  const data = isRecord(answer.data) ? answer.data : answer
  const windows: PlanWindow[] = []
  const plan =
    typeof data.plan === "string" ? data.plan : typeof data.tier === "string" ? data.tier : null

  if (Array.isArray(data.windows)) {
    for (const win of data.windows) {
      if (!isRecord(win) || typeof win.used_percent !== "number") continue
      const minutes = typeof win.window_minutes === "number" ? win.window_minutes : null
      windows.push({
        label: typeof win.label === "string" ? win.label : windowLabel(minutes),
        usedPercent: clampPercent(win.used_percent),
        resetsAt: isoOrNull(win.resets_at),
        windowMinutes: minutes,
      })
    }
  }

  if (!windows.length) {
    const freeTier = isRecord(data.free_tier) ? data.free_tier : isRecord(data.quota) ? data.quota : null
    if (freeTier) {
      const used =
        typeof freeTier.used_percent === "number"
          ? freeTier.used_percent
          : typeof freeTier.usage === "number" && typeof freeTier.limit === "number" && freeTier.limit > 0
            ? (freeTier.usage / freeTier.limit) * 100
            : null
      if (used !== null) {
        const minutes = typeof freeTier.window_minutes === "number" ? freeTier.window_minutes : 300
        windows.push({
          label: typeof freeTier.label === "string" ? freeTier.label : windowLabel(minutes),
          usedPercent: clampPercent(used),
          resetsAt: isoOrNull(freeTier.resets_at),
          windowMinutes: minutes,
        })
      }
    }
  }

  if (!windows.length && isRecord(data.credits)) {
    const balance = typeof data.credits.balance === "number" ? data.credits.balance : null
    const usage = typeof data.credits.usage === "number" ? data.credits.usage : null
    if (balance !== null && usage !== null && balance + usage > 0) {
      windows.push({
        label: "Credits",
        usedPercent: clampPercent((usage / (balance + usage)) * 100),
        resetsAt: null,
        windowMinutes: null,
      })
    }
  }

  return { windows, plan }
}

/**
 * Cursor usage parser: parses fast request allowances and spend limits.
 */
export function parseCursorUsage(answer: unknown): { windows: PlanWindow[]; plan: string | null } {
  if (!isRecord(answer)) return { windows: [], plan: null }
  const data = isRecord(answer.data) ? answer.data : answer
  const windows: PlanWindow[] = []
  const plan =
    typeof data.plan === "string"
      ? data.plan
      : typeof data.membershipType === "string"
        ? data.membershipType
        : null

  const gpt4 = isRecord(data.gpt4) ? data.gpt4 : isRecord(data["fast_requests"]) ? data["fast_requests"] : null
  if (gpt4) {
    const used =
      typeof gpt4.numRequests === "number"
        ? gpt4.numRequests
        : typeof gpt4.used === "number"
          ? gpt4.used
          : null
    const limit =
      typeof gpt4.maxRequestUsage === "number"
        ? gpt4.maxRequestUsage
        : typeof gpt4.limit === "number"
          ? gpt4.limit
          : null
    if (used !== null && limit !== null && limit > 0) {
      let resetsAt: string | null = null
      if (gpt4.resets_at) {
        resetsAt = isoOrNull(gpt4.resets_at)
      } else if (gpt4.startOfMonth) {
        const d = new Date(
          typeof gpt4.startOfMonth === "number"
            ? (gpt4.startOfMonth < 1e12 ? gpt4.startOfMonth * 1000 : gpt4.startOfMonth)
            : String(gpt4.startOfMonth),
        )
        if (!Number.isNaN(d.getTime())) {
          d.setUTCMonth(d.getUTCMonth() + 1)
          resetsAt = d.toISOString()
        }
      }
      windows.push({
        label: "Fast Requests",
        usedPercent: clampPercent((used / limit) * 100),
        resetsAt,
        windowMinutes: 43200,
      })
    }
  }

  const spend = isRecord(data.spend) ? data.spend : data
  if (
    typeof spend.spendCents === "number" &&
    typeof spend.limitCents === "number" &&
    spend.limitCents > 0
  ) {
    windows.push({
      label: "Monthly Spend",
      usedPercent: clampPercent((spend.spendCents / spend.limitCents) * 100),
      resetsAt: isoOrNull(spend.resetsAt),
      windowMinutes: 43200,
    })
  }

  return { windows, plan }
}

/**
 * GitHub Copilot limits parser: reads plan SKU and rate-limit headers.
 */
export function parseCopilotLimits(
  answer: unknown,
  headers?: Record<string, string | null | undefined>,
): { windows: PlanWindow[]; plan: string | null } {
  const windows: PlanWindow[] = []
  let plan: string | null = null

  if (isRecord(answer)) {
    const sku =
      typeof answer.sku === "string"
        ? answer.sku
        : typeof answer.plan_type === "string"
          ? answer.plan_type
          : null
    if (sku) {
      plan = sku.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    }
  }

  if (headers) {
    const limitStr = headers["x-ratelimit-limit"]
    const remStr = headers["x-ratelimit-remaining"]
    const resetStr = headers["x-ratelimit-reset"]
    const limit = limitStr ? Number(limitStr) : NaN
    const remaining = remStr ? Number(remStr) : NaN
    if (Number.isFinite(limit) && Number.isFinite(remaining) && limit > 0) {
      const usedPercent = clampPercent(((limit - remaining) / limit) * 100)
      const resetsAt = resetStr ? isoOrNull(Number(resetStr)) : null
      windows.push({
        label: "Hourly Quota",
        usedPercent,
        resetsAt,
        windowMinutes: 60,
      })
    }
  }

  return { windows, plan }
}

/**
 * ZCode quota parser (Z.ai / GLM Coding Plan): reads 5-hour and 7-day credit quota windows.
 */
export function parseZCodeQuota(answer: unknown): { windows: PlanWindow[]; plan: string | null } {
  if (!isRecord(answer)) return { windows: [], plan: null }
  const data = isRecord(answer.data) ? answer.data : answer
  const windows: PlanWindow[] = []
  const plan =
    typeof data.plan === "string" ? data.plan : typeof data.package === "string" ? data.package : null

  if (Array.isArray(data.windows)) {
    for (const win of data.windows) {
      if (!isRecord(win) || typeof win.used_percent !== "number") continue
      const minutes = typeof win.window_minutes === "number" ? win.window_minutes : null
      windows.push({
        label: typeof win.label === "string" ? win.label : windowLabel(minutes),
        usedPercent: clampPercent(win.used_percent),
        resetsAt: isoOrNull(win.resets_at),
        windowMinutes: minutes,
      })
    }
  }

  if (!windows.length) {
    const limitObj = isRecord(data.credit_limit) ? data.credit_limit : isRecord(data.quota) ? data.quota : null
    if (limitObj) {
      const used =
        typeof limitObj.used_percent === "number"
          ? limitObj.used_percent
          : typeof limitObj.used === "number" && typeof limitObj.limit === "number" && limitObj.limit > 0
            ? (limitObj.used / limitObj.limit) * 100
            : null
      if (used !== null) {
        const minutes =
          typeof limitObj.refresh_cycle_minutes === "number" ? limitObj.refresh_cycle_minutes : 300
        windows.push({
          label: windowLabel(minutes),
          usedPercent: clampPercent(used),
          resetsAt: isoOrNull(limitObj.resets_at),
          windowMinutes: minutes,
        })
      }
    }
  }

  return { windows, plan }
}
