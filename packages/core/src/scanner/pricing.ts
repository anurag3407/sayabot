import type { ModelPrice, UsageSpeed, UsageTokenTotals } from "./types"

export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  // Google / Antigravity
  "gemini-3.8-flash-high": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.8-flash-medium": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.8-flash-low": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.8-flash-tiered": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.8-flash": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.7-flash-high": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.7-flash-medium": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.7-flash-low": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.7-flash-tiered": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.7-flash": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.6-flash-high": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.6-flash-medium": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.6-flash-low": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.6-flash": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.5-flash-high": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.5-flash-medium": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.5-flash-extra-low": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.5-flash": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3-flash-preview": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-3.1-pro": { inputPerMtok: 1.25, outputPerMtok: 5.0, cacheReadPerMtok: 0.3125 },
  "gemini-3.1-flash-lite": { inputPerMtok: 0.075, outputPerMtok: 0.3, cacheReadPerMtok: 0.01875 },
  "gemini-3.1-flash-image": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-2.5-pro": { inputPerMtok: 1.25, outputPerMtok: 5.0, cacheReadPerMtok: 0.3125 },
  "gemini-2.5-flash": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-2.5-flash-thinking": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.0375 },
  "gemini-2.5-flash-lite": { inputPerMtok: 0.075, outputPerMtok: 0.3, cacheReadPerMtok: 0.01875 },
  "gemini-4-argon": { inputPerMtok: 2.0, outputPerMtok: 8.0, cacheReadPerMtok: 0.5 },

  // Anthropic / Claude
  "claude-opus-5-5": {
    inputPerMtok: 15.0,
    outputPerMtok: 75.0,
    cacheReadPerMtok: 1.5,
    cacheWritePerMtok: 18.75,
  },
  "claude-opus-4-6": {
    inputPerMtok: 15.0,
    outputPerMtok: 75.0,
    cacheReadPerMtok: 1.5,
    cacheWritePerMtok: 18.75,
  },
  "claude-opus-4": {
    inputPerMtok: 15.0,
    outputPerMtok: 75.0,
    cacheReadPerMtok: 1.5,
    cacheWritePerMtok: 18.75,
  },
  "claude-sonnet-4-6": {
    inputPerMtok: 3.0,
    outputPerMtok: 15.0,
    cacheReadPerMtok: 0.3,
    cacheWritePerMtok: 3.75,
  },
  "claude-sonnet-4-5": {
    inputPerMtok: 3.0,
    outputPerMtok: 15.0,
    cacheReadPerMtok: 0.3,
    cacheWritePerMtok: 3.75,
  },
  "claude-sonnet-4": {
    inputPerMtok: 3.0,
    outputPerMtok: 15.0,
    cacheReadPerMtok: 0.3,
    cacheWritePerMtok: 3.75,
  },
  "claude-haiku-4-5": {
    inputPerMtok: 0.8,
    outputPerMtok: 4.0,
    cacheReadPerMtok: 0.08,
    cacheWritePerMtok: 1.0,
  },
  "claude-3-7-sonnet": {
    inputPerMtok: 3.0,
    outputPerMtok: 15.0,
    cacheReadPerMtok: 0.3,
    cacheWritePerMtok: 3.75,
  },
  "claude-3-5-sonnet": {
    inputPerMtok: 3.0,
    outputPerMtok: 15.0,
    cacheReadPerMtok: 0.3,
    cacheWritePerMtok: 3.75,
  },
  "claude-3-5-haiku": {
    inputPerMtok: 0.8,
    outputPerMtok: 4.0,
    cacheReadPerMtok: 0.08,
    cacheWritePerMtok: 1.0,
  },
  "claude-3-opus": {
    inputPerMtok: 15.0,
    outputPerMtok: 75.0,
    cacheReadPerMtok: 1.5,
    cacheWritePerMtok: 18.75,
  },

  // OpenAI / Codex
  "gpt-4o": { inputPerMtok: 2.5, outputPerMtok: 10.0, cacheReadPerMtok: 1.25 },
  "gpt-4o-mini": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.075 },
  o1: { inputPerMtok: 15.0, outputPerMtok: 60.0, cacheReadPerMtok: 7.5 },
  "o1-mini": { inputPerMtok: 3.0, outputPerMtok: 12.0, cacheReadPerMtok: 1.5 },
  "o3-mini": { inputPerMtok: 1.1, outputPerMtok: 4.4, cacheReadPerMtok: 0.55 },
  "gpt-4-turbo": { inputPerMtok: 10.0, outputPerMtok: 30.0, cacheReadPerMtok: 5.0 },
  "gpt-3.5-turbo": { inputPerMtok: 0.5, outputPerMtok: 1.5, cacheReadPerMtok: 0.25 },

  // OpenRouter & OpenCode
  "openrouter/stealth-crouton-alpha": {
    inputPerMtok: 2.0,
    outputPerMtok: 6.0,
    cacheReadPerMtok: 0.2,
  },
  "stealth-crouton-alpha": { inputPerMtok: 2.0, outputPerMtok: 6.0, cacheReadPerMtok: 0.2 },
  "gpt-oss-120b-medium": { inputPerMtok: 0.8, outputPerMtok: 2.4, cacheReadPerMtok: 0.08 },
}

/** Fallback price for models that cannot be resolved in any dictionary */
export const DEFAULT_FALLBACK_PRICE: ModelPrice = {
  inputPerMtok: 1.0,
  outputPerMtok: 3.0,
  cacheReadPerMtok: 0.1,
}

export function normalizeModelKey(rawModel: string): string {
  if (!rawModel) return ""
  let model = rawModel.toLowerCase().trim()
  // Strip provider prefixes e.g. "openai/", "anthropic/", "google/"
  const slash = model.indexOf("/")
  if (slash !== -1) {
    const prefix = model.slice(0, slash)
    if (["anthropic", "google", "openai", "bedrock", "vertex"].includes(prefix)) {
      model = model.slice(slash + 1)
    }
  }
  // Strip bracketed context like "[4k]", "[200k]"
  const bracket = model.indexOf("[")
  if (bracket !== -1) {
    model = model.slice(0, bracket)
  }
  return model.trim()
}

/** Resolves the pricing rate for a given model string */
export function getModelPrice(
  model: string,
  overrides?: Record<string, ModelPrice>,
): ModelPrice {
  const normalized = normalizeModelKey(model)
  if (overrides && overrides[normalized]) {
    return overrides[normalized]
  }
  if (DEFAULT_MODEL_PRICES[normalized]) {
    return DEFAULT_MODEL_PRICES[normalized]
  }

  // Attempt base prefix matching (e.g. claude-3-5-sonnet-20241022 -> claude-3-5-sonnet)
  for (const [key, price] of Object.entries(DEFAULT_MODEL_PRICES)) {
    if (normalized.startsWith(key) || key.startsWith(normalized)) {
      return price
    }
  }

  // Handle common variants
  const stripped = normalized
    .replace(/-(?:extra-low|low|medium|high|tiered|control|thinking|agent)$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-latest$/, "")

  if (DEFAULT_MODEL_PRICES[stripped]) {
    return DEFAULT_MODEL_PRICES[stripped]
  }

  return DEFAULT_FALLBACK_PRICE
}

/** Calculates total cost in USD for the given token totals and model pricing */
export function computeUsageCost(
  totals: UsageTokenTotals,
  price: ModelPrice,
  speed: UsageSpeed = "standard",
): number {
  const uncached = Math.max(0, totals.uncachedInputTokens)
  const cached = Math.max(0, totals.cachedInputTokens)
  const cacheCreation = Math.max(0, totals.cacheCreationTokens)
  const output = Math.max(0, totals.outputTokens)

  const cacheReadPrice = price.cacheReadPerMtok ?? price.inputPerMtok * 0.1
  const cacheWritePrice = price.cacheWritePerMtok ?? price.inputPerMtok

  const speedMultiplier = speed === "ultrafast" ? 2.0 : speed === "fast" ? 1.5 : 1.0

  const inputCost = (uncached / 1_000_000) * price.inputPerMtok
  const cacheReadCost = (cached / 1_000_000) * cacheReadPrice
  const cacheWriteCost = (cacheCreation / 1_000_000) * cacheWritePrice
  const outputCost = (output / 1_000_000) * price.outputPerMtok

  const total = (inputCost + cacheReadCost + cacheWriteCost + outputCost) * speedMultiplier
  return Math.round(total * 1e6) / 1e6
}

/** Computes the estimated dollars saved through prompt cache hits */
export function computeUsageCacheSavings(
  totals: UsageTokenTotals,
  price: ModelPrice,
): number {
  const cached = Math.max(0, totals.cachedInputTokens)
  if (cached === 0) return 0

  const fullPrice = price.inputPerMtok
  const readPrice = price.cacheReadPerMtok ?? price.inputPerMtok * 0.1
  const savingsPerMtok = Math.max(0, fullPrice - readPrice)
  const savings = (cached / 1_000_000) * savingsPerMtok
  return Math.round(savings * 1e6) / 1e6
}
