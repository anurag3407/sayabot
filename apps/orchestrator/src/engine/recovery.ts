export type EngineErrorCategory =
  | "rate_limit"
  | "server_error"
  | "network"
  | "context_overflow"
  | "quota_exhausted"
  | "auth_error"
  | "refusal"
  | "request_too_large"
  | "no_model"
  | "unknown"

export interface EngineErrorClassification {
  category: EngineErrorCategory
  retryable: boolean
  retryAfterMs?: number
  resetTime?: Date
  message: string
  /** request_too_large: the provider's per-request or per-minute token limit, when it says. */
  limitTokens?: number
}

/**
 * Classifies runtime errors from model providers into structured engine actions:
 * - 429 / rate_limit -> retryable with backoff & retry-after
 * - 5xx / network -> retryable with jittered backoff
 * - context overflow -> compaction trigger
 * - quota exhausted -> park or switch to fallback model
 * - auth error -> park with re-enter key alert
 * - refusal -> surface or switch to fallback model
 */
export function classifyEngineError(error: unknown): EngineErrorClassification {
  const msg = error instanceof Error ? error.message : String(error)
  const lower = msg.toLowerCase()

  // A bot with nothing to answer with: the message already says what to do.
  if (
    lower.includes("has no model yet") ||
    lower.includes("has no model configured") ||
    lower.includes("no saya ai model set up")
  ) {
    return { category: "no_model", retryable: false, message: msg }
  }

  // 0. One request bigger than the plan allows (Groq's free tier: "Request too large … tokens per
  // minute (TPM): Limit 8000, Requested 12345"). Not worth retrying as is; a smaller one may fit.
  if (
    lower.includes("request too large") ||
    lower.includes("reduce your message size") ||
    lower.includes("request entity too large") ||
    (lower.includes("tokens per minute") && lower.includes("requested"))
  ) {
    const limit = /limit\D{0,4}(\d{3,9})/i.exec(msg)?.[1]
    return {
      category: "request_too_large",
      retryable: false,
      message: "Request is larger than this model's plan allows",
      ...(limit ? { limitTokens: Number(limit) } : {}),
    }
  }

  // 1. Context Overflow
  if (
    lower.includes("context_length_exceeded") ||
    lower.includes("maximum context length") ||
    lower.includes("prompt is too long") ||
    lower.includes("too many tokens")
  ) {
    return {
      category: "context_overflow",
      retryable: false,
      message: "Context window exceeded",
    }
  }

  // 2. Auth Errors
  if (
    lower.includes("invalid api key") ||
    lower.includes("authentication error") ||
    lower.includes("unauthorized") ||
    lower.includes("401") ||
    lower.includes("forbidden") ||
    lower.includes("403")
  ) {
    return {
      category: "auth_error",
      retryable: false,
      message: "Authentication failed. Check API key credentials.",
    }
  }

  // 3. Quota Exhaustion
  if (
    lower.includes("insufficient_quota") ||
    lower.includes("quota exceeded") ||
    lower.includes("credit balance is too low") ||
    lower.includes("billing account")
  ) {
    return {
      category: "quota_exhausted",
      retryable: false,
      message: "Provider quota or credit balance exhausted.",
    }
  }

  // 4. Rate Limits (429)
  if (lower.includes("rate_limit") || lower.includes("rate limit") || lower.includes("429")) {
    let retryAfterMs: number | undefined
    const matchSeconds = lower.match(/retry (?:after|in) (\d+(?:\.\d+)?) ?(?:s|sec|seconds)?/)
    if (matchSeconds && matchSeconds[1]) {
      retryAfterMs = Math.round(parseFloat(matchSeconds[1]) * 1000)
    }

    return {
      category: "rate_limit",
      retryable: true,
      retryAfterMs,
      message: "Rate limit exceeded. Waiting before retry.",
    }
  }

  // 5. Server Errors (5xx)
  if (
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("internal server error") ||
    lower.includes("overloaded") ||
    lower.includes("bad gateway")
  ) {
    return {
      category: "server_error",
      retryable: true,
      message: "Model provider server error. Retrying with backoff.",
    }
  }

  // 6. Network Errors
  if (
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("etimedout") ||
    lower.includes("fetch failed") ||
    lower.includes("network error")
  ) {
    return {
      category: "network",
      retryable: true,
      message: "Network connection error. Retrying with backoff.",
    }
  }

  // 7. Refusals
  if (
    lower.includes("refused to respond") ||
    lower.includes("content policy") ||
    lower.includes("safety check")
  ) {
    return {
      category: "refusal",
      retryable: false,
      message: "Model refused the request.",
    }
  }

  return {
    category: "unknown",
    retryable: false,
    message: msg,
  }
}

export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  onRetry?: (attempt: number, delayMs: number, classification: EngineErrorClassification) => void
  sleepFn?: (ms: number) => Promise<void>
}

/**
 * Executes an operation with exponential backoff and jitter for retryable errors (429, 5xx, network).
 */
export async function executeWithRecovery<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5
  const baseDelayMs = options.baseDelayMs ?? 1000
  const maxDelayMs = options.maxDelayMs ?? 30_000
  const sleep =
    options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  let attempt = 0

  while (true) {
    try {
      return await fn()
    } catch (error) {
      const classification = classifyEngineError(error)
      if (!classification.retryable || attempt >= maxRetries) {
        throw error
      }

      attempt++
      let delayMs = classification.retryAfterMs
      if (!delayMs) {
        const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1))
        const jitter = Math.random() * 0.3 * exp
        delayMs = Math.round(exp + jitter)
      }

      if (options.onRetry) {
        options.onRetry(attempt, delayMs, classification)
      }

      await sleep(delayMs)
    }
  }
}

/** Provider account ids in error text ("org_01k38e…") mean nothing to people and stay private. */
export function scrubProviderIds(text: string): string {
  return text
    .replace(/\b(?:org|organization|proj|project|user|acct)[_-][A-Za-z0-9]{8,}\b/g, "[account]")
    .replace(/`\[account\]`/g, "[account]")
}

/** What a person sees when a reply fails, in plain words with what to do next. */
export function userFacingError(
  classified: EngineErrorClassification,
  raw: string,
  modelName?: string,
): string {
  const model = modelName ? `\`${modelName}\`` : "this model"
  switch (classified.category) {
    case "request_too_large":
      return `This chat is too big for ${model} on its current plan${
        classified.limitTokens
          ? ` (${classified.limitTokens.toLocaleString("en-US")} tokens at a time)`
          : ""
      }, even shortened. Switch this bot to a bigger model, or start a new chat.`
    case "context_overflow":
      return `This chat is longer than ${model} can read. Start a new chat, or switch to a model with a bigger context.`
    case "auth_error":
      return "The API key for this bot was rejected. Update it in Settings → API keys, or switch model."
    case "quota_exhausted":
      return "This provider account is out of credit. Add credit with the provider, or switch model."
    case "rate_limit":
      return "The provider limited this key for a moment. Try again in a minute, or switch model."
    case "server_error":
      return "The model provider had a problem on their side. Try again in a moment."
    case "network":
      return "Couldn't reach the model provider. Try again in a moment."
    case "refusal":
      return "The model declined this request."
    case "no_model":
      return scrubProviderIds(raw).slice(0, 600)
    default:
      return scrubProviderIds(raw).slice(0, 600)
  }
}
