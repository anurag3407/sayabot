import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { createAdminClient } from "@/lib/supabase/admin"

/** The computer answers a remote request (WebRTC answer), declines it, or says it ended. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const admin = createAdminClient()
  const { data: session } = await admin.from("remote_sessions").select("id, host_id, status").eq("id", id).maybeSingle()
  if (!session || session.host_id !== host.id) return NextResponse.json({ error: "not found" }, { status: 404 })
  const now = new Date().toISOString()

  if (body.action === "answer" && typeof body.answer === "string" && body.answer.length < 100_000) {
    if (session.status !== "requested") return NextResponse.json({ error: "no longer waiting" }, { status: 409 })
    await admin.from("remote_sessions").update({ status: "answered", answer: body.answer, updated_at: now }).eq("id", id)
    return NextResponse.json({ ok: true })
  }
  if (body.action === "deny") {
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : "Declined on the computer"
    await admin.from("remote_sessions").update({ status: "denied", error: reason, updated_at: now, ended_at: now }).eq("id", id)
    return NextResponse.json({ ok: true })
  }
  if (body.action === "end" || body.action === "fail") {
    await admin
      .from("remote_sessions")
      .update({
        status: body.action === "end" ? "ended" : "failed",
        error: typeof body.reason === "string" ? body.reason.slice(0, 200) : null,
        updated_at: now,
        ended_at: now,
      })
      .eq("id", id)
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
