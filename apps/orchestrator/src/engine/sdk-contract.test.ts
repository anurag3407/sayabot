import { stepCountIs, streamText, tool, type ModelMessage } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import { describe, expect, it } from "vitest"
import { z } from "zod"

/**
 * Pins the AI SDK behaviours the Engine v2 loop (engine/run.ts) relies on.
 * If an SDK upgrade breaks one of these, the loop's conversation rebuild,
 * deferred tool activation, or usage accounting needs revisiting.
 */

const usage = { inputTokens: { total: 10 }, outputTokens: { total: 5 } }

function scriptedModel(seenTools: string[][]) {
  let call = 0
  return new MockLanguageModelV4({
    doStream: async (opts: any) => {
      call++
      seenTools.push((opts.tools ?? []).map((t: { name: string }) => t.name))
      const chunks: any[] = [{ type: "stream-start", warnings: [] }]
      if (call === 1) {
        chunks.push({ type: "tool-call", toolCallId: "t1", toolName: "find_tools", input: "{}" })
        chunks.push({
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_use" },
          usage,
        })
      } else {
        chunks.push(
          { type: "text-start", id: "1" },
          { type: "text-delta", id: "1", delta: "done" },
          { type: "text-end", id: "1" },
        )
        chunks.push({ type: "finish", finishReason: { unified: "stop", raw: "end_turn" }, usage })
      }
      return {
        stream: new ReadableStream({
          start(c) {
            for (const chunk of chunks) c.enqueue(chunk)
            c.close()
          },
        }),
      }
    },
  } as any)
}

describe("AI SDK contract used by the engine loop", () => {
  it("widens activeTools from prepareStep, sums usage, and scopes response.messages to the final step", async () => {
    const seenTools: string[][] = []
    let active: Array<"find_tools" | "deferred_tool"> = ["find_tools"]
    let lastPrepared: ModelMessage[] = []

    const result = streamText({
      model: scriptedModel(seenTools),
      messages: [{ role: "user", content: "hi" }],
      tools: {
        find_tools: tool({
          inputSchema: z.object({}),
          execute: async () => {
            active = ["find_tools", "deferred_tool"]
            return "activated"
          },
        }),
        deferred_tool: tool({ inputSchema: z.object({}), execute: async () => "ok" }),
      },
      activeTools: active,
      stopWhen: stepCountIs(5),
      prepareStep: ({ messages, stepNumber }) => {
        const next: ModelMessage[] =
          stepNumber === 1
            ? [...messages, { role: "user", content: "<steering>x</steering>" }]
            : messages
        lastPrepared = next
        return { messages: next, activeTools: active }
      },
    })
    for await (const _ of result.fullStream) {
      // drain
    }

    // Tools activated by find_tools are visible on the very next step.
    expect(seenTools).toEqual([["find_tools"], ["find_tools", "deferred_tool"]])

    // totalUsage sums every step; usage would only be the last.
    expect((await result.totalUsage).inputTokens).toBe(20)

    // response.messages is the final step only, so the loop rebuilds the
    // conversation as lastPrepared + final step output.
    const response = await result.response
    expect(response.messages.map((m) => m.role)).toEqual(["assistant"])
    const rebuilt = [...lastPrepared, ...response.messages]
    expect(rebuilt.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user", "assistant"])
  })
})
