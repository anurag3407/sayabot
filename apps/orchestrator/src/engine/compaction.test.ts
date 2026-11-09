import { describe, expect, it } from "vitest"
import type { ModelMessage, ToolModelMessage } from "ai"
import { compactTranscript, compactionBoundary, elideOldToolResults } from "./compaction"

describe("Compaction (E7)", () => {
  it("keeps tool calls paired with retained results and preserves system rules", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "trusted rules" },
      { role: "user", content: "original task" },
      { role: "assistant", content: "old progress" },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "a", toolName: "read", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "a", toolName: "read", output: { type: "text", value: "source" } }] },
      { role: "assistant", content: "latest" },
    ]
    expect(compactionBoundary(messages, 2, 2)).toBe(3)
    const result = compactTranscript({ messages, protectedPrefixCount: 2, keepLastMessages: 2, summary: { goal: "task", decisions: [], filesTouched: [], openQuestions: [], planStatus: "", factsLearned: [] } })
    expect(result.messages.slice(0, 2)).toEqual(messages.slice(0, 2))
    expect(result.messages.slice(-3)).toEqual(messages.slice(-3))
  })

  it("never rewrites a failed tool result as a successful completion", () => {
    const messages: ModelMessage[] = [{ role: "tool", content: [{ type: "tool-result", toolCallId: "a", toolName: "test", output: { type: "json", value: { exit_code: 1, error: "assertion failed" } } }] }]
    const result = elideOldToolResults(messages, 0)
    expect(JSON.stringify(result.messages)).toContain("failed")
    expect(JSON.stringify(result.messages)).not.toContain("completed")
  })

  it("elides older tool results while keeping the last K=6 verbatim", () => {
    const messages: ModelMessage[] = []

    // Generate 10 tool messages
    for (let i = 1; i <= 10; i++) {
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: `call-${i}`,
            toolName: "test_tool",
            output: { value: `very long verbose output for step ${i}` } as any,
          },
        ],
      })
    }

    const { messages: result, elidedCount } = elideOldToolResults(messages, 6)
    expect(elidedCount).toBe(4)

    // The first 4 should be elided
    for (let i = 0; i < 4; i++) {
      const msg = result[i] as ToolModelMessage
      const part = msg.content[0] as any
      expect(part.output.type).toBe("text")
      expect(part.output.value).toContain("[result elided:")
      expect(part.output.value).toContain(`call-${i + 1}`)
    }

    // The last 6 should remain verbatim
    for (let i = 4; i < 10; i++) {
      const msg = result[i] as ToolModelMessage
      const part = msg.content[0] as any
      expect(part.output).toEqual({ value: `very long verbose output for step ${i + 1}` })
    }
  })

  it("compacts older transcript messages into a structured summary", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "Initial user request" },
      { role: "assistant", content: "Working on it" },
      { role: "user", content: "Followup request" },
      { role: "assistant", content: "Executing steps" },
      { role: "user", content: "Latest feedback" },
    ]

    const result = compactTranscript({
      messages,
      summary: {
        goal: "Build auth routes",
        decisions: ["Use JWT cookies", "Strict CSRF validation"],
        filesTouched: ["apps/web/auth.ts", "packages/core/jwt.ts"],
        openQuestions: [],
        planStatus: "2/3 steps completed",
        factsLearned: ["Staging uses Redis for sessions"],
        activeMode: "plan",
        pendingVerifications: ["vitest run auth.test.ts"],
      },
    })

    expect(result.compactedThroughIdx).toBe(1)
    expect(result.messages[0]?.role).toBe("user")
    const summaryText = result.messages[0]?.content as string
    expect(summaryText).toContain("Goal: Build auth routes")
    expect(summaryText).toContain("Active Mode: plan")
    expect(summaryText).toContain("Pending Verifications:\n- vitest run auth.test.ts")
    expect(summaryText).toContain("Use JWT cookies")
    expect(summaryText).toContain("Staging uses Redis for sessions")
    expect(result.extractedFacts).toEqual(["Staging uses Redis for sessions"])
  })
})
