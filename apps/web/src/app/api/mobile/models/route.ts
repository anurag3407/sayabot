import { NextResponse } from "next/server"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { loadWorkspaceModels } from "@/lib/model-catalog"
import { refreshModelSources } from "@/lib/model-refresh"
import { userFromRequest } from "@/lib/route-bearer"
import { loadAgentPickerModel, loadRoomBotModels, writeAgentModel, writeRoomAgentModel } from "@/lib/room-models"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const UUID = /^[0-9a-f-]{36}$/i

function hostOf(request: Request): string | null {
  return request.headers.get("x-forwarded-host") ?? request.headers.get("host")
}

/**
 * The phone's model picker: the same catalog as the web title bar, plus the bots in one chat
 * (`roomId`) or one agent's own model (`agentId`).
 */
export async function GET(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(request.url)
  const slug = url.searchParams.get("orgSlug")?.trim() ?? ""
  const roomId = url.searchParams.get("roomId")?.trim() ?? ""
  const agentId = url.searchParams.get("agentId")?.trim() ?? ""
  if (!slug) return NextResponse.json({ error: "Which workspace?" }, { status: 400 })
  if (roomId && !UUID.test(roomId)) return NextResponse.json({ error: "Which chat?" }, { status: 400 })
  if (agentId && !UUID.test(agentId)) return NextResponse.json({ error: "Which agent?" }, { status: 400 })
  const access = await getOrgAccess(slug, { client: who.client, user: who.user })
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const host = hostOf(request)
  if (url.searchParams.get("refresh") === "1") {
    await refreshModelSources({ userId: who.user.id, host, forceCatalog: isOrgAdmin(access.role) })
  }
  try {
    const { groups } = await loadWorkspaceModels({ access, host })
    const bots = roomId
      ? await loadRoomBotModels(access.org.id, roomId)
      : agentId
        ? await loadAgentPickerModel(access.org.id, agentId).then((bot) => (bot ? [bot] : null))
        : []
    if (bots === null) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(
      { groups, bots, canEdit: isOrgAdmin(access.role) },
      { headers: { "cache-control": "private, no-store" } },
    )
  } catch (error) {
    console.error("[mobile/models] could not build the model list", error)
    return NextResponse.json({ error: "Could not load the model list" }, { status: 500 })
  }
}

/** Saves a pick: a chat override when `roomId` is set, otherwise the agent's default model. */
export async function POST(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  const orgSlug = typeof body.orgSlug === "string" ? body.orgSlug.trim() : ""
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : ""
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : ""
  if (!orgSlug || !UUID.test(agentId)) return NextResponse.json({ error: "Which agent?" }, { status: 400 })
  if (roomId && !UUID.test(roomId)) return NextResponse.json({ error: "Which chat?" }, { status: 400 })
  const access = await getOrgAccess(orgSlug, { client: who.client, user: who.user })
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isOrgAdmin(access.role)) {
    return NextResponse.json({ ok: false, error: "Only workspace admins can change models." }, { status: 403 })
  }
  const keyId = typeof body.keyId === "string" ? body.keyId : null
  const model = typeof body.model === "string" ? body.model : null
  const effort = body.effort === undefined ? undefined : typeof body.effort === "string" ? body.effort : null
  const scope = body.scope === "default" ? "default" : "chat"
  const result = roomId
    ? await writeRoomAgentModel({
        access,
        requestHost: hostOf(request),
        roomId,
        agentId,
        scope,
        keyId,
        model,
        effort,
        clear: body.clear === true,
      })
    : await writeAgentModel({
        access,
        requestHost: hostOf(request),
        agentId,
        providerKeyId: keyId,
        model,
        effort,
      })
  return NextResponse.json(result.ok ? { ok: true, message: result.message } : { ok: false, error: result.error }, {
    status: result.ok ? 200 : 400,
  })
}
