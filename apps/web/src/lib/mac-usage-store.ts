import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { macUsageModel, tokensForMacJob } from "@/lib/mac-usage"

interface MacJobRow {
  agent_id: string | null
  room_id: string | null
  app: string | null
  model: string | null
  output: string | null
  created_at: string
}

/**
 * Writes one usage_events row for a finished Mac job, under the app and model that ran
 * (GitHub Copilot "auto", not the server's last API model). Safe to call twice: the
 * job's start time is the event time, and a row already at that time is left alone.
 */
export async function recordMacJobUsage(
  job: MacJobRow,
  extra?: { output?: string; usage?: unknown; model?: unknown },
): Promise<void> {
  const provider = (job.app ?? "").trim()
  const agentId = job.agent_id
  if (!provider || !agentId || !job.created_at) return
  const output = extra?.output ?? job.output ?? ""
  const tokens = tokensForMacJob(extra?.usage, output)
  if (!tokens) return
  const model = macUsageModel(extra?.model, job.model)

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("org_id")
    .eq("id", agentId)
    .maybeSingle()
  const orgId = (agent as { org_id?: string } | null)?.org_id
  if (!orgId) return

  const { data: existing } = await admin
    .from("usage_events")
    .select("id")
    .eq("agent_id", agentId)
    .eq("provider", provider)
    .eq("created_at", job.created_at)
    .limit(1)
  if (existing && existing.length > 0) return

  const { error } = await admin.from("usage_events").insert({
    org_id: orgId,
    room_id: job.room_id,
    agent_id: agentId,
    provider,
    model,
    input_tokens: tokens.inputTokens,
    output_tokens: tokens.outputTokens,
    cached_input_tokens: tokens.cachedInputTokens,
    kind: "llm",
    cost_usd: 0,
    created_at: job.created_at,
  })
  if (error) console.error("[usage] could not record a Mac reply", error.message)
}

/**
 * Fills in usage for Mac replies that finished before this was recorded.
 * Called when the Usage page opens, so a refresh shows Copilot and the other Mac apps.
 */
export async function backfillMacUsage(orgId: string, sinceIso: string): Promise<void> {
  const admin = createAdminClient()
  const { data: agents } = await admin.from("agents").select("id").eq("org_id", orgId)
  const ids = ((agents ?? []) as Array<{ id: string }>).map((agent) => agent.id)
  if (!ids.length) return

  const { data: jobs } = await admin
    .from("local_runner_jobs")
    .select("agent_id, room_id, app, model, output, created_at")
    .in("agent_id", ids)
    .eq("status", "done")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(200)
  const rows = (jobs ?? []) as MacJobRow[]
  if (!rows.length) return

  const { data: existing } = await admin
    .from("usage_events")
    .select("agent_id, provider, created_at")
    .eq("org_id", orgId)
    .gte("created_at", sinceIso)
  const stamp = (value: string) => {
    const time = Date.parse(value)
    return Number.isNaN(time) ? value : String(time)
  }
  const seen = new Set(
    (
      (existing ?? []) as Array<{ agent_id: string | null; provider: string; created_at: string }>
    ).map((row) => `${row.agent_id}|${row.provider}|${stamp(row.created_at)}`),
  )

  const inserts = []
  for (const job of rows) {
    const provider = (job.app ?? "").trim()
    if (!provider || !job.agent_id) continue
    const tokens = tokensForMacJob(null, job.output ?? "")
    if (!tokens) continue
    const key = `${job.agent_id}|${provider}|${stamp(job.created_at)}`
    if (seen.has(key)) continue
    seen.add(key)
    inserts.push({
      org_id: orgId,
      room_id: job.room_id,
      agent_id: job.agent_id,
      provider,
      model: macUsageModel(null, job.model),
      input_tokens: tokens.inputTokens,
      output_tokens: tokens.outputTokens,
      cached_input_tokens: 0,
      kind: "llm",
      cost_usd: 0,
      created_at: job.created_at,
    })
  }
  if (!inserts.length) return
  const { error } = await admin.from("usage_events").insert(inserts)
  if (error) console.error("[usage] could not fill in Mac replies", error.message)
}
