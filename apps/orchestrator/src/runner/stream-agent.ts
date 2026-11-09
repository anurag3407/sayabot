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
export async function streamAgentText(options: StreamAgentOptions): Promise<StreamAgentResult> {
  const started = Date.now()
  let ttftMs: number | null = null
  let text = ""
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
    for await (const delta of result.textStream) {
      if (ttftMs === null) ttftMs = Date.now() - started
      text += delta
      await options.onDelta(delta)
    }
    const [usage, finishReason, steps] = await Promise.all([
      result.usage,
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
