export interface TokenUsage {
  inputTokens?: number | null
  outputTokens?: number | null
  cachedInputTokens?: number | null
  cacheCreationTokens?: number | null
  reasoningTokens?: number | null
}

export interface ModelPrice {
  inputPerMtok: number
  outputPerMtok: number
  cacheReadPerMtok?: number | null
  cacheWritePerMtok?: number | null
}

export const ZERO_PRICE: ModelPrice = { inputPerMtok: 0, outputPerMtok: 0 }

/** Cost in USD from per-million-token prices, rounded to six decimals. */
export function computeCostUsd(usage: TokenUsage, price: ModelPrice | null | undefined): number {
  if (!price) return 0
  const totalInput = usage.inputTokens ?? 0
  const cached = Math.min(totalInput, Math.max(0, usage.cachedInputTokens ?? 0))
  const uncached = totalInput - cached
  const output = usage.outputTokens ?? 0

  const cacheReadPrice = price.cacheReadPerMtok ?? (price.inputPerMtok * 0.1) // default 90% prompt cache discount
  const cacheWritePrice = price.cacheWritePerMtok ?? price.inputPerMtok

  const cacheWriteTokens = usage.cacheCreationTokens ?? 0

  const inputCost = cached > 0
    ? (uncached / 1_000_000) * price.inputPerMtok + (cached / 1_000_000) * cacheReadPrice
    : (totalInput / 1_000_000) * price.inputPerMtok

  const cacheWriteCost = (cacheWriteTokens / 1_000_000) * cacheWritePrice
  const outputCost = (output / 1_000_000) * price.outputPerMtok

  const cost = inputCost + cacheWriteCost + outputCost
  return Math.round(cost * 1e6) / 1e6
}

/** Computes estimated dollars saved from prompt caching. */
export function computeCacheSavingsUsd(usage: TokenUsage, price: ModelPrice | null | undefined): number {
  if (!price) return 0
  const cached = Math.max(0, usage.cachedInputTokens ?? 0)
  if (cached === 0) return 0
  const fullPrice = price.inputPerMtok
  const readPrice = price.cacheReadPerMtok ?? (price.inputPerMtok * 0.1)
  const savingsPerMtok = Math.max(0, fullPrice - readPrice)
  const savings = (cached / 1_000_000) * savingsPerMtok
  return Math.round(savings * 1e6) / 1e6
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0.00"
  return `$${value.toFixed(value < 0.01 ? 6 : 2)}`
}

/** Formats token counts cleanly with K, M, B, T suffixes (e.g. 417M, 14.9M, 781K). */
export function formatTokens(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1e12) return `${trimDigits(value / 1e12)}T`
  if (abs >= 1e9) return `${trimDigits(value / 1e9)}B`
  if (abs >= 1e6) return `${trimDigits(value / 1e6)}M`
  if (abs >= 1e3) return `${trimDigits(value / 1e3)}K`
  return new Intl.NumberFormat().format(Math.round(value))
}

function trimDigits(value: number): string {
  const abs = Math.abs(value)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  return value.toFixed(digits).replace(/\.0+$/, "")
}

export function formatPercent(share: number, digits = 1): string {
  const percent = share * 100
  const smallest = 10 ** -digits
  if (percent > 0 && percent < smallest) return `<${smallest.toFixed(digits)}%`
  return `${percent.toFixed(digits)}%`
}

