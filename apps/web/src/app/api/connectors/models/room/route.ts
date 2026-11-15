import { NextResponse } from "next/server"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { agentModelUse } from "@/lib/model-catalog"
import { requireRouteUser } from "@/lib/route-auth"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export interface RoomBotModel {
  id: string
  handle: string
  displayName: string
  /** Invited agents answer with their own app's model; the picker can't change it. */
  editable: boolean
  /** The bot's own model, in the picker's terms. */
  bot: { keyId: string | null; model: string | null; effort: string | null }
  /** This chat's own pick ("only this chat"), or null when the chat follows the bot. */
  chat: { keyId: string | null; model: string | null; effort: string | null } | null
}

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
  const admin = createAdminClient()
  const { data: room } = await admin.from("rooms").select("id, org_id").eq("id", roomId).maybeSingle()
  if (!room || room.org_id !== access.org.id) return NextResponse.json({ error: "Not found" }, { status: 404 })
  // Members see what a bot answers with; only admins change it (see setRoomAgentModelAction).
  const { data: rows } = await admin
    .from("room_agents")
    .select("position, model_override, agents(id, handle, display_name, kind, provider_key_id, model, params)")
    .eq("room_id", room.id)
    .order("position")
  const bots: RoomBotModel[] = []
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const agent = row.agents as Record<string, unknown> | null
    if (!agent) continue
    const params = (agent.params as Record<string, unknown> | null) ?? {}
    const use = agentModelUse({
      params,
      providerKeyId: (agent.provider_key_id as string | null) ?? null,
      model: (agent.model as string | null) ?? null,
    } as Parameters<typeof agentModelUse>[0])
    const override = row.model_override as Record<string, unknown> | null
    bots.push({
      id: String(agent.id),
      handle: String(agent.handle),
      displayName: String(agent.display_name ?? agent.handle),
      editable: agent.kind === "llm",
      bot: { ...use, effort: typeof params.effort === "string" ? params.effort : null },
      chat:
        override && typeof override === "object"
          ? {
              keyId: typeof override.keyId === "string" ? override.keyId : null,
              model: typeof override.model === "string" ? override.model : null,
              effort: typeof override.effort === "string" ? override.effort : null,
            }
          : null,
    })
  }
  return NextResponse.json(
    { bots, canEdit: isOrgAdmin(access.role) },
    { headers: { "cache-control": "private, no-store" } },
  )
}
