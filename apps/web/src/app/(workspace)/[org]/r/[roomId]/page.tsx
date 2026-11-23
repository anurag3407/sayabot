import type { Metadata } from "next"
import { humanReadableCron } from "@sayabot/core"
import { requireRoomAccess } from "@/lib/auth"
import { devModelConfigured } from "@/lib/env"
import { listOrgAgents, listProviderKeys, loadRoomPageData } from "@/lib/queries"
import { loadUsageRollup } from "@/lib/usage"
import { usageByAgent } from "@/lib/usage-math"
import { RoomWorkspace } from "@/components/room/room-workspace"
import type {
  AgentUsageView,
  AlertMode,
  ConnectedAppView,
  MemoryNoteView,
  OrgSkillView,
} from "@/components/room/agent-config-panel"
import type { SetupState } from "@/components/room/setup-checklist"
import type { RoomRoutine } from "@/components/room/side-panel"
import { createSupabaseServerClient } from "@/lib/supabase/server"

function scheduleLabel(kind: string, expr: string): string {
  if (kind !== "cron") return expr
  try {
    return humanReadableCron(expr)
  } catch {
    return expr
  }
}

/** The routines that post into this chat, for the side panel's Routines tab. */
async function loadRoomRoutines(orgId: string, roomId: string): Promise<RoomRoutine[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("routines")
    .select(
      "id, name, schedule_expr, schedule_kind, enabled, next_run_at, last_status, agent_id, agent:agents!routines_agent_id_fkey ( display_name )",
    )
    .eq("org_id", orgId)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(20)
  return (data ?? []).map((row) => {
    const agent = Array.isArray(row.agent) ? row.agent[0] : row.agent
    return {
      id: row.id as string,
      name: row.name as string,
      schedule: scheduleLabel(row.schedule_kind as string, row.schedule_expr as string),
      enabled: row.enabled as boolean,
      nextRunAt: (row.next_run_at as string | null) ?? null,
      lastStatus: (row.last_status as string | null) ?? null,
      agentId: (row.agent_id as string | null) ?? null,
      agentName: (agent as { display_name?: string } | null)?.display_name ?? null,
    }
  })
}

async function loadOrgSkills(orgId: string): Promise<OrgSkillView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("skills")
    .select("id, slug, title, description")
    .eq("org_id", orgId)
    .in("visibility", ["org", "public"])
    .order("created_at", { ascending: false })
    .limit(40)
  if (!data) return []
  return data.map((row) => ({
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    description: (row.description as string | null) ?? "",
  }))
}

async function loadConnectedApps(orgId: string, agentIds: string[]): Promise<ConnectedAppView[]> {
  if (agentIds.length === 0) return []
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("agent_connector_grants")
    .select("agent_id, connector:workspace_connectors_public(name, source)")
    .eq("org_id", orgId)
    .in("agent_id", agentIds)
  if (!data) return []
  return data.flatMap((row) => {
    const connector = Array.isArray(row.connector) ? row.connector[0] : row.connector
    if (!connector) return []
    return [
      {
        agentId: row.agent_id as string,
        name: (connector.name as string) || (connector.source as string),
        source: connector.source as string,
      },
    ]
  })
}

async function loadMemoryNotes(orgId: string, agentIds: string[]): Promise<MemoryNoteView[]> {
  if (agentIds.length === 0) return []
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("memories")
    .select("id, agent_id, title, pinned")
    .eq("org_id", orgId)
    .in("agent_id", agentIds)
    .is("superseded_by", null)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(40)
  if (!data) return []
  return data.flatMap((row) => {
    const agentId = row.agent_id as string | null
    if (!agentId) return []
    return [
      {
        id: row.id as string,
        agentId,
        title: (row.title as string) || "Note",
        pinned: Boolean(row.pinned),
      },
    ]
  })
}

async function loadAgentUsage(
  orgId: string,
  agentIds: string[],
): Promise<Record<string, AgentUsageView>> {
  if (agentIds.length === 0) return {}
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const rows = await loadUsageRollup(orgId, since)
  if (!rows) return {}
  const byAgent = usageByAgent(rows)
  const usage: Record<string, AgentUsageView> = {}
  for (const agentId of agentIds) {
    const spent = byAgent.get(agentId)
    if (!spent) continue
    usage[agentId] = {
      requests: spent.requests,
      inputTokens: spent.inputTokens,
      outputTokens: spent.outputTokens,
      costUsd: spent.costUsd,
      topModel: spent.topModel,
    }
  }
  return usage
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string; roomId: string }>
}): Promise<Metadata> {
  const { org, roomId } = await params
  const access = await requireRoomAccess(org, roomId)
  return { title: access.room.name }
}

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; roomId: string }>
  searchParams: Promise<{ canvas?: string; m?: string; thread?: string; configure?: string }>
}) {
  const { org, roomId } = await params
  const { canvas, m, thread, configure } = await searchParams
  const access = await requireRoomAccess(org, roomId)
  const [data, routines, skills] = await Promise.all([
    loadRoomPageData(access),
    loadRoomRoutines(access.org.id, roomId),
    loadOrgSkills(access.org.id),
  ])
  const agentIds = data.roomAgents.map((item) => item.agent.id)
  const [apps, usage, memoryNotes] = await Promise.all([
    loadConnectedApps(access.org.id, agentIds),
    loadAgentUsage(access.org.id, agentIds),
    loadMemoryNotes(access.org.id, agentIds),
  ])
  const alerts = data.user.notifications as AlertMode

  let setup: SetupState | null = null
  // Direct chats with an agent always have their agent, and a person-to-person chat needs none.
  if (data.roomAgents.length === 0 && data.room.kind !== "dm") {
    const [keys, agents] = await Promise.all([
      data.canAdmin ? listProviderKeys(access.org.id) : Promise.resolve([]),
      listOrgAgents(access.org.id),
    ])
    setup = {
      canManage: data.canAdmin,
      hasModel: keys.length > 0 || devModelConfigured(),
      hasAgent: agents.length > 0,
      roomHasAgent: false,
      hasMessage: data.messages.some((message) => message.senderType === "human"),
    }
  }

  return (
    <RoomWorkspace
      key={roomId}
      data={data}
      initialCanvasId={canvas ?? null}
      focusMessageId={m ?? null}
      initialThreadId={thread ? (m ?? null) : null}
      setup={setup}
      routines={routines}
      initialConfigure={configure === "1"}
      skills={skills}
      apps={apps}
      usage={usage}
      alerts={alerts}
      sound={data.user.sound}
      memoryNotes={memoryNotes}
    />
  )
}
