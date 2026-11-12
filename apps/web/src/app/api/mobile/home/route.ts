import { NextResponse } from "next/server"
import { getOrgAccess } from "@/lib/auth"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"
import { usageByAgent, type UsageRollupRow } from "@/lib/usage-math"

export const dynamic = "force-dynamic"

/**
 * Everything the phone's home screen needs in one round trip: chats with their last message
 * and unread count, agents with live status and 30-day usage, and what's waiting on you.
 */
export async function GET(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const url = new URL(request.url)
  const requested = url.searchParams.get("orgSlug") ?? ""

  // Fall back to the person's first workspace when the phone doesn't know one yet.
  let access = requested ? await getOrgAccess(requested, { client: who.client, user: who.user }) : null
  const { data: memberships } = await who.client
    .from("org_members")
    .select("org_id, orgs!inner(slug, name)")
    .eq("user_id", who.user.id)
  const orgs = ((memberships ?? []) as unknown as { org_id: string; orgs: { slug: string; name: string } }[]).map((m) => ({
    id: m.org_id,
    slug: m.orgs.slug,
    name: m.orgs.name,
  }))
  if (!access && orgs[0]) access = await getOrgAccess(orgs[0].slug, { client: who.client, user: who.user })
  if (!access) return NextResponse.json({ error: "no workspace" }, { status: 404 })
  const c = who.client

  const { data: roomRows } = await c
    .from("rooms")
    .select("id, name, kind, agent_dm_agent_id, created_at")
    .eq("org_id", access.org.id)
  const rooms = (roomRows ?? []) as { id: string; name: string; kind: string; agent_dm_agent_id: string | null; created_at: string }[]
  const roomIds = rooms.map((r) => r.id)
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()

  const [agentsRes, roomAgentsRes, readsRes, messagesRes, requestsRes, approvalsRes, runsRes, rollupRes] = await Promise.all([
    c.from("agents").select("id, handle, display_name, kind, model, params, bio").eq("org_id", access.org.id),
    roomIds.length ? c.from("room_agents").select("room_id, agent_id").in("room_id", roomIds) : Promise.resolve({ data: [] }),
    roomIds.length ? c.from("room_reads").select("room_id, last_read_at, pinned, muted_until, archived").eq("user_id", who.user.id).in("room_id", roomIds) : Promise.resolve({ data: [] }),
    roomIds.length
      ? c
          .from("messages")
          .select("room_id, content, sender_type, sender_id, status, created_at, metadata")
          .in("room_id", roomIds)
          .is("thread_root_id", null)
          .order("created_at", { ascending: false })
          .limit(600)
      : Promise.resolve({ data: [] }),
    roomIds.length
      ? c.from("tasks").select("id, room_id, expires_at").in("room_id", roomIds).eq("kind", "request").eq("status", "open")
      : Promise.resolve({ data: [] }),
    roomIds.length
      ? c.from("tool_calls").select("id", { count: "exact", head: true }).in("room_id", roomIds).eq("status", "pending_approval")
      : Promise.resolve({ count: 0 }),
    roomIds.length
      ? createAdminClient()
          .from("agent_runs")
          .select("agent_id, room_id, status, created_at")
          .in("room_id", roomIds)
          .eq("status", "running")
          .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString())
      : Promise.resolve({ data: [] }),
    c.rpc("usage_rollup", { p_org: access.org.id, p_since: since }),
  ])

  const agents = (agentsRes.data ?? []) as { id: string; handle: string; display_name: string; kind: string; model: string | null; params: Record<string, unknown> | null; bio: string | null }[]
  const agentById = new Map(agents.map((a) => [a.id, a]))
  const working = new Map<string, string>() // agentId -> roomId
  for (const run of (runsRes.data ?? []) as { agent_id: string; room_id: string }[]) working.set(run.agent_id, run.room_id)
  const usage = usageByAgent(((rollupRes as { data?: unknown }).data ?? []) as UsageRollupRow[])

  const reads = new Map(((readsRes.data ?? []) as { room_id: string; last_read_at: string; pinned: boolean; muted_until: string | null; archived: boolean }[]).map((r) => [r.room_id, r]))
  const roomAgents = new Map<string, string[]>()
  for (const ra of (roomAgentsRes.data ?? []) as { room_id: string; agent_id: string }[]) {
    roomAgents.set(ra.room_id, [...(roomAgents.get(ra.room_id) ?? []), ra.agent_id])
  }
  const lastByRoom = new Map<string, { content: string; sender_type: string; sender_id: string | null; status: string; created_at: string; metadata: Record<string, unknown> | null }>()
  const unread = new Map<string, number>()
  for (const m of (messagesRes.data ?? []) as { room_id: string; content: string; sender_type: string; sender_id: string | null; status: string; created_at: string; metadata: Record<string, unknown> | null }[]) {
    if (!lastByRoom.has(m.room_id)) lastByRoom.set(m.room_id, m)
    const read = reads.get(m.room_id)
    if (m.sender_id !== who.user.id && (!read || m.created_at > read.last_read_at)) unread.set(m.room_id, (unread.get(m.room_id) ?? 0) + 1)
  }
  const nowIso = new Date().toISOString()
  const openQuestions = ((requestsRes.data ?? []) as { room_id: string; expires_at: string | null }[]).filter((r) => !r.expires_at || r.expires_at > nowIso)
  const questionsByRoom = new Map<string, number>()
  for (const q of openQuestions) questionsByRoom.set(q.room_id, (questionsByRoom.get(q.room_id) ?? 0) + 1)

  const chatRows = rooms
    .filter((r) => !reads.get(r.id)?.archived)
    .map((r) => {
      const last = lastByRoom.get(r.id)
      const ids = r.kind === "dm" && r.agent_dm_agent_id ? [r.agent_dm_agent_id] : (roomAgents.get(r.id) ?? [])
      const workingHere = ids.find((id) => working.get(id) === r.id)
      const senderName =
        last?.sender_type === "agent"
          ? String(last.metadata?.agentName ?? agentById.get(last.sender_id ?? "")?.display_name ?? "Agent")
          : last?.sender_type === "human"
            ? last.sender_id === who.user.id
              ? "You"
              : "Someone"
            : null
      return {
        id: r.id,
        name: r.kind === "dm" && r.agent_dm_agent_id ? (agentById.get(r.agent_dm_agent_id)?.display_name ?? r.name) : r.name,
        kind: r.kind,
        agentIds: ids,
        pinned: Boolean(reads.get(r.id)?.pinned),
        muted: Boolean(reads.get(r.id)?.muted_until && reads.get(r.id)!.muted_until! > nowIso),
        unread: unread.get(r.id) ?? 0,
        questions: questionsByRoom.get(r.id) ?? 0,
        workingAgentId: workingHere ?? null,
        lastMessage: last
          ? { preview: last.content.replace(/\s+/g, " ").slice(0, 140), senderName, at: last.created_at, streaming: last.status === "streaming" }
          : null,
        updatedAt: last?.created_at ?? r.created_at,
      }
    })
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt))

  return NextResponse.json(
    {
      org: { slug: access.org.slug, name: access.org.name },
      orgs,
      user: { id: who.user.id, name: access.user.displayName, email: access.user.email },
      needsYou: { questions: openQuestions.length, approvals: (approvalsRes as { count?: number | null }).count ?? 0 },
      chats: chatRows,
      agents: agents.map((a) => {
        const u = usage.get(a.id)
        const runner = (a.params?.runner ?? null) as { app?: string } | null
        return {
          id: a.id,
          handle: a.handle,
          name: a.display_name,
          kind: a.kind,
          about: a.bio,
          model: runner?.app ? `${runner.app} on your computer` : (a.model ?? (a.kind === "external" ? "Its own app" : "Default model")),
          workingRoomId: working.get(a.id) ?? null,
          usage: u
            ? { tokens: u.inputTokens + u.outputTokens, runs: u.requests, costUsd: u.costUsd, lastAt: u.lastAt, topModel: u.topModel }
            : null,
          roomIds: [...roomAgents.entries()].filter(([, ids]) => ids.includes(a.id)).map(([rid]) => rid),
        }
      }),
    },
    { headers: { "cache-control": "no-store" } },
  )
}
