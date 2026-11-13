import { describe, expect, it } from "vitest"
import {
  baseModelName,
  computeCacheSavingsUsd,
  pickModelPrice,
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

  it("prices cache writes once, since they are already part of the input total", () => {
    // 1M prompt = 100K fresh + 600K read + 300K written; Anthropic-style rates.
    expect(
      computeCostUsd(
        {
          inputTokens: 1_000_000,
          cachedInputTokens: 600_000,
          cacheCreationTokens: 300_000,
          outputTokens: 0,
        },
        { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
      ),
    ).toBe(1.605) // $0.30 fresh + $0.18 read + $1.125 written
  })

  it("never prices more cache traffic than the prompt held", () => {
    expect(
      computeCostUsd(
        { inputTokens: 100, cachedInputTokens: 80, cacheCreationTokens: 500, outputTokens: 0 },
        { inputPerMtok: 1_000_000, outputPerMtok: 0, cacheReadPerMtok: 0, cacheWritePerMtok: 1_000_000 },
      ),
    ).toBe(20) // 80 read for free + 20 written, nothing fresh
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


describe("pickModelPrice", () => {
  const rows = [
    { provider: "anthropic", model: "claude-sonnet-4-5", inputPerMtok: 3, outputPerMtok: 15 },
    { provider: "openai", model: "gpt-5", inputPerMtok: 1.25, outputPerMtok: 10 },
    { provider: "openrouter", model: "openai/gpt-5", inputPerMtok: 1.3, outputPerMtok: 10.5 },
  ]

  it("prefers an exact provider and model", () => {
    expect(pickModelPrice(rows, "openrouter", "openai/gpt-5")?.inputPerMtok).toBe(1.3)
  })

  it("matches OpenRouter-style and dated names to the base model", () => {
    expect(pickModelPrice(rows, "openrouter", "anthropic/claude-sonnet-4-5")?.provider).toBe("anthropic")
    expect(pickModelPrice(rows, "anthropic", "claude-sonnet-4-5-20250929")?.inputPerMtok).toBe(3)
    expect(pickModelPrice(rows, "anthropic", "claude-sonnet-4-5:beta")?.inputPerMtok).toBe(3)
  })

  it("returns null for models nobody priced", () => {
    expect(pickModelPrice(rows, "groq", "llama-9")).toBeNull()
  })

  it("strips prefixes and suffixes", () => {
    expect(baseModelName("Anthropic/Claude-Opus-4-1-20250805")).toBe("claude-opus-4-1")
    expect(baseModelName("gpt-4o-latest")).toBe("gpt-4o")
  })
})
