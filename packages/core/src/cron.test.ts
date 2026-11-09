import { describe, expect, it } from "vitest"
import {
  getNextCronRun,
  humanReadableCron,
  isValidCron,
  normalizeCronExpression,
  parseCron,
} from "./cron"

describe("cron expression parser and validator", () => {
  it("normalizes common cron aliases", () => {
    expect(normalizeCronExpression("@daily")).toBe("0 0 * * *")
    expect(normalizeCronExpression("@hourly")).toBe("0 * * * *")
    expect(normalizeCronExpression("@weekly")).toBe("0 0 * * 0")
  })

  it("normalizes natural language shorthand expressions", () => {
    expect(normalizeCronExpression("every 15m")).toBe("*/15 * * * *")
    expect(normalizeCronExpression("every 30 minutes")).toBe("*/30 * * * *")
    expect(normalizeCronExpression("every 2h")).toBe("0 */2 * * *")
    expect(normalizeCronExpression("daily at 9am")).toBe("0 9 * * *")
    expect(normalizeCronExpression("daily at 14:30")).toBe("30 14 * * *")
    expect(normalizeCronExpression("weekdays at 9am")).toBe("0 9 * * 1-5")
    expect(normalizeCronExpression("weekdays at 10:15 am")).toBe("15 10 * * 1-5")
  })

  it("validates valid and invalid cron expressions", () => {
    expect(isValidCron("* * * * *")).toBe(true)
    expect(isValidCron("0 9 * * 1-5")).toBe(true)
    expect(isValidCron("*/10 8-18 * * 1-5")).toBe(true)
    expect(isValidCron("@daily")).toBe(true)
    expect(isValidCron("every 2h")).toBe(true)

    expect(isValidCron("invalid expression")).toBe(false)
    expect(isValidCron("60 * * * *")).toBe(false) // 60 is invalid minute
    expect(isValidCron("0 25 * * *")).toBe(false) // 25 is invalid hour
    expect(isValidCron("* * * *")).toBe(false) // only 4 fields
  })

  it("computes next run time accurately", () => {
    // Reference date: Wednesday 2026-06-10 08:00:00 UTC
    const ref = new Date("2026-06-10T08:00:00Z")

    // Every hour
    const nextHourly = getNextCronRun("0 * * * *", ref, "UTC")
    expect(nextHourly?.toISOString()).toBe("2026-06-10T09:00:00.000Z")

    // Daily at 09:30
    const nextDaily = getNextCronRun("30 9 * * *", ref, "UTC")
    expect(nextDaily?.toISOString()).toBe("2026-06-10T09:30:00.000Z")

    // Next weekday at 09:00 from Friday afternoon
    const fridayRef = new Date("2026-06-12T15:00:00Z") // Friday
    const nextWeekday = getNextCronRun("0 9 * * 1-5", fridayRef, "UTC")
    // Should be Monday June 15th at 09:00
    expect(nextWeekday?.toISOString()).toBe("2026-06-15T09:00:00.000Z")
  })

  it("generates clean human readable descriptions", () => {
    expect(humanReadableCron("* * * * *")).toBe("Every minute")
    expect(humanReadableCron("0 9 * * *")).toBe("Daily at 09:00")
    expect(humanReadableCron("0 9 * * 1-5")).toBe("Every weekday at 09:00")
    expect(humanReadableCron("*/15 * * * *")).toBe("Every 15 minutes")
    expect(humanReadableCron("0 */2 * * *")).toBe("Every 2 hours")
  })
})
