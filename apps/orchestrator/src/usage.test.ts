import { beforeEach, describe, expect, it, vi } from "vitest"

const inserted: Array<Record<string, unknown>> = []

vi.mock("./db", () => ({
  getDb: () => ({
    select: () => ({
      from: async () => [
        { provider: "anthropic", model: "claude-sonnet-4-5", inputPerMtok: "3", outputPerMtok: "15" },
      ],
    }),
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        inserted.push(row)
      },
    }),
  }),
}))

const { recordUsageEvent, resetPriceCache } = await import("./usage")

const tokens = { inputTokens: 1_000_000, outputTokens: 0, cachedInputTokens: 0, cacheWriteTokens: 0 }

describe("recordUsageEvent", () => {
  beforeEach(() => {
    inserted.length = 0
    resetPriceCache()
  })

  it("prices API calls from the pricing table", async () => {
    const cost = await recordUsageEvent({
      orgId: "org-1",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      tokens,
    })
    expect(cost).toBe(3)
    expect(inserted[0]?.costUsd).toBe(3)
  })

  it("records subscription runs with their tokens but no cost", async () => {
    const cost = await recordUsageEvent({
      orgId: "org-1",
      provider: "claude-code",
      model: "claude-sonnet-4-5",
      tokens,
      billing: "subscription",
    })
    expect(cost).toBe(0)
    expect(inserted[0]).toMatchObject({ inputTokens: 1_000_000, costUsd: 0 })
  })
})
