import { askItemsFromMetadata } from "@sayabot/core"
import { NextResponse } from "next/server"
import { getOrgAccess } from "@/lib/auth"
import { userFromRequest } from "@/lib/route-bearer"

export const dynamic = "force-dynamic"

/** The phone's Inbox: agent questions waiting on this person, newest first. */
export async function GET(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const orgSlug = new URL(request.url).searchParams.get("orgSlug") ?? ""
  const access = await getOrgAccess(orgSlug, { client: who.client, user: who.user })
  if (!access) return NextResponse.json({ error: "workspace not found" }, { status: 404 })

  const { data: rooms } = await who.client.from("rooms").select("id, name").eq("org_id", access.org.id)
  const roomNames = new Map(((rooms ?? []) as { id: string; name: string }[]).map((r) => [r.id, r.name]))
  if (!roomNames.size) return NextResponse.json({ questions: [], approvals: 0 })

  const nowIso = new Date().toISOString()
  const [tasksRes, approvalsRes] = await Promise.all([
    who.client
      .from("tasks")
      .select("id, number, room_id, title, description, asked_count, updated_at, expires_at, requested_by_agent_id, metadata")
      .in("room_id", [...roomNames.keys()])
      .eq("kind", "request")
      .eq("status", "open")
      .order("updated_at", { ascending: false })
      .limit(50),
    who.client
      .from("tool_calls")
      .select("id", { count: "exact", head: true })
      .in("room_id", [...roomNames.keys()])
      .eq("status", "pending_approval"),
  ])
  const rows = ((tasksRes.data ?? []) as {
    id: string
    number: number
    room_id: string
    title: string
    description: string
    asked_count: number | null
    updated_at: string
    expires_at: string | null
    requested_by_agent_id: string | null
    metadata: Record<string, unknown>
  }[]).filter((t) => !t.expires_at || t.expires_at > nowIso)

  const agentIds = [...new Set(rows.map((r) => r.requested_by_agent_id).filter((id): id is string => Boolean(id)))]
  const { data: agents } = agentIds.length
    ? await who.client.from("agents").select("id, handle, display_name").in("id", agentIds)
    : { data: [] }
  const agentById = new Map(((agents ?? []) as { id: string; handle: string; display_name: string }[]).map((a) => [a.id, a]))

  return NextResponse.json(
    {
      questions: rows.map((t) => {
        const agent = t.requested_by_agent_id ? agentById.get(t.requested_by_agent_id) : undefined
        const options = Array.isArray(t.metadata?.options)
          ? (t.metadata.options as unknown[]).filter((o): o is string => typeof o === "string")
          : []
        return {
          id: t.id,
          roomId: t.room_id,
          roomName: roomNames.get(t.room_id) ?? "room",
          title: t.title,
          description: t.description,
          agentHandle: agent?.handle ?? null,
          agentName: agent?.display_name ?? agent?.handle ?? "An agent",
          askedCount: t.asked_count ?? 1,
          updatedAt: t.updated_at,
          options,
          items: askItemsFromMetadata(t.metadata).map((i) => ({
            key: i.key,
            question: i.question,
            hint: i.hint ?? null,
            options: i.options ?? [],
            answer: i.answer ?? null,
          })),
        }
      }),
      approvals: approvalsRes.count ?? 0,
    },
    { headers: { "cache-control": "no-store" } },
  )
}
