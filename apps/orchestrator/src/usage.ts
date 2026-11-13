import { computeCostUsd, pickModelPrice, type ModelPrice, type PriceRow } from "@sayabot/core"
import { modelPricing, usageEvents } from "@sayabot/db"
import { listPriceFor } from "@sayabot/llm/models"
import type { LanguageModelUsage } from "ai"
import { getDb } from "./db"

/**
 * One place that turns a model call into a usage_events row, so every path (replies,
 * moderator turns, subagents, critic checks, memory consolidation) is counted and priced the
 * same way. Prices are cached briefly; edits on the pricing page apply within a minute.
 */

export type UsageKind = "llm" | "moderator" | "subagent" | "verify" | "memory" | "summary"

let priceCache: { rows: PriceRow[]; at: number } | null = null
const PRICE_TTL_MS = 60_000

async function priceRows(): Promise<PriceRow[]> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.rows
  const rows = await getDb()
    .select({
      provider: modelPricing.provider,
      model: modelPricing.model,
      inputPerMtok: modelPricing.inputPerMtok,
      outputPerMtok: modelPricing.outputPerMtok,
    })
    .from(modelPricing)
  const list = Array.isArray(rows) ? rows : []
  priceCache = {
    rows: list.map((r) => ({ ...r, inputPerMtok: Number(r.inputPerMtok), outputPerMtok: Number(r.outputPerMtok) })),
    at: Date.now(),
  }
  return priceCache.rows
}

export interface UsageTokens {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
}

/** Normalizes an AI SDK usage object (missing fields become 0). */
export function tokensFrom(usage: LanguageModelUsage | null | undefined): UsageTokens | null {
  if (!usage) return null
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens ?? 0,
  }
}

/**
 * A row on the pricing page wins; without one, the list price from the model manifest or
 * models.dev, so a new model is priced the day it ships instead of counting as free.
 */
function listPrice(provider: string, model: string): ModelPrice | null {
  const list = listPriceFor(provider, model)
  if (!list) return null
  return {
    inputPerMtok: list.inputPerMillion,
    outputPerMtok: list.outputPerMillion,
    ...(list.cachedInputPerMillion !== undefined ? { cacheReadPerMtok: list.cachedInputPerMillion } : {}),
    ...(list.cacheWritePerMillion !== undefined ? { cacheWritePerMtok: list.cacheWritePerMillion } : {}),
  }
}

export async function priceUsage(provider: string, model: string, tokens: UsageTokens): Promise<number> {
  const price = pickModelPrice(await priceRows(), provider, model) ?? listPrice(provider, model)
  return computeCostUsd(
    {
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cachedInputTokens: tokens.cachedInputTokens,
      cacheCreationTokens: tokens.cacheWriteTokens,
    },
    price,
  )
}

/** Records one call. Returns the cost; never throws (accounting must not break a reply). */
export async function recordUsageEvent(args: {
  orgId: string
  roomId?: string | null
  agentId?: string | null
  provider: string
  model: string
  tokens: UsageTokens | null
  kind?: UsageKind
  ttftMs?: number | null
  latencyMs?: number | null
  /**
   * "subscription" for runs on someone's own Claude Code / Codex / Cursor plan: the tokens
   * still show on Usage, but they cost nothing per token, so they are never priced.
   */
  billing?: "api" | "subscription"
}): Promise<number> {
  if (!args.tokens) return 0
  const { inputTokens, outputTokens, cachedInputTokens } = args.tokens
  if (inputTokens === 0 && outputTokens === 0) return 0
  try {
    const cost =
      args.billing === "subscription" ? 0 : await priceUsage(args.provider, args.model, args.tokens)
    await getDb().insert(usageEvents).values({
      orgId: args.orgId,
      roomId: args.roomId ?? null,
      agentId: args.agentId ?? null,
      provider: args.provider,
      model: args.model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      kind: args.kind ?? "llm",
      costUsd: cost,
      ttftMs: args.ttftMs ?? null,
      latencyMs: args.latencyMs ?? null,
    })
    return cost
  } catch (error) {
    console.error("[usage] could not record usage", error)
    return 0
  }
}

/** For tests. */
export function resetPriceCache(): void {
  priceCache = null
}
