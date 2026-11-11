import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { createAdminClient } from "@/lib/supabase/admin"

const MAX_OUTPUT = 100_000

/**
 * The computer streams a job's output (cumulative) and finally marks it done or failed.
 * If the room stopped the turn, the reply says cancelled so the computer kills the app.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const admin = createAdminClient()
  const { data: job } = await admin.from("local_runner_jobs").select("id, host_id, status").eq("id", id).maybeSingle()
  if (!job || job.host_id !== host.id) return NextResponse.json({ error: "not found" }, { status: 404 })
  if (job.status !== "running") return NextResponse.json({ cancelled: true })

  const update: Record<string, unknown> = {}
  if (typeof body.output === "string") update.output = body.output.slice(-MAX_OUTPUT)
  if (body.status === "done" || body.status === "failed") {
    update.status = body.status
    update.finished_at = new Date().toISOString()
    if (typeof body.error === "string") update.error = body.error.slice(0, 1_000)
  }
  if (Object.keys(update).length) await admin.from("local_runner_jobs").update(update).eq("id", id).eq("status", "running")
  return NextResponse.json({ ok: true })
}
