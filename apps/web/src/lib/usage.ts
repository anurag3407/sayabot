import "server-only"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import type { UsageRollupRow } from "@/lib/usage-math"

export { usageByAgent, type AgentUsage, type UsageRollupRow } from "@/lib/usage-math"

/**
 * Usage numbers people can trust. Totals come from a database rollup (exact, however many
 * calls there were); charts use the newest raw events, paged past the API's row cap.
 */


export interface RawUsageEvent {
  agent_id: string | null
  room_id: string | null
  provider: string
  model: string
  kind?: string | null
  input_tokens: number
  output_tokens: number
  cached_input_tokens: number | null
  cost_usd: number | string
  ttft_ms: number | null
  latency_ms: number | null
  created_at: string
}

const PAGE = 1_000
export const EVENT_SAMPLE_CAP = 20_000

/** null when the rollup function isn't installed yet (migration 0022 not applied). */
export async function loadUsageRollup(orgId: string, sinceIso: string): Promise<UsageRollupRow[] | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.rpc("usage_rollup", { p_org: orgId, p_since: sinceIso })
  if (error) return null
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    agent_id: (r.agent_id as string | null) ?? null,
    room_id: (r.room_id as string | null) ?? null,
    provider: String(r.provider ?? ""),
    model: String(r.model ?? ""),
    kind: String(r.kind ?? "llm"),
    requests: Number(r.requests) || 0,
    input_tokens: Number(r.input_tokens) || 0,
    output_tokens: Number(r.output_tokens) || 0,
    cached_input_tokens: Number(r.cached_input_tokens) || 0,
    cost_usd: Number(r.cost_usd) || 0,
    last_at: (r.last_at as string | null) ?? null,
  }))
}

/** Newest first, paged past the 1,000-row API cap, then returned oldest first for charts. */
export async function loadRecentUsageEvents(
  orgId: string,
  sinceIso: string,
  cap = EVENT_SAMPLE_CAP,
): Promise<{ events: RawUsageEvent[]; complete: boolean }> {
  const supabase = await createSupabaseServerClient()
  const events: RawUsageEvent[] = []
  let complete = false
  for (let from = 0; from < cap; from += PAGE) {
    const { data, error } = await supabase
      .from("usage_events")
      .select(
        "agent_id, room_id, provider, model, kind, input_tokens, output_tokens, cached_input_tokens, cost_usd, ttft_ms, latency_ms, created_at",
      )
      .eq("org_id", orgId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, Math.min(from + PAGE, cap) - 1)
    if (error) break
    const page = (data ?? []) as RawUsageEvent[]
    events.push(...page)
    if (page.length < PAGE) {
      complete = true
      break
    }
  }
  return { events: events.reverse(), complete }
}

