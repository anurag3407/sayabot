/** Pure usage aggregation, shared by pages and unit tests. */

export interface UsageRollupRow {
  agent_id: string | null
  room_id: string | null
  provider: string
  model: string
  kind: string
  requests: number
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number
  cost_usd: number
  last_at: string | null
}

export interface AgentUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number
  costUsd: number
  lastAt: string | null
  /** The model this agent spent the most tokens on. */
  topModel: string | null
  byModel: Array<{ provider: string; model: string; requests: number; tokens: number; costUsd: number }>
}

export function usageByAgent(rows: readonly UsageRollupRow[]): Map<string, AgentUsage> {
  const out = new Map<string, AgentUsage>()
  const models = new Map<string, Map<string, { provider: string; model: string; requests: number; tokens: number; costUsd: number }>>()
  for (const row of rows) {
    if (!row.agent_id) continue
    const u = out.get(row.agent_id) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
      lastAt: null,
      topModel: null,
      byModel: [],
    }
    u.requests += row.requests
    u.inputTokens += row.input_tokens
    u.outputTokens += row.output_tokens
    u.cachedInputTokens += row.cached_input_tokens
    u.costUsd += row.cost_usd
    if (row.last_at && (!u.lastAt || row.last_at > u.lastAt)) u.lastAt = row.last_at
    out.set(row.agent_id, u)
    const perAgent = models.get(row.agent_id) ?? new Map()
    const key = `${row.provider}:${row.model}`
    const m = perAgent.get(key) ?? { provider: row.provider, model: row.model, requests: 0, tokens: 0, costUsd: 0 }
    m.requests += row.requests
    m.tokens += row.input_tokens + row.output_tokens
    m.costUsd += row.cost_usd
    perAgent.set(key, m)
    models.set(row.agent_id, perAgent)
  }
  for (const [agentId, u] of out) {
    const list = [...(models.get(agentId)?.values() ?? [])].sort((a, b) => b.tokens - a.tokens)
    u.byModel = list
    u.topModel = list[0]?.model ?? null
    u.costUsd = Math.round(u.costUsd * 1e6) / 1e6
  }
  return out
}

const pad = (n: number) => String(n).padStart(2, "0")

/** Calendar day in the viewer's own time zone ("2026-11-12"), so 1 AM IST isn't counted as yesterday. */
export function localDayKey(input: string | number | Date): string {
  const d = new Date(input)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local day + hour ("2026-11-12T01"). */
export function localHourKey(input: string | number | Date): string {
  const d = new Date(input)
  return `${localDayKey(d)}T${pad(d.getHours())}`
}
