import { appendThinking, closeThinking, type ThinkingFold } from "@sayabot/core"
import { stepCountIs, streamText, type LanguageModel, type LanguageModelUsage, type ToolSet } from "ai"

export interface StreamAgentOptions {
  model: LanguageModel
  system: string
  prompt: string
  tools?: ToolSet
  abortSignal?: AbortSignal
  maxSteps?: number
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  onDelta: (delta: string) => void | Promise<void>
}

export interface StreamAgentResult {
  text: string
  usage: LanguageModelUsage | null
  ttftMs: number | null
  latencyMs: number
  aborted: boolean
  error: string | null
  finishReason: string | null
  steps: number
}

/**
 * Single place that owns the AI SDK streaming contract. Text is forwarded as it
 * arrives; tool execution happens inside streamText's step loop.
 */
function chunkText(part: { text?: string; delta?: string }): string {
  if (typeof part.text === "string" && part.text) return part.text
  if (typeof part.delta === "string" && part.delta) return part.delta
  return ""
}

export async function streamAgentText(options: StreamAgentOptions): Promise<StreamAgentResult> {
  const started = Date.now()
  let ttftMs: number | null = null
  let text = ""
  let fold: ThinkingFold = { open: false }
  const push = async (kind: "thinking" | "answer", chunk: string) => {
    const next = appendThinking(fold, kind, chunk)
    fold = next.fold
    if (!next.delta) return
    if (ttftMs === null) ttftMs = Date.now() - started
    text += next.delta
    await options.onDelta(next.delta)
  }
  try {
    const result = streamText({
      model: options.model,
      system: options.system,
      prompt: options.prompt,
      tools: options.tools,
      abortSignal: options.abortSignal,
      stopWhen: stepCountIs(options.maxSteps ?? 20),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.topP !== undefined ? { topP: options.topP } : {}),
      ...(options.maxOutputTokens !== undefined
        ? { maxOutputTokens: options.maxOutputTokens }
        : {}),
    })
    for await (const part of result.fullStream) {
      if (part.type === "reasoning-delta") await push("thinking", chunkText(part))
      else if (part.type === "text-delta") await push("answer", chunkText(part))
    }
    const closed = closeThinking(fold)
    if (closed.delta) {
      text += closed.delta
      await options.onDelta(closed.delta)
    }
    // totalUsage sums every step of the tool loop; usage alone is only the last step.
    const [usage, finishReason, steps] = await Promise.all([
      result.totalUsage,
      result.finishReason,
      Promise.resolve(result.steps)
        .then((s) => (Array.isArray(s) ? s.length : 1))
        .catch(() => 1),
    ])
    return {
      text,
      usage,
      ttftMs,
      latencyMs: Date.now() - started,
      aborted: options.abortSignal?.aborted ?? false,
      error: null,
      finishReason,
      steps: typeof steps === "number" ? steps : 1,
    }
  } catch (error) {
    const aborted =
      options.abortSignal?.aborted === true ||
      (error instanceof Error && error.name === "AbortError")
    return {
      text,
      usage: null,
      ttftMs,
      latencyMs: Date.now() - started,
      aborted,
      error: aborted ? null : error instanceof Error ? error.message : String(error),
      finishReason: null,
      steps: 0,
    }
  }
}
