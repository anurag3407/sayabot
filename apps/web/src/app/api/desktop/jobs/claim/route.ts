import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { createAdminClient } from "@/lib/supabase/admin"

/** The computer takes the oldest queued job for it. The status guard makes each job run once. */
export async function POST(request: Request) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  if (!host.settings?.runnerEnabled) return NextResponse.json({ job: null })
  const admin = createAdminClient()
  const { data: next } = await admin
    .from("local_runner_jobs")
    .select("id")
    .eq("host_id", host.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle()
  if (!next) return NextResponse.json({ job: null })
  const { data: job } = await admin
    .from("local_runner_jobs")
    .update({ status: "running", claimed_at: new Date().toISOString() })
    .eq("id", next.id)
    .eq("status", "queued")
    .select("id, agent_id, prompt")
    .maybeSingle()
  if (!job) return NextResponse.json({ job: null })
  const { data: agent } = await admin.from("agents").select("handle, params").eq("id", job.agent_id).maybeSingle()
  const runner = ((agent?.params as Record<string, unknown> | null)?.runner ?? {}) as Record<string, unknown>
  return NextResponse.json({
    job: {
      id: job.id,
      prompt: job.prompt,
      app: typeof runner.app === "string" ? runner.app : "claude-code",
      agentHandle: agent?.handle ?? "agent",
    },
  })
}
