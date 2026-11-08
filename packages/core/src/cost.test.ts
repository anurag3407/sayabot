import { describe, expect, it } from "vitest"
import {
  computeCacheSavingsUsd,
  computeCostUsd,
  formatPercent,
  formatTokens,
  formatUsd,
} from "./cost"

describe("computeCostUsd", () => {
  it("prices input and output tokens per million", () => {
    expect(
      computeCostUsd({ inputTokens: 1_000_000, outputTokens: 500_000 }, {
        inputPerMtok: 2,
        outputPerMtok: 8,
      }),
    ).toBe(6)
  })

  it("returns zero without a price row", () => {
    expect(computeCostUsd({ inputTokens: 100 }, null)).toBe(0)
  })

  it("rounds to six decimals", () => {
    expect(
      computeCostUsd({ inputTokens: 1, outputTokens: 1 }, { inputPerMtok: 0.15, outputPerMtok: 0.6 }),
    ).toBe(0.000001)
  })

  it("applies prompt caching discounts when cachedInputTokens is present", () => {
    expect(
      computeCostUsd(
        { inputTokens: 1_000_000, cachedInputTokens: 800_000, outputTokens: 0 },
        { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3 },
      ),
    ).toBe(0.84) // 200K uncached * $3/M = $0.60 + 800K cached * $0.3/M = $0.24 -> $0.84
  })
})

describe("computeCacheSavingsUsd", () => {
  it("computes savings from cached tokens", () => {
    expect(
      computeCacheSavingsUsd(
        { cachedInputTokens: 100_000_000 },
        { inputPerMtok: 3.0, outputPerMtok: 15.0, cacheReadPerMtok: 0.3 },
      ),
    ).toBe(270)
  })
})

describe("formatTokens", () => {
  it("formats tokens into clean compact suffixes", () => {
    expect(formatTokens(417_000_000)).toBe("417M")
    expect(formatTokens(14_900_000)).toBe("14.9M")
    expect(formatTokens(781_000)).toBe("781K")
    expect(formatTokens(1_590_000)).toBe("1.59M")
    expect(formatTokens(350)).toBe("350")
  })
})

describe("formatPercent", () => {
  it("formats percentages with one decimal", () => {
    expect(formatPercent(0.921)).toBe("92.1%")
    expect(formatPercent(0.074)).toBe("7.4%")
    expect(formatPercent(0.005)).toBe("0.5%")
  })
})

describe("formatUsd", () => {
  it("shows more precision for sub-cent amounts", () => {
    expect(formatUsd(0.000123)).toBe("$0.000123")
    expect(formatUsd(1.5)).toBe("$1.50")
  })
})

