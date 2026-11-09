/**
 * Pure, zero-dependency cron expression parser and next-run calculator.
 * Supports standard 5-part cron syntax, common aliases, step values, ranges,
 * lists, and natural language shorthand expressions (Hermes-compatible).
 */

export interface ParsedCron {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
  originalExpr: string
}

const ALIASES: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
}

/**
 * Normalizes natural language schedules into standard cron expressions.
 * e.g. "every 15m" -> "star/15 * * * *"
 * "every 2h" -> "0 star/2 * * *"
 * "daily at 9am" -> "0 9 * * *"
 * "weekdays at 9:30" -> "30 9 * * 1-5"
 */
export function normalizeCronExpression(input: string): string {
  const trimmed = input.trim().toLowerCase()
  if (ALIASES[trimmed]) return ALIASES[trimmed]!

  // "every Xm" or "every X minutes"
  const minMatch = trimmed.match(/^every\s+(\d+)\s*(?:m|min|minutes?)$/)
  if (minMatch && minMatch[1]) {
    const mins = Number(minMatch[1])
    if (mins >= 1 && mins <= 59) return `*/${mins} * * * *`
  }

  // "every Xh" or "every X hours"
  const hourMatch = trimmed.match(/^every\s+(\d+)\s*(?:h|hr|hours?)$/)
  if (hourMatch && hourMatch[1]) {
    const hrs = Number(hourMatch[1])
    if (hrs >= 1 && hrs <= 23) return `0 */${hrs} * * *`
  }

  // "daily at 9am" or "daily at 09:30" or "daily at 14:00"
  const dailyMatch = trimmed.match(/^daily\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (dailyMatch && dailyMatch[1]) {
    let hour = Number(dailyMatch[1])
    const minute = dailyMatch[2] ? Number(dailyMatch[2]) : 0
    const meridiem = dailyMatch[3]
    if (meridiem === "pm" && hour < 12) hour += 12
    if (meridiem === "am" && hour === 12) hour = 0
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${minute} ${hour} * * *`
    }
  }

  // "weekdays at 9am" or "weekdays at 09:30"
  const weekdayMatch = trimmed.match(/^weekdays?\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (weekdayMatch && weekdayMatch[1]) {
    let hour = Number(weekdayMatch[1])
    const minute = weekdayMatch[2] ? Number(weekdayMatch[2]) : 0
    const meridiem = weekdayMatch[3]
    if (meridiem === "pm" && hour < 12) hour += 12
    if (meridiem === "am" && hour === 12) hour = 0
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return `${minute} ${hour} * * 1-5`
    }
  }

  return input.trim()
}

function parseField(field: string, min: number, max: number): number[] {
  const values = new Set<number>()

  for (const part of field.split(",")) {
    const trimmed = part.trim()
    if (!trimmed) continue

    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i)
      continue
    }

    if (trimmed.startsWith("*/")) {
      const step = Number(trimmed.slice(2))
      if (Number.isInteger(step) && step > 0) {
        for (let i = min; i <= max; i += step) values.add(i)
      }
      continue
    }

    if (trimmed.includes("-")) {
      const [startStr, endAndStep] = trimmed.split("-")
      if (!startStr || !endAndStep) continue

      let endStr = endAndStep
      let step = 1
      if (endAndStep.includes("/")) {
        const [e, s] = endAndStep.split("/")
        if (e && s) {
          endStr = e
          step = Number(s) || 1
        }
      }

      const start = Number(startStr)
      const end = Number(endStr)
      if (Number.isInteger(start) && Number.isInteger(end) && start <= end) {
        for (let i = Math.max(min, start); i <= Math.min(max, end); i += step) {
          values.add(i)
        }
      }
      continue
    }

    const single = Number(trimmed)
    if (Number.isInteger(single) && single >= min && single <= max) {
      values.add(single)
    }
  }

  return Array.from(values).sort((a, b) => a - b)
}

export function parseCron(expr: string): ParsedCron | null {
  const normalized = normalizeCronExpression(expr)
  const parts = normalized.split(/\s+/)
  if (parts.length !== 5) return null

  const minutesPart = parts[0]
  const hoursPart = parts[1]
  const domPart = parts[2]
  const monthPart = parts[3]
  const dowPart = parts[4]

  if (!minutesPart || !hoursPart || !domPart || !monthPart || !dowPart) return null

  const minutes = parseField(minutesPart, 0, 59)
  const hours = parseField(hoursPart, 0, 23)
  const daysOfMonth = parseField(domPart, 1, 31)
  const months = parseField(monthPart, 1, 12)
  let daysOfWeek = parseField(dowPart, 0, 7)

  // Normalize 7 (Sunday) to 0
  if (daysOfWeek.includes(7)) {
    daysOfWeek = Array.from(new Set(daysOfWeek.map((d) => (d === 7 ? 0 : d)))).sort((a, b) => a - b)
  }

  if (
    minutes.length === 0 ||
    hours.length === 0 ||
    daysOfMonth.length === 0 ||
    months.length === 0 ||
    daysOfWeek.length === 0
  ) {
    return null
  }

  return {
    minutes,
    hours,
    daysOfMonth,
    months,
    daysOfWeek,
    originalExpr: normalized,
  }
}

export function isValidCron(expr: string): boolean {
  return parseCron(expr) !== null
}

/**
 * Calculates the next matching Date for a cron expression after a reference date.
 * Inspects up to 366 days ahead. Returns null if no match found.
 */
export function getNextCronRun(
  expr: string,
  fromDate = new Date(),
  timeZone = "UTC",
): Date | null {
  const parsed = parseCron(expr)
  if (!parsed) return null

  // Start from the next minute, zeroing seconds and ms
  let ts = Math.floor(fromDate.getTime() / 60_000) * 60_000 + 60_000
  const maxSearchTime = fromDate.getTime() + 366 * 86_400_000

  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  })

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }

  while (ts <= maxSearchTime) {
    const d = new Date(ts)
    const parts = dtf.formatToParts(d)

    const findPart = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
    const month = findPart("month")
    const day = findPart("day")
    const hour = findPart("hour")
    const minute = findPart("minute")

    const weekdayStr = parts.find((p) => p.type === "weekday")?.value ?? "Sun"
    const dayOfWeek = weekdayMap[weekdayStr] ?? 0

    const matchesDom = parsed.daysOfMonth.includes(day)
    const matchesDow = parsed.daysOfWeek.includes(dayOfWeek)
    const domRestricted = parsed.daysOfMonth.length < 31
    const dowRestricted = parsed.daysOfWeek.length < 7
    const dayMatches =
      domRestricted && dowRestricted
        ? matchesDom || matchesDow
        : matchesDom && matchesDow

    if (!parsed.months.includes(month) || !dayMatches) {
      // Advance to next day at 00:00
      const minutesToMidnight = (24 - hour) * 60 - minute
      ts += Math.max(minutesToMidnight, 60) * 60_000
      continue
    }

    if (!parsed.hours.includes(hour)) {
      // Advance to next hour at minute 00
      ts += (60 - minute) * 60_000
      continue
    }

    const nextMin = parsed.minutes.find((m) => m >= minute)
    if (nextMin !== undefined) {
      ts += (nextMin - minute) * 60_000
      return new Date(ts)
    }

    // No matching minutes remaining in this hour; advance to next hour
    ts += (60 - minute) * 60_000
    continue
  }

  return null
}

/**
 * Returns a concise, human-readable description of a cron expression.
 */
export function humanReadableCron(expr: string): string {
  const norm = normalizeCronExpression(expr)

  if (norm === "* * * * *") return "Every minute"
  if (norm === "0 * * * *") return "Every hour at minute 0"
  if (norm === "0 0 * * *") return "Daily at midnight"
  if (norm === "0 9 * * *") return "Daily at 09:00"
  if (norm === "0 9 * * 1-5") return "Every weekday at 09:00"
  if (norm === "0 0 * * 0" || norm === "0 0 * * 7") return "Weekly on Sunday at midnight"
  if (norm === "0 0 1 * *") return "Monthly on the 1st at midnight"

  const stepMin = norm.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/)
  if (stepMin && stepMin[1]) return `Every ${stepMin[1]} minutes`

  const stepHour = norm.match(/^0\s+\*\/(\d+)\s+\*\s+\*\s+\*$/)
  if (stepHour && stepHour[1]) return `Every ${stepHour[1]} hours`

  const parts = norm.split(/\s+/)
  if (parts.length === 5) {
    const [min, hr, dom, , dow] = parts
    const timeStr = `${hr?.padStart(2, "0")}:${min?.padStart(2, "0")}`

    if (dom === "*" && dow === "1-5") {
      return `Every weekday at ${timeStr}`
    }
    if (dom === "*" && dow === "*") {
      return `Daily at ${timeStr}`
    }
  }

  return `Cron: ${norm}`
}
