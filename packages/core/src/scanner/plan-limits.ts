/**
 * Plan limits ("how much of my Claude / Codex / Antigravity allowance is left"), as each tool's
 * own service reports them. Pure parsers only: the reading (Keychain, files, network) lives in
 * the Mac app, so sign-in tokens never leave it. Every value here comes from the provider; when a
 * reading is missing the window is left out rather than guessed.
 */

export type PlanProvider = "claude" | "codex" | "antigravity"

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
