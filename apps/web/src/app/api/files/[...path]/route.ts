import { NextResponse } from "next/server"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Serves a chat attachment: only to people who can read its room (session cookie on the web,
 * bearer token on the phone), through a one-minute signed link.
 */
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params
  const [scope, roomId] = path
  if (scope !== "rooms" || !roomId || !/^[0-9a-f-]{36}$/i.test(roomId) || path.some((p) => p === ".." || p.includes("/"))) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { data: room } = await who.client.from("rooms").select("id").eq("id", roomId).maybeSingle()
  if (!room) return NextResponse.json({ error: "not found" }, { status: 404 })
  const { data, error } = await createAdminClient().storage.from("attachments").createSignedUrl(path.join("/"), 60)
  if (error || !data?.signedUrl) return NextResponse.json({ error: "not found" }, { status: 404 })
  return NextResponse.redirect(data.signedUrl, { status: 302, headers: { "cache-control": "private, max-age=30" } })
}
