import type { ToolSpec } from "../tools/audited"
import { ALWAYS_CORE_TOOLS } from "./tool-search"

/**
 * Lean turns, for a model whose provider caps one request well below its context window (Groq's
 * free tier allows a few thousand tokens a minute). Once a provider has said "request too large",
 * the bot keeps that limit for that model in `params.requestLimits["provider/model"]`, and every turn
 * with that model fits under it: the last
 * few messages instead of forty, no canvas text, a handful of tools (more through find_tools), and
 * room for a short answer. Providers count the answer's room toward the limit too.
 */

export const LEAN_HISTORY = 8

/** Tools a lean turn always offers; find_tools still reaches the rest when the bot needs them. */
const LEAN_TOOLS = new Set([
  "find_tools",
  "remember",
  "recall",
  "canvas_read",
  "canvas_write",
  "update_plan",
])

export function modelLimitKey(provider: string, modelName: string): string {
  return `${provider}/${modelName}`.slice(0, 200)
}

export function leanLimitTokens(params: unknown, key: string): number | null {
  const limits = (params as Record<string, unknown> | null)?.requestLimits
  const value =
    limits && typeof limits === "object" ? (limits as Record<string, unknown>)[key] : undefined
  return typeof value === "number" && Number.isFinite(value) && value >= 1_000
    ? Math.floor(value)
    : null
}

/**
 * The limit to try next after a "request too large": what the provider said, else 60% of the
 * last one tried. null when even a lean turn can't get smaller (stop retrying).
 */
export function nextLeanLimit(reported: number | undefined, current: number | null): number | null {
  const next = reported ?? (current ? Math.floor(current * 0.6) : 6_000)
  if (next < 1_500) return null
  return current !== null && next >= current ? null : next
}

/** The budget a lean turn runs with: input under 60% of the limit, the answer under 25%. */
export function leanParams(
  params: Record<string, unknown>,
  limit: number | null,
): Record<string, unknown> {
  if (!limit) return params
  const input = Math.floor(limit * 0.6)
  const output = Math.max(512, Math.floor(limit * 0.25))
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Infinity)
  return {
    ...params,
    contextBudgetTokens: Math.min(num(params.contextBudgetTokens), input),
    maxOutputTokens: Math.min(num(params.maxOutputTokens), output),
  }
}

/** The lean tool set, plus whatever find_tools has turned on during this turn. */
export function leanToolNames(
  base: () => string[] | undefined,
  specs: ToolSpec[],
): () => string[] | undefined {
  return () => {
    const offered = base()
    // Few tools in total: no find_tools, so the lean set is all there is.
    if (!offered) return specs.map((s) => s.name).filter((name) => LEAN_TOOLS.has(name))
    return offered.filter((name) => LEAN_TOOLS.has(name) || !ALWAYS_CORE_TOOLS.has(name))
  }
}
