import { NextResponse } from "next/server"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"

async function ownSession(request: Request, id: string) {
  const who = await userFromRequest(request)
  if (!who) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) }
  const { data } = await createAdminClient()
    .from("remote_sessions")
    .select("id, viewer_user_id, status, answer, error")
    .eq("id", id)
    .maybeSingle()
  if (!data || data.viewer_user_id !== who.user.id) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) }
  return { session: data }
}

/** The viewer polls for the computer's answer. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await ownSession(request, id)
  if ("error" in result) return result.error
  const s = result.session
  return NextResponse.json({ status: s.status, answer: s.status === "answered" ? s.answer : null, error: s.error })
}

/** The viewer hangs up. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await ownSession(request, id)
  if ("error" in result) return result.error
  const now = new Date().toISOString()
  await createAdminClient().from("remote_sessions").update({ status: "ended", updated_at: now, ended_at: now }).eq("id", id)
  return NextResponse.json({ ok: true })
}
