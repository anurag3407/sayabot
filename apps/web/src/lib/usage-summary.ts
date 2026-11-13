import { baseModelName, pickModelPrice, type PriceRow } from "@sayabot/core"
import { localDayKey, localHourKey, type UsageRollupRow } from "@/lib/usage-math"

/**
 * Everything the Usage page shows, computed in one place. Pure, so the numbers can be tested.
 *
 * Token conventions (the same as the AI SDK and the coding-tool logs):
 *   input  = the whole prompt, which already includes cache reads and cache writes
 *   cached = the part of input read from cache
 *   output = what the model wrote
 */

/** Runs on someone's own Claude Code / Codex / Cursor plan: no per-token cost. */
export const SUBSCRIPTION_PROVIDERS = new Set(["claude-code", "codex", "cursor"])

export interface UsageRow {
  agentId: string | null
  roomId: string | null
  provider: string
  model: string
  kind: string
  /** How many model calls this row stands for (1 for a raw event, more for a rollup row). */
  calls: number
  input: number
  output: number
  cached: number
  cacheWrite: number
  cost: number
  ttftMs: number | null
  latencyMs: number | null
  createdAt: string | null
  sessionId: string | null
}

export interface RawEvent {
  agent_id: string | null
  room_id: string | null
  provider: string
  model: string
  kind?: string | null
  input_tokens: number
  output_tokens: number
  cached_input_tokens?: number | null
  cache_creation_tokens?: number | null
  cost_usd: number | string
  ttft_ms: number | null
  latency_ms: number | null
  created_at: string
  session_id?: string | null
}

export function rowFromEvent(event: RawEvent): UsageRow {
  const input = Math.max(0, Number(event.input_tokens) || 0)
  return {
    agentId: event.agent_id,
    roomId: event.room_id,
    provider: (event.provider || "unknown").toLowerCase(),
    model: event.model || "unknown",
    kind: event.kind || "llm",
    calls: 1,
    input,
    output: Math.max(0, Number(event.output_tokens) || 0),
    cached: Math.min(input, Math.max(0, Number(event.cached_input_tokens) || 0)),
    cacheWrite: Math.max(0, Number(event.cache_creation_tokens) || 0),
    cost: Number(event.cost_usd) || 0,
    ttftMs: event.ttft_ms ?? null,
    latencyMs: event.latency_ms ?? null,
    createdAt: event.created_at,
    sessionId: event.session_id ?? null,
  }
}

export function rowFromRollup(row: UsageRollupRow): UsageRow {
  return {
    agentId: row.agent_id,
    roomId: row.room_id,
    provider: (row.provider || "unknown").toLowerCase(),
    model: row.model || "unknown",
    kind: row.kind || "llm",
    calls: row.requests,
    input: row.input_tokens,
    output: row.output_tokens,
    cached: Math.min(row.input_tokens, row.cached_input_tokens),
    cacheWrite: 0,
    cost: row.cost_usd,
    ttftMs: null,
    latencyMs: null,
    createdAt: row.last_at,
    sessionId: null,
  }
}

export type PriceState = "priced" | "subscription" | "unpriced"

export function priceState(row: Pick<UsageRow, "provider" | "model">, prices: readonly PriceRow[]): PriceState {
  if (SUBSCRIPTION_PROVIDERS.has(row.provider)) return "subscription"
  return pickModelPrice(prices, row.provider, row.model) ? "priced" : "unpriced"
}

export interface Bucket {
  key: string
  label: string
  calls: number
  tokens: number
  cost: number
  share: number
  costShare: number
}

export interface ModelBucket extends Bucket {
  provider: string
  model: string
  price: PriceState
}

export interface UsageSummary {
  /** Agent replies (one per turn, however many tool steps it took). */
  replies: number
  /** Summaries, checks, memory and helper calls that ran behind the scenes. */
  backgroundCalls: number
  sessions: number
  input: number
  output: number
  cached: number
  cacheWrite: number
  /** input that was neither read from nor written to cache */
  fresh: number
  tokens: number
  cost: number
  /** Share of prompt tokens read from cache. */
  cacheHitRate: number
  unpricedTokens: number
  subscriptionTokens: number
  byAgent: Bucket[]
  byModel: ModelBucket[]
  byRoom: Bucket[]
}

function addTo<T extends Bucket>(map: Map<string, T>, key: string, make: () => T, row: UsageRow) {
  const bucket = map.get(key) ?? make()
  bucket.calls += row.calls
  bucket.tokens += row.input + row.output
  bucket.cost += row.cost
  map.set(key, bucket)
}

function ranked<T extends Bucket>(map: Map<string, T>, tokens: number, cost: number): T[] {
  return [...map.values()]
    .map((bucket) => ({
      ...bucket,
      share: tokens > 0 ? bucket.tokens / tokens : 0,
      costShare: cost > 0 ? bucket.cost / cost : 0,
    }))
    .sort((a, b) => b.tokens - a.tokens || b.cost - a.cost)
}

export function summarize(
  rows: readonly UsageRow[],
  prices: readonly PriceRow[],
  names: {
    agent: (id: string | null) => string
    room: (id: string | null) => string
  },
): UsageSummary {
  let replies = 0
  let backgroundCalls = 0
  let input = 0
  let output = 0
  let cached = 0
  let cacheWrite = 0
  let cost = 0
  let unpricedTokens = 0
  let subscriptionTokens = 0
  const sessions = new Set<string>()
  const agents = new Map<string, Bucket>()
  const models = new Map<string, ModelBucket>()
  const rooms = new Map<string, Bucket>()
  const empty = (key: string, label: string): Bucket => ({
    key,
    label,
    calls: 0,
    tokens: 0,
    cost: 0,
    share: 0,
    costShare: 0,
  })

  for (const row of rows) {
    if (row.kind === "llm") replies += row.calls
    else backgroundCalls += row.calls
    input += row.input
    output += row.output
    cached += row.cached
    cacheWrite += row.cacheWrite
    cost += row.cost
    if (row.sessionId) sessions.add(row.sessionId)
    else if (row.roomId) sessions.add(row.roomId)

    const state = priceState(row, prices)
    if (state === "unpriced") unpricedTokens += row.input + row.output
    if (state === "subscription") subscriptionTokens += row.input + row.output

    const agentKey = row.agentId ?? "none"
    addTo(agents, agentKey, () => empty(agentKey, names.agent(row.agentId)), row)
    const roomKey = row.roomId ?? row.sessionId ?? "none"
    addTo(rooms, roomKey, () => empty(roomKey, names.room(row.roomId)), row)
    const modelKey = `${row.provider}:${row.model}`
    addTo(
      models,
      modelKey,
      () => ({
        ...empty(modelKey, prettyModelName(row.model)),
        provider: row.provider,
        model: row.model,
        price: state,
      }),
      row,
    )
  }

  const tokens = input + output
  return {
    replies,
    backgroundCalls,
    sessions: sessions.size,
    input,
    output,
    cached,
    cacheWrite,
    fresh: Math.max(0, input - cached - cacheWrite),
    tokens,
    cost: Math.round(cost * 1e6) / 1e6,
    cacheHitRate: input > 0 ? cached / input : 0,
    unpricedTokens,
    subscriptionTokens,
    byAgent: ranked(agents, tokens, cost),
    byModel: ranked(models, tokens, cost),
    byRoom: ranked(rooms, tokens, cost),
  }
}

export interface SpeedSummary {
  /** Typical wait for the first word of a reply. */
  medianFirstWordMs: number | null
  /** Typical time for a whole reply. */
  medianReplyMs: number | null
  slowReplyMs: number | null
  measured: number
}

function quantile(values: number[], q: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? null
}

/** Speed only counts real replies; background calls have no one waiting on them. */
export function speed(rows: readonly UsageRow[]): SpeedSummary {
  const replies = rows.filter((row) => row.kind === "llm")
  const firstWord = replies.flatMap((row) => (row.ttftMs && row.ttftMs > 0 ? [row.ttftMs] : []))
  const whole = replies.flatMap((row) => (row.latencyMs && row.latencyMs > 0 ? [row.latencyMs] : []))
  return {
    medianFirstWordMs: quantile(firstWord, 0.5),
    medianReplyMs: quantile(whole, 0.5),
    slowReplyMs: quantile(whole, 0.95),
    measured: whole.length,
  }
}

export interface SeriesPoint {
  key: string
  label: string
  /** Full date for tooltips and screen readers. */
  longLabel: string
  values: Record<string, number>
  total: number
}

export interface SeriesResult {
  points: SeriesPoint[]
  series: { id: string; label: string }[]
}

const MAX_SERIES = 5

/**
 * One bar per local day (or per hour for the last 24 hours), from the start of the period to
 * now, so every call in the totals lands in some bar.
 */
export function timeSeries(
  rows: readonly UsageRow[],
  opts: {
    sinceIso: string
    hourly: boolean
    metric: "tokens" | "cost"
    groupBy: (row: UsageRow) => { id: string; label: string }
    /**
     * Which groups get their own colour, in colour order. Pass the same list for every metric
     * so an agent keeps its colour when the chart switches from tokens to spend.
     */
    keep?: readonly string[]
    now?: number
  },
): SeriesResult {
  const now = opts.now ?? Date.now()
  const points: SeriesPoint[] = []
  const start = new Date(opts.sinceIso)
  if (opts.hourly) {
    start.setMinutes(0, 0, 0)
    for (let t = start.getTime(); t <= now; t += 3_600_000) {
      const d = new Date(t)
      points.push({
        key: localHourKey(d),
        label: d.toLocaleTimeString([], { hour: "numeric" }),
        longLabel: d.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }),
        values: {},
        total: 0,
      })
    }
  } else {
    start.setHours(0, 0, 0, 0)
    for (let d = new Date(start); d.getTime() <= now; d.setDate(d.getDate() + 1)) {
      points.push({
        key: localDayKey(d),
        label: d.toLocaleDateString([], { day: "numeric", month: "short" }),
        longLabel: d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }),
        values: {},
        total: 0,
      })
    }
  }

  const byKey = new Map(points.map((point) => [point.key, point]))
  const totals = new Map<string, { label: string; value: number }>()
  const grouped: Array<{ point: SeriesPoint; id: string; value: number }> = []

  for (const row of rows) {
    if (!row.createdAt) continue
    const point = byKey.get(opts.hourly ? localHourKey(row.createdAt) : localDayKey(row.createdAt))
    if (!point) continue
    const value = opts.metric === "cost" ? row.cost : row.input + row.output
    if (value <= 0) continue
    const group = opts.groupBy(row)
    const entry = totals.get(group.id) ?? { label: group.label, value: 0 }
    entry.value += value
    totals.set(group.id, entry)
    grouped.push({ point, id: group.id, value })
  }

  const order = [...totals.entries()].sort((a, b) => b[1].value - a[1].value)
  const keepIds = (opts.keep ?? order.map(([id]) => id)).slice(0, MAX_SERIES)
  const kept = new Set(keepIds)
  const series = keepIds.flatMap((id) => {
    const entry = totals.get(id)
    return entry ? [{ id, label: entry.label }] : []
  })
  if (order.some(([id]) => !kept.has(id))) series.push({ id: "other", label: "Everything else" })

  for (const { point, id, value } of grouped) {
    const seriesId = kept.has(id) ? id : "other"
    point.values[seriesId] = (point.values[seriesId] ?? 0) + value
    point.total += value
  }
  return { points, series }
}

const WORD_CASE: Record<string, string> = {
  gpt: "GPT",
  oss: "OSS",
  llama: "Llama",
  qwen: "Qwen",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  claude: "Claude",
  mixtral: "Mixtral",
  mistral: "Mistral",
  grok: "Grok",
  kimi: "Kimi",
}

/** "claude-sonnet-4-5-20250929" → "Claude Sonnet 4.5", "openai/gpt-oss-120b" → "GPT OSS 120B". */
export function prettyModelName(model: string): string {
  const base = baseModelName(model)
  if (!base) return model
  const parts = base.split(/[-_\s]+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ""
    const prev = out[out.length - 1]
    if (/^\d{1,2}$/.test(part) && prev && /^\d+(\.\d+)?$/.test(prev) && !prev.includes(".")) {
      out[out.length - 1] = `${prev}.${part}`
    } else if (part === "gpt" && parts[i + 1] && /^\d/.test(parts[i + 1] ?? "")) {
      out.push(`GPT-${parts[i + 1]}`)
      i++
    } else if (/^\d+(\.\d+)?[bkm]$/i.test(part)) {
      out.push(part.toUpperCase())
    } else if (/^o\d/.test(part)) {
      out.push(part)
    } else {
      out.push(WORD_CASE[part] ?? (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    }
  }
  return out.join(" ")
}

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  gemini: "Google",
  groq: "Groq",
  cerebras: "Cerebras",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  xai: "xAI",
  mistral: "Mistral",
  "claude-code": "Claude Code",
  claude: "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity",
}

export function providerLabel(provider: string): string {
  const key = provider.toLowerCase().trim()
  return PROVIDER_LABELS[key] ?? (key ? key.charAt(0).toUpperCase() + key.slice(1) : "Unknown")
}
