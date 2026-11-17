import { simulateReadableStream } from "ai/test"
import { MockLanguageModelV3 } from "ai/test"
import { tool } from "ai"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { streamAgentText } from "./stream-agent"

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 2, text: 2, reasoning: 0 },
}

function textStream(text: string) {
  return simulateReadableStream({
    chunks: [
      { type: "stream-start" as const, warnings: [] },
      { type: "text-start" as const, id: "t1" },
      { type: "text-delta" as const, id: "t1", delta: text },
      { type: "text-end" as const, id: "t1" },
      {
        type: "finish" as const,
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage,
      },
    ],
    chunkDelayInMs: null,
    initialDelayInMs: null,
  })
}

describe("streamAgentText", () => {
  it("streams deterministic text and reports usage", async () => {
    const model = new MockLanguageModelV3({
      provider: "mock",
      modelId: "mock-model",
      doStream: { stream: textStream("Hello from the mock model.") },
    })
    const deltas: string[] = []
    const result = await streamAgentText({
      model,
      system: "test",
      prompt: "hi",
      onDelta: (delta) => {
        deltas.push(delta)
      },
    })
    expect(deltas.join("")).toBe("Hello from the mock model.")
    expect(result.text).toBe("Hello from the mock model.")
    expect(result.error).toBeNull()
    expect(result.aborted).toBe(false)
    expect(result.usage?.inputTokens).toBe(3)
    expect(result.usage?.outputTokens).toBe(2)
  })

  it("folds reasoning into a think block ahead of the answer", async () => {
    const model = new MockLanguageModelV3({
      provider: "mock",
      modelId: "mock-model",
      doStream: {
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "reasoning-start" as const, id: "r1" },
            { type: "reasoning-delta" as const, id: "r1", delta: "Look it up." },
            { type: "reasoning-end" as const, id: "r1" },
            { type: "text-start" as const, id: "t1" },
            { type: "text-delta" as const, id: "t1", delta: "Found it." },
            { type: "text-end" as const, id: "t1" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage,
            },
          ],
          chunkDelayInMs: null,
          initialDelayInMs: null,
        }),
      },
    })
    const deltas: string[] = []
    const result = await streamAgentText({
      model,
      system: "test",
      prompt: "hi",
      onDelta: (delta) => {
        deltas.push(delta)
      },
    })
    expect(deltas.join("")).toBe("<think>\nLook it up.\n</think>\n\nFound it.")
    expect(result.text).toBe("<think>\nLook it up.\n</think>\n\nFound it.")
  })

  it("executes a tool call and continues the step loop", async () => {
    let echoed = ""
    const model = new MockLanguageModelV3({
      provider: "mock",
      modelId: "mock-model",
      doStream: [
        {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start" as const, warnings: [] },
              {
                type: "tool-call" as const,
                toolCallId: "call-1",
                toolName: "echo",
                input: JSON.stringify({ text: "ping" }),
              },
              {
                type: "finish" as const,
                finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
                usage,
              },
            ],
            chunkDelayInMs: null,
            initialDelayInMs: null,
          }),
        },
        { stream: textStream("final answer") },
      ],
    })
    const deltas: string[] = []
    const result = await streamAgentText({
      model,
      system: "test",
      prompt: "use the tool",
      tools: {
        echo: tool({
          description: "echo text",
          inputSchema: z.object({ text: z.string() }),
          execute: async ({ text }) => {
            echoed = text
            return { echoed: text }
          },
        }),
      },
      onDelta: (delta) => {
        deltas.push(delta)
      },
    })
    expect(echoed).toBe("ping")
    expect(result.text).toBe("final answer")
    expect(result.finishReason).toBe("stop")
    expect(result.error).toBeNull()
  })

  it("reports aborts without treating them as errors", async () => {
    const controller = new AbortController()
    const model = new MockLanguageModelV3({
      provider: "mock",
      modelId: "mock-model",
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "t1" },
            { type: "text-delta" as const, id: "t1", delta: "partial" },
            { type: "text-delta" as const, id: "t1", delta: " more" },
            { type: "text-end" as const, id: "t1" },
            {
              type: "finish" as const,
              finishReason: { unified: "stop" as const, raw: "stop" },
              usage,
            },
          ],
          chunkDelayInMs: 5,
          initialDelayInMs: null,
        }),
      }),
    })
    const result = await streamAgentText({
      model,
      system: "test",
      prompt: "hi",
      abortSignal: controller.signal,
      onDelta: () => {
        controller.abort()
      },
    })
    expect(result.aborted).toBe(true)
    expect(result.error).toBeNull()
  })
})
