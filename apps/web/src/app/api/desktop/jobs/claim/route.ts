import { openSecret } from "@sayabot/llm"
import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { getKek } from "@/lib/env"
import { macAllowRules } from "@/lib/mac-runner"
import { getPublicOrigin } from "@/lib/public-origin"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * The computer takes the oldest queued job for it. The status guard makes each job run once.
 * Claude Code and Codex jobs also carry Sayabot's room tools: the MCP address and a token for
 * this agent and room only, handed over once (the sealed copy is wiped on claim) and revoked
 * when the job ends.
 */
export async function POST(request: Request) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (!host.settings?.runnerEnabled) return NextResponse.json({ job: null })
  const admin = createAdminClient()
  const { data: next } = await admin
    .from("local_runner_jobs")
    .select("id, mcp_token_enc")
    .eq("host_id", host.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle()
  if (!next) return NextResponse.json({ job: null })
  const { data: job } = await admin
    .from("local_runner_jobs")
    .update({ status: "running", claimed_at: new Date().toISOString(), mcp_token_enc: null })
    .eq("id", next.id)
    .eq("status", "queued")
    .select("id, agent_id, room_id, prompt, app")
    .maybeSingle()
  if (!job) return NextResponse.json({ job: null })

  const [{ data: agent }, { data: room }] = await Promise.all([
    admin
      .from("agents")
      .select("handle, display_name, params")
      .eq("id", job.agent_id)
      .maybeSingle(),
    admin.from("rooms").select("id, name, orgs(slug)").eq("id", job.room_id).maybeSingle(),
  ])
  const params = (agent?.params as Record<string, unknown> | null) ?? {}
  const runner = (params.runner ?? {}) as Record<string, unknown>
  const app = job.app ?? (typeof runner.app === "string" ? runner.app : "claude-code")
  const orgSlug = (room?.orgs as { slug?: string } | null)?.slug ?? null

  let mcp: { url: string; token: string } | null = null
  if (typeof next.mcp_token_enc === "string" && next.mcp_token_enc) {
    try {
      mcp = {
        url: `${getPublicOrigin(request)}/api/v1/mcp`,
        token: openSecret(next.mcp_token_enc, getKek()),
      }
    } catch (error) {
      console.warn("[desktop-jobs] could not open the run's tool token", error)
    }
  }

  return NextResponse.json({
    job: {
      id: job.id,
      prompt: job.prompt,
      app,
      agentHandle: agent?.handle ?? "agent",
      agentName: agent?.display_name ?? agent?.handle ?? "Agent",
      mcp,
      allow: macAllowRules(params),
      room: room
        ? { id: room.id, name: room.name, path: orgSlug ? `/${orgSlug}/r/${room.id}` : null }
        : null,
    },
  })
}
