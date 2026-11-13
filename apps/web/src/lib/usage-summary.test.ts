import { describe, expect, it } from "vitest"
import {
  prettyModelName,
  rowFromEvent,
  rowFromRollup,
  speed,
  summarize,
  timeSeries,
  type RawEvent,
} from "./usage-summary"

const prices = [
  { provider: "anthropic", model: "claude-sonnet-4-5", inputPerMtok: 3, outputPerMtok: 15 },
]
const names = { agent: (id: string | null) => id ?? "No agent", room: (id: string | null) => id ?? "None" }

function event(partial: Partial<RawEvent>): RawEvent {
  return {
    agent_id: "a1",
    room_id: "r1",
    provider: "anthropic",
    model: "claude-sonnet-4-5",
    kind: "llm",
    input_tokens: 1000,
    output_tokens: 100,
    cached_input_tokens: 400,
    cost_usd: 0.01,
    ttft_ms: 500,
    latency_ms: 2000,
    created_at: "2026-11-10T10:00:00.000Z",
    ...partial,
  }
}

describe("summarize", () => {
  it("counts replies separately from background calls", () => {
    const rows = [event({}), event({ kind: "summary" }), event({ kind: "verify" })].map(rowFromEvent)
    const result = summarize(rows, prices, names)
    expect(result.replies).toBe(1)
    expect(result.backgroundCalls).toBe(2)
    expect(result.tokens).toBe(3300)
  })

  it("measures the cache hit rate against prompt tokens, not output", () => {
    const result = summarize([rowFromEvent(event({}))], prices, names)
    expect(result.cacheHitRate).toBeCloseTo(0.4)
    expect(result.fresh).toBe(600)
  })

  it("flags models with no price instead of calling them free", () => {
    const rows = [
      rowFromEvent(event({ provider: "groq", model: "openai/gpt-oss-120b", cost_usd: 0 })),
      rowFromEvent(event({ provider: "claude-code", cost_usd: 0 })),
      rowFromEvent(event({})),
    ]
    const result = summarize(rows, prices, names)
    expect(result.unpricedTokens).toBe(1100)
    expect(result.subscriptionTokens).toBe(1100)
    expect(result.byModel.find((m) => m.provider === "groq")?.price).toBe("unpriced")
    expect(result.byModel.find((m) => m.provider === "claude-code")?.price).toBe("subscription")
  })

  it("weights rollup rows by how many calls they stand for", () => {
    const row = rowFromRollup({
      agent_id: "a1",
      room_id: "r1",
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      kind: "llm",
      requests: 42,
      input_tokens: 10_000,
      output_tokens: 2_000,
      cached_input_tokens: 99_999,
      cost_usd: 1.5,
      last_at: null,
    })
    const result = summarize([row], prices, names)
    expect(result.replies).toBe(42)
    expect(result.cached).toBe(10_000)
    expect(result.byAgent[0]?.calls).toBe(42)
  })
})

describe("speed", () => {
  it("uses medians from replies only", () => {
    const rows = [
      event({ latency_ms: 1000 }),
      event({ latency_ms: 3000 }),
      event({ latency_ms: 90_000 }),
      event({ kind: "memory", latency_ms: 500_000 }),
    ].map(rowFromEvent)
    const result = speed(rows)
    expect(result.medianReplyMs).toBe(3000)
    expect(result.measured).toBe(3)
  })
})

describe("timeSeries", () => {
  it("covers the whole period so early calls are not dropped", () => {
    const sinceIso = new Date(2026, 10, 1, 15, 0).toISOString()
    const now = new Date(2026, 10, 3, 9, 0).getTime()
    const rows = [
      rowFromEvent(event({ created_at: new Date(2026, 10, 1, 16, 0).toISOString() })),
      rowFromEvent(event({ created_at: new Date(2026, 10, 3, 8, 0).toISOString() })),
    ]
    const result = timeSeries(rows, {
      sinceIso,
      hourly: false,
      metric: "tokens",
      groupBy: (row) => ({ id: row.agentId ?? "none", label: "A" }),
      now,
    })
    expect(result.points).toHaveLength(3)
    expect(result.points.reduce((sum, point) => sum + point.total, 0)).toBe(2200)
  })

  it("folds small groups into one", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      rowFromEvent(event({ agent_id: `a${index}`, input_tokens: 100 * (index + 1), output_tokens: 0 })),
    )
    const result = timeSeries(rows, {
      sinceIso: "2026-11-09T00:00:00.000Z",
      hourly: false,
      metric: "tokens",
      groupBy: (row) => ({ id: row.agentId ?? "none", label: row.agentId ?? "" }),
      now: new Date("2026-11-11T00:00:00.000Z").getTime(),
    })
    expect(result.series).toHaveLength(6)
    expect(result.series.at(-1)?.id).toBe("other")
  })
})

describe("prettyModelName", () => {
  it.each([
    ["claude-sonnet-4-5-20250929", "Claude Sonnet 4.5"],
    ["claude-3-5-haiku-latest", "Claude 3.5 Haiku"],
    ["gpt-4o-mini", "GPT-4o Mini"],
    ["openai/gpt-oss-120b", "GPT OSS 120B"],
    ["llama-3.3-70b-versatile", "Llama 3.3 70B Versatile"],
    ["gemini-2.5-flash", "Gemini 2.5 Flash"],
    ["o3-mini", "o3 Mini"],
  ])("%s → %s", (input, expected) => {
    expect(prettyModelName(input)).toBe(expected)
  })
})
