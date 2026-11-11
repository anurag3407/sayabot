import { canOpenHost, hostOnline } from "@sayabot/core"
import { NextResponse } from "next/server"
import { orgRoleOf, type HostRow } from "@/lib/desktop-hosts"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"

/** A viewer asks to open a computer. The WebRTC offer waits here until the computer answers. */
export async function POST(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  if (typeof body.hostId !== "string" || typeof body.offer !== "string" || body.offer.length > 100_000) {
    return NextResponse.json({ error: "hostId and offer are required" }, { status: 400 })
  }
  const admin = createAdminClient()
  const { data } = await admin.from("desktop_hosts").select("*").eq("id", body.hostId).maybeSingle()
  const host = data as HostRow | null
  if (!host || host.revoked_at) return NextResponse.json({ error: "Computer not found" }, { status: 404 })
  const allowed = canOpenHost({
    ownerId: host.user_id,
    viewerId: who.user.id,
    hostOrgId: host.org_id,
    whoCanControl: host.settings?.whoCanControl,
    viewerOrgRole: await orgRoleOf(who.user.id, host.org_id),
  })
  if (!allowed) return NextResponse.json({ error: "You don't have access to this computer" }, { status: 403 })
  if (!hostOnline(host.last_seen_at)) {
    return NextResponse.json({ error: "That computer is offline. Open the Sayabot app on it." }, { status: 409 })
  }
  const { data: session, error } = await admin
    .from("remote_sessions")
    .insert({ host_id: host.id, viewer_user_id: who.user.id, offer: body.offer, control: body.control === true })
    .select("id")
    .single()
  if (error || !session) return NextResponse.json({ error: error?.message ?? "could not start" }, { status: 500 })
  return NextResponse.json({ id: session.id })
}
