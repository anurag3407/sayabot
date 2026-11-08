import { describe, expect, it } from "vitest"
import type { ModelMessage } from "ai"
import { summarizeForBudget } from "../../src/engine/summarize"

const msgs = (n: number, each = 10): ModelMessage[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x".repeat(each) }))

const fakeModel = {} as never

describe("summarizeForBudget short-circuits", () => {
  it("returns the messages unchanged when well under budget (no model call)", async () => {
    const input = msgs(4)
    const out = await summarizeForBudget({
      messages: input, protectedPrefixCount: 1, messageBudget: 100_000,
      summarizerInputBudget: 100_000, outputTokens: 100, model: fakeModel, onUsage: () => {},
    })
    expect(out).toEqual({ messages: input, compacted: 0 })
  })

  it("returns unchanged when nothing is compactable beyond the protected prefix", async () => {
    const input = msgs(3)
    const out = await summarizeForBudget({
      messages: input, protectedPrefixCount: 3, messageBudget: 10,
      summarizerInputBudget: 100_000, outputTokens: 100, model: fakeModel, onUsage: () => {},
    })
    expect(out.compacted).toBe(0)
    expect(out.messages).toBe(input)
  })
})
