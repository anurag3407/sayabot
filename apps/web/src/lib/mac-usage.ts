/**
 * Token counts for a reply that ran in an app on the owner's Mac.
 * The app's own report wins. When it sends none, the reply text is counted
 * (about 4 characters per token) so the Usage page still moves.
 */

export interface CountedTokens {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}

/** Pulls token counts out of a Claude, Codex, or Copilot result. */
export function readTokenUsage(value: unknown): CountedTokens | null {
  if (!value || typeof value !== "object") return null
  const raw = value as Record<string, unknown>
  const usage =
    raw.usage && typeof raw.usage === "object" ? (raw.usage as Record<string, unknown>) : raw
  const input = num(usage.inputTokens ?? usage.input_tokens)
  const output = num(usage.outputTokens ?? usage.output_tokens)
  const cached = num(
    usage.cachedInputTokens ?? usage.cached_input_tokens ?? usage.cache_read_input_tokens,
  )
  if (input + output <= 0) return null
  return { inputTokens: input, outputTokens: output, cachedInputTokens: Math.min(input, cached) }
}

/** Rough token count for text the app didn't meter. */
export function estimateTokens(text: string): number {
  const chars = text.trim().length
  if (!chars) return 0
  return Math.max(1, Math.ceil(chars / 4))
}

/**
 * Tokens to store for one finished Mac job.
 * Reported usage wins. Otherwise the reply is estimated and the prompt is left at 0,
 * so a long system prompt is not billed as if the model had read it.
 */
export function tokensForMacJob(usage: unknown, output: string): CountedTokens | null {
  const reported = readTokenUsage(usage)
  if (reported) return reported
  const outputTokens = estimateTokens(output)
  if (!outputTokens) return null
  return { inputTokens: 0, outputTokens, cachedInputTokens: 0 }
}

const MODEL_ID = /^[\w./:@~-]{1,120}$/

/** The model name to store: what the app reported, else what the job asked for. */
export function macUsageModel(reported: unknown, requested: unknown): string {
  if (typeof reported === "string" && MODEL_ID.test(reported.trim())) return reported.trim()
  if (typeof requested === "string" && MODEL_ID.test(requested.trim())) return requested.trim()
  return "auto"
}
