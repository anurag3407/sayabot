import { NextResponse } from "next/server"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { requireRouteUser } from "@/lib/route-auth"
import { loadRoomBotModels, type RoomBotModel } from "@/lib/room-models"

export type { RoomBotModel }

export const dynamic = "force-dynamic"

/** The bots in one chat and the model each answers with there, for the chat's model picker. */
export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  const url = new URL(request.url)
  const slug = url.searchParams.get("org")?.trim()
  const roomId = url.searchParams.get("room")?.trim() ?? ""
  if (!slug || !/^[0-9a-f-]{36}$/i.test(roomId)) {
    return NextResponse.json({ error: "Which chat?" }, { status: 400 })
  }
  const access = await getOrgAccess(slug, { user: auth.user })
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const bots = await loadRoomBotModels(access.org.id, roomId)
  if (!bots) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Members see what a bot answers with; only admins change it (see setRoomAgentModelAction).
  return NextResponse.json(
    { bots, canEdit: isOrgAdmin(access.role) },
    { headers: { "cache-control": "private, no-store" } },
  )
}
