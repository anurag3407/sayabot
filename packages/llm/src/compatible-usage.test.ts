import { describe, expect, it, vi } from "vitest"
import {
  convertCompatibleUsage,
  normalizeProviderUsage,
  withUsageTracking,
} from "./compatible-usage"

describe("normalizeProviderUsage", () => {
  it("keeps a standard OpenAI usage object", () => {
    expect(
      normalizeProviderUsage({
        prompt_tokens: 120,
        completion_tokens: 30,
        prompt_tokens_details: { cached_tokens: 40 },
        completion_tokens_details: { reasoning_tokens: 8 },
      }),
    ).toMatchObject({
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 40 },
      completion_tokens_details: { reasoning_tokens: 8 },
    })
  })

  it("adds cache reads and writes back onto Anthropic-style input tokens", () => {
    expect(
      normalizeProviderUsage({
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
      }),
    ).toMatchObject({
      prompt_tokens: 160,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 50, cache_write_tokens: 10 },
    })
  })

  it("reads DeepSeek cache hits and Ollama eval counts", () => {
    expect(
      normalizeProviderUsage({
        prompt_tokens: "80",
        completion_tokens: "15",
        prompt_cache_hit_tokens: "30",
      }),
    ).toMatchObject({
      prompt_tokens: 80,
      completion_tokens: 15,
      prompt_tokens_details: { cached_tokens: 30 },
    })

    expect(normalizeProviderUsage({ prompt_eval_count: 12, eval_count: 4 })).toMatchObject({
      prompt_tokens: 12,
      completion_tokens: 4,
    })
  })

  it("returns undefined when there are no token counts", () => {
    expect(normalizeProviderUsage(null)).toBeUndefined()
    expect(normalizeProviderUsage({ model: "x" })).toBeUndefined()
  })
})

describe("convertCompatibleUsage", () => {
  it("splits cache and reasoning the way the usage tracker stores them", () => {
    const usage = convertCompatibleUsage({
      input_tokens: 100,
      output_tokens: 25,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 10,
      reasoning_tokens: 5,
    })
    expect(usage.inputTokens).toEqual({
      total: 150,
      noCache: 100,
      cacheRead: 40,
      cacheWrite: 10,
    })
    expect(usage.outputTokens).toEqual({ total: 25, text: 20, reasoning: 5 })
  })
})

describe("withUsageTracking", () => {
  it("rewrites JSON and streaming usage into the standard token shape", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/json")) {
        return new Response(
          JSON.stringify({
            usage: { input_tokens: 10, output_tokens: 4, cache_read_input_tokens: 2 },
          }),
          { headers: { "content-type": "application/json" } },
        )
      }
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder()
          controller.enqueue(
            encoder.encode('data: {"choices":[],"usage":{"input_tokens":7,"output_tokens":3}}\n\n'),
          )
          controller.enqueue(encoder.encode("data: [DONE]\n\n"))
          controller.close()
        },
      })
      return new Response(stream, { headers: { "content-type": "text/event-stream" } })
    })

    const tracked = withUsageTracking(fetchImpl)
    const json = await tracked("https://llm.example/json")
    await expect(json.json()).resolves.toMatchObject({
      usage: {
        prompt_tokens: 12,
        completion_tokens: 4,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    })

    const sse = await tracked("https://llm.example/stream")
    const text = await sse.text()
    expect(text).toContain('"prompt_tokens":7')
    expect(text).toContain('"completion_tokens":3')
    expect(text).toContain("data: [DONE]")
  })
})
