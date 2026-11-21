import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings,
} from "@ai-sdk/openai-compatible"

/**
 * OpenAI's own adapter always sends `stream_options.include_usage`. The compatible adapter
 * does not, so third-party and OpenAI-compatible APIs stream a reply and then omit the token
 * chunk. Usage then records nothing. This wrapper asks for that chunk and rewrites the usage
 * object into the same prompt/completion shape the standard tracker already prices.
 */

type FetchLike = typeof fetch

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function firstNum(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

/**
 * Maps the usage objects third-party APIs actually send onto OpenAI's
 * `prompt_tokens` / `completion_tokens` shape, including cache and reasoning.
 * Returns undefined when the object has no token counts.
 */
export function normalizeProviderUsage(usage: unknown): Record<string, unknown> | undefined {
  const raw = asRecord(usage)
  if (!raw) return undefined

  const promptDetails = asRecord(raw.prompt_tokens_details) ?? asRecord(raw.input_tokens_details)
  const completionDetails =
    asRecord(raw.completion_tokens_details) ?? asRecord(raw.output_tokens_details)

  const cacheRead = firstNum(
    promptDetails?.cached_tokens,
    promptDetails?.cache_read_tokens,
    raw.cache_read_input_tokens,
    raw.cached_tokens,
    raw.prompt_cache_hit_tokens,
  )
  const cacheWrite = firstNum(
    promptDetails?.cache_write_tokens,
    raw.cache_creation_input_tokens,
    raw.cache_write_tokens,
    raw.prompt_cache_write_tokens,
  )
  const reasoning = firstNum(
    completionDetails?.reasoning_tokens,
    raw.reasoning_tokens,
    raw.thinking_tokens,
  )

  // prompt_tokens already includes cached input. input_tokens on Anthropic-style
  // gateways is the uncached part, so cache reads and writes are added back.
  let input = firstNum(raw.prompt_tokens, raw.promptTokens)
  const uncached = firstNum(raw.input_tokens, raw.inputTokens, raw.prompt_eval_count)
  if (input === undefined && uncached !== undefined) {
    input = uncached + (cacheRead ?? 0) + (cacheWrite ?? 0)
  }
  let output = firstNum(
    raw.completion_tokens,
    raw.completionTokens,
    raw.output_tokens,
    raw.outputTokens,
    raw.eval_count,
  )

  if (input === undefined && output === undefined) {
    const total = firstNum(raw.total_tokens, raw.totalTokens)
    if (total === undefined) return undefined
    input = total
    output = 0
  }

  const inputTokens = input ?? 0
  const outputTokens = output ?? 0
  return {
    ...raw,
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: firstNum(raw.total_tokens, raw.totalTokens) ?? inputTokens + outputTokens,
    prompt_tokens_details: {
      ...promptDetails,
      cached_tokens: cacheRead ?? 0,
      ...(cacheWrite !== undefined ? { cache_write_tokens: cacheWrite } : {}),
    },
    completion_tokens_details: {
      ...completionDetails,
      reasoning_tokens: reasoning ?? 0,
    },
  }
}

function emptyUsage() {
  return {
    inputTokens: {
      total: undefined,
      noCache: undefined,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  }
}

/** AI SDK usage converter for OpenAI-compatible providers. */
export function convertCompatibleUsage(usage: unknown) {
  const normalized = normalizeProviderUsage(usage)
  if (!normalized) return emptyUsage()

  const input = normalized.prompt_tokens as number
  const output = normalized.completion_tokens as number
  const details = asRecord(normalized.prompt_tokens_details)
  const completion = asRecord(normalized.completion_tokens_details)
  const cacheRead = firstNum(details?.cached_tokens) ?? 0
  const cacheWrite = firstNum(details?.cache_write_tokens) ?? 0
  const reasoning = firstNum(completion?.reasoning_tokens) ?? 0

  return {
    inputTokens: {
      total: input,
      noCache: Math.max(0, input - cacheRead - cacheWrite),
      cacheRead,
      cacheWrite: cacheWrite || undefined,
    },
    outputTokens: {
      total: output,
      text: Math.max(0, output - reasoning),
      reasoning,
    },
  }
}

function rewriteUsageValue(value: unknown): unknown {
  const record = asRecord(value)
  if (!record || !("usage" in record)) return value
  const normalized = normalizeProviderUsage(record.usage)
  if (!normalized) return value
  return { ...record, usage: normalized }
}

function rewriteSseLine(line: string): string {
  if (!line.startsWith("data:")) return line
  const payload = line.slice("data:".length).trim()
  if (!payload || payload === "[DONE]") return line
  try {
    const parsed = JSON.parse(payload) as unknown
    const rewritten = rewriteUsageValue(parsed)
    if (rewritten === parsed) return line
    return `data: ${JSON.stringify(rewritten)}`
  } catch {
    return line
  }
}

function rewriteEventStream(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ""
        if (lines.length === 0) return
        controller.enqueue(encoder.encode(`${lines.map(rewriteSseLine).join("\n")}\n`))
      },
      flush(controller) {
        buffer += decoder.decode()
        if (buffer) controller.enqueue(encoder.encode(rewriteSseLine(buffer)))
      },
    }),
  )
}

function responseWithoutLength(response: Response, body: BodyInit): Response {
  const headers = new Headers(response.headers)
  headers.delete("content-length")
  return new Response(body, { status: response.status, statusText: response.statusText, headers })
}

async function rewriteUsageResponse(response: Response): Promise<Response> {
  if (!response.body) return response
  const type = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (type.includes("text/event-stream")) {
    return responseWithoutLength(response, rewriteEventStream(response.body))
  }
  if (!type.includes("json")) return response

  const text = await response.text()
  try {
    const parsed = JSON.parse(text) as unknown
    const rewritten = rewriteUsageValue(parsed)
    if (rewritten === parsed) return responseWithoutLength(response, text)
    return responseWithoutLength(response, JSON.stringify(rewritten))
  } catch {
    return responseWithoutLength(response, text)
  }
}

/**
 * Rewrites JSON and server-sent usage chunks so the SDK's token schema accepts them.
 * Composes with a provider fetch (Copilot's token swap, tests).
 */
export function withUsageTracking(inner?: FetchLike): FetchLike {
  const fetchImpl = inner ?? fetch
  return async (input, init) => {
    const response = await fetchImpl(input, init)
    return rewriteUsageResponse(response)
  }
}

/** OpenAI-compatible provider that reports tokens the same way the OpenAI adapter does. */
export function createTrackedOpenAICompatible(options: OpenAICompatibleProviderSettings) {
  return createOpenAICompatible({
    ...options,
    includeUsage: true,
    fetch: withUsageTracking(options.fetch),
    convertUsage: convertCompatibleUsage,
  })
}
