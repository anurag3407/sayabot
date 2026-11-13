import { NextResponse } from "next/server"
import { getOrgAccess } from "@/lib/auth"
import { userFromRequest } from "@/lib/route-bearer"
import { usageByAgent, type UsageRollupRow } from "@/lib/usage-math"

export const dynamic = "force-dynamic"

/**
 * Usage for the phone: exact totals (database rollup) plus a per-day series in the phone's own
 * time zone (tzOffset = minutes, as JavaScript's getTimezoneOffset gives it).
 */
export async function GET(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(request.url)
  const access = await getOrgAccess(url.searchParams.get("orgSlug") ?? "", { client: who.client, user: who.user })
  if (!access) return NextResponse.json({ error: "workspace not found" }, { status: 404 })
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days"))) ? Number(url.searchParams.get("days")) : 30
  const tzOffset = Math.max(-840, Math.min(840, Number(url.searchParams.get("tzOffset")) || 0))
  const since = new Date(Date.now() - days * 86_400_000).toISOString()

  const { data: rollupData } = await who.client.rpc("usage_rollup", { p_org: access.org.id, p_since: since })
  const rollup = ((rollupData ?? []) as Record<string, unknown>[]).map((r) => ({
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
  })) satisfies UsageRollupRow[]

  // Daily series from raw events, paged past the API row cap (newest first, up to 20k).
  const byDay = new Map<string, { tokens: number; cost: number; runs: number }>()
  for (let from = 0; from < 20_000; from += 1_000) {
    const { data, error } = await who.client
      .from("usage_events")
      .select("input_tokens, output_tokens, cost_usd, created_at")
      .eq("org_id", access.org.id)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .range(from, from + 999)
    if (error) break
    for (const e of (data ?? []) as { input_tokens: number; output_tokens: number; cost_usd: number | string; created_at: string }[]) {
      const local = new Date(new Date(e.created_at).getTime() - tzOffset * 60_000).toISOString().slice(0, 10)
      const b = byDay.get(local) ?? { tokens: 0, cost: 0, runs: 0 }
      b.tokens += (e.input_tokens || 0) + (e.output_tokens || 0)
      b.cost += Number(e.cost_usd) || 0
      b.runs += 1
      byDay.set(local, b)
    }
    if ((data ?? []).length < 1_000) break
  }
  const series: Array<{ day: string; tokens: number; cost: number; runs: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.now() - tzOffset * 60_000 - i * 86_400_000).toISOString().slice(0, 10)
    series.push({ day, ...(byDay.get(day) ?? { tokens: 0, cost: 0, runs: 0 }) })
  }

  const { data: agents } = await who.client.from("agents").select("id, handle, display_name").eq("org_id", access.org.id)
  const names = new Map(((agents ?? []) as { id: string; handle: string; display_name: string }[]).map((a) => [a.id, a]))
  const perAgent = [...usageByAgent(rollup).entries()]
    .map(([id, u]) => ({ id, handle: names.get(id)?.handle ?? "agent", name: names.get(id)?.display_name ?? "Agent", tokens: u.inputTokens + u.outputTokens, runs: u.requests, costUsd: u.costUsd }))
    .sort((a, b) => b.tokens - a.tokens)
  const models = new Map<string, { model: string; provider: string; tokens: number; costUsd: number }>()
  for (const r of rollup) {
    const k = `${r.provider}:${r.model}`
    const m = models.get(k) ?? { model: r.model, provider: r.provider, tokens: 0, costUsd: 0 }
    m.tokens += r.input_tokens + r.output_tokens
    m.costUsd += r.cost_usd
    models.set(k, m)
  }
  return NextResponse.json(
    {
      days,
      totals: {
        tokens: rollup.reduce((n, r) => n + r.input_tokens + r.output_tokens, 0),
        costUsd: Math.round(rollup.reduce((n, r) => n + r.cost_usd, 0) * 100) / 100,
        runs: rollup.reduce((n, r) => n + r.requests, 0),
        cachedTokens: rollup.reduce((n, r) => n + r.cached_input_tokens, 0),
      },
      series,
      agents: perAgent,
      models: [...models.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 8),
    },
    { headers: { "cache-control": "no-store" } },
  )
}
