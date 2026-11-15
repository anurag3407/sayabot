import type { Metadata } from "next"
import { humanReadableCron } from "@sayabot/core"
import { requireRoomAccess } from "@/lib/auth"
import { devModelConfigured } from "@/lib/env"
import { listOrgAgents, listProviderKeys, loadRoomPageData } from "@/lib/queries"
import { RoomWorkspace } from "@/components/room/room-workspace"
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
    .select("id, name, schedule_expr, schedule_kind, enabled, next_run_at, last_status, agents ( display_name )")
    .eq("org_id", orgId)
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(20)
  return (data ?? []).map((row) => {
    const agent = Array.isArray(row.agents) ? row.agents[0] : row.agents
    return {
      id: row.id as string,
      name: row.name as string,
      schedule: scheduleLabel(row.schedule_kind as string, row.schedule_expr as string),
      enabled: row.enabled as boolean,
      nextRunAt: (row.next_run_at as string | null) ?? null,
      lastStatus: (row.last_status as string | null) ?? null,
      agentName: (agent as { display_name?: string } | null)?.display_name ?? null,
    }
  })
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
  searchParams: Promise<{ canvas?: string; m?: string; thread?: string }>
}) {
  const { org, roomId } = await params
  const { canvas, m, thread } = await searchParams
  const access = await requireRoomAccess(org, roomId)
  const [data, routines] = await Promise.all([
    loadRoomPageData(access),
    loadRoomRoutines(access.org.id, roomId),
  ])

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
    />
  )
}
