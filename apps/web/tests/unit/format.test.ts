import { describe, expect, it, vi } from "vitest"
import { cn, formatMs, formatNumber, formatPercent, formatTokens, formatUsd, initials, pretty, relativeTime, statusTone, truncate } from "../../src/lib/format"

describe("cn / initials", () => {
  it("merges and dedupes class strings", () => {
    expect(cn("a", "b", { c: true, d: false })).toBe("a b c")
    expect(cn("px-2", "px-4")).toBe("px-4")
  })
  it("initials: two+ parts -> first+last; one part -> first two; empty -> ?", () => {
    expect(initials("Ada Lovelace")).toBe("AL")
    expect(initials("Ada Byron King")).toBe("AK")
    expect(initials("ada")).toBe("AD")
    expect(initials("   ")).toBe("?")
  })
})

describe("relativeTime buckets", () => {
  const now = Date.now()
  vi.setSystemTime(now)
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString()
  it("now / minutes / hours / days / date", () => {
    expect(relativeTime(iso(10_000))).toBe("now")
    expect(relativeTime(iso(5 * 60_000))).toBe("5m ago")
    expect(relativeTime(iso(3 * 3_600_000))).toBe("3h ago")
    expect(relativeTime(iso(2 * 86_400_000))).toBe("2d ago")
    expect(relativeTime(iso(30 * 86_400_000))).toMatch(/\w{3} \d+/)
    expect(relativeTime("not-a-date")).toBe("")
  })
})

describe("numbers", () => {
  it("formatTokens scales K/M/B/T", () => {
    expect(formatTokens(999)).toBe("999")
    expect(formatTokens(1_250)).toBe("1.25K")
    expect(formatTokens(14_900_000)).toBe("14.9M")
    expect(formatTokens(417_000_000)).toBe("417M")
    expect(formatTokens(2_500_000_000)).toBe("2.50B")
    expect(formatTokens(1_000_000_000_000)).toBe("1T")
  })
  it("formatUsd keeps sub-cent precision visible", () => {
    expect(formatUsd(0)).toBe("$0.00")
    expect(formatUsd(0.001)).toBe("$0.001000")
    expect(formatUsd(12.5)).toBe("$12.50")
  })
  it("formatPercent floors tiny values to <x%", () => {
    expect(formatPercent(0.5)).toBe("50.0%")
    expect(formatPercent(0.0001, 1)).toBe("<0.1%")
  })
  it("formatMs / formatNumber / pretty / truncate", () => {
    expect(formatMs(null)).toBe("-")
    expect(formatMs(undefined)).toBe("-")
    expect(formatMs(250)).toBe("250 ms")
    expect(formatMs(1500)).toBe("1.5 s")
    expect(formatNumber(1234567)).toContain("1")
    expect(pretty({ a: 1 })).toContain('"a": 1')
    expect(truncate("hello", 10)).toBe("hello")
    expect(truncate("hello world", 5)).toBe("hello\u2026")
  })
})

describe("statusTone", () => {
  it("maps statuses to tone classes", () => {
    expect(statusTone("complete")).toContain("ok")
    expect(statusTone("done")).toContain("ok")
    expect(statusTone("approved")).toContain("ok")
    expect(statusTone("running")).toContain("warn")
    expect(statusTone("pending_approval")).toContain("warn")
    expect(statusTone("error")).toContain("danger")
    expect(statusTone("rejected")).toContain("danger")
    expect(statusTone("halted")).toContain("accent")
    expect(statusTone("mystery")).toBe("text-muted")
  })
})
