import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  CacheMetrics,
  estimateMessageTokens,
  estimateToolTokens,
  resolveContextBudget,
} from "./budget"

describe("context budgeting", () => {
  it("reserves output, safety and tool tokens for smaller models", () => {
    const budget = resolveContextBudget("groq", {}, 6000)
    expect(budget.contextWindow).toBe(32000)
    expect(
      budget.messageTokens + budget.toolTokens + budget.outputTokens + budget.safetyTokens,
    ).toBe(budget.contextWindow)
    expect(budget.messageTokens).toBeLessThan(24000)
  })

  it("honors explicit model windows but never lets requested input overflow", () => {
    const budget = resolveContextBudget("openai-compatible", {
      contextWindowTokens: 8192,
      contextBudgetTokens: 120000,
      maxOutputTokens: 1000,
    })
    expect(budget.inputTokens + budget.outputTokens + budget.safetyTokens).toBe(8192)
    expect(() => resolveContextBudget("groq", {}, 31000)).toThrow("insufficient context")
  })

  it("includes schemas and Unicode bytes in estimates", () => {
    expect(
      estimateMessageTokens([{ role: "user", content: "漢".repeat(100) }]),
    ).toBeGreaterThanOrEqual(100)
    expect(
      estimateToolTokens([
        {
          name: "test",
          description: "test",
          schema: z.object({ text: z.string().describe("important input") }),
          dangerous: false,
          execute: async () => null,
        },
      ]),
    ).toBeGreaterThan(40)
  })
})

describe("cache metrics", () => {
  it("reports provider-measured ratios rather than prefix similarity estimates", () => {
    const metrics = new CacheMetrics()
    metrics.record({
      inputTokens: 1000,
      outputTokens: 50,
      inputTokenDetails: { cacheReadTokens: 800 },
    } as any)
    metrics.record({
      inputTokens: 1000,
      outputTokens: 50,
      inputTokenDetails: { cacheReadTokens: 900 },
    } as any)
    expect(metrics.snapshot()).toMatchObject({
      calls: 2,
      inputTokens: 2000,
      cacheReadRatio: 0.85,
      completeReporting: true,
    })
  })

  it("does not misrepresent missing usage as a measured zero cache hit rate", () => {
    const metrics = new CacheMetrics()
    metrics.record({ inputTokens: 1000 } as any)
    expect(metrics.snapshot()).toMatchObject({ cacheReadRatio: null, completeReporting: false })
  })

  it("detects cache breaks when read tokens drop sharply and tracks cached state flags", () => {
    const metrics = new CacheMetrics()
    metrics.setToolsCached(true)
    metrics.setHistoryCached(true)

    // Call 1: heavy cache read
    metrics.record({
      inputTokens: 5000,
      outputTokens: 100,
      inputTokenDetails: { cacheReadTokens: 4500, cacheWriteTokens: 500 },
    } as any)

    // Call 2: cache broken (read dropped from 4500 to 200)
    metrics.record({
      inputTokens: 5000,
      outputTokens: 100,
      inputTokenDetails: { cacheReadTokens: 200, cacheWriteTokens: 4800 },
    } as any)

    const snap = metrics.snapshot()
    expect(snap.toolsCached).toBe(true)
    expect(snap.historyCached).toBe(true)
    expect(snap.cacheBreaks).toBe(1)
    expect(snap.cacheReadTokens).toBe(4700)
    expect(snap.cacheWriteTokens).toBe(5300)
  })
})
