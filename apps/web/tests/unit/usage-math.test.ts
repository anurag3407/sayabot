import { describe, expect, it } from "vitest"
import { usageByAgent, type UsageRollupRow } from "@/lib/usage-math"

function row(partial: Partial<UsageRollupRow>): UsageRollupRow {
  return {
    agent_id: "a1",
    room_id: "r1",
    provider: "anthropic",
    model: "claude-sonnet",
    kind: "llm",
    requests: 1,
    input_tokens: 100,
    output_tokens: 10,
    cached_input_tokens: 0,
    cost_usd: 0.001,
    last_at: "2026-11-10T10:00:00Z",
    ...partial,
  }
}

describe("usageByAgent", () => {
  it("sums every row for an agent across rooms, kinds and models", () => {
    const usage = usageByAgent([
      row({}),
      row({ room_id: "r2", kind: "subagent", model: "claude-haiku", input_tokens: 1000, output_tokens: 50, cost_usd: 0.002, last_at: "2026-11-11T00:00:00Z" }),
      row({ agent_id: "a2", requests: 5 }),
      row({ agent_id: null, requests: 9 }),
    ])
    const a1 = usage.get("a1")!
    expect(a1.requests).toBe(2)
    expect(a1.inputTokens).toBe(1100)
    expect(a1.outputTokens).toBe(60)
    expect(a1.costUsd).toBe(0.003)
    expect(a1.lastAt).toBe("2026-11-11T00:00:00Z")
    expect(a1.topModel).toBe("claude-haiku")
    expect(a1.byModel.map((m) => m.model)).toEqual(["claude-haiku", "claude-sonnet"])
    expect(usage.get("a2")?.requests).toBe(5)
    expect(usage.size).toBe(2)
  })
})

import { localDayKey, localHourKey } from "@/lib/usage-math"

describe("local bucket keys", () => {
  it("uses the viewer's time zone, not UTC", () => {
    const d = new Date(2026, 10, 12, 1, 30) // 12 Nov 2026, 01:30 local
    expect(localDayKey(d)).toBe("2026-11-12")
    expect(localHourKey(d)).toBe("2026-11-12T01")
    expect(localDayKey(d.toISOString())).toBe("2026-11-12")
  })
  it("accepts Postgres-style offsets", () => {
    const d = new Date(2026, 10, 12, 23, 5)
    const pg = d.toISOString().replace("Z", "+00:00")
    expect(localDayKey(pg)).toBe("2026-11-12")
  })
})
