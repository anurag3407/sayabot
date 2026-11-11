import "server-only"
import { humanHandle } from "@/lib/human-handle"
import { toolCallFromRow, type RawToolCallRow } from "@/lib/message-map"
import { normalizeClient } from "@sayabot/core"
import { createAdminClient } from "@/lib/supabase/admin"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { listMemberViews, listOrgAgents } from "@/lib/queries"
import type {
  BotJoinRequestView,
  OwnerFactView,
  BotChatView,
  ChatListItem,
  FileView,
  InboxApprovalView,
  InboxDoneView,
  InboxRequestView,
  DecisionPacketView,
  TaskEventView,
  MeetingView,
  OrgAccess,
  RoomScheduleView,
  TaskCommentView,
  TaskView,
} from "@/lib/types"

interface RoomRow {
  id: string
  name: string
  kind: "public" | "private" | "dm"
  turn_mode: "mentions" | "debate" | "moderated"
  agent_dm_user_id: string | null
  agent_dm_agent_id: string | null
  timezone: string
}

async function readableRooms(orgId: string): Promise<RoomRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("rooms")
    .select(
      "id, name, kind, turn_mode, agent_dm_user_id, agent_dm_agent_id, timezone",
    )
    .eq("org_id", orgId)
  return (data ?? []) as RoomRow[]
}

export async function loadChatList(access: OrgAccess): Promise<{
  items: ChatListItem[]
  inboxCount: number
  rooms: RoomRow[]
}> {
  const supabase = await createSupabaseServerClient()
  const rooms = await readableRooms(access.org.id)
  if (!rooms.length) return { items: [], inboxCount: 0, rooms: [] }
  const roomIds = rooms.map((room) => room.id)
  const [readsRes, roomAgentsRes, messagesRes, approvalsRes, requestsRes] = await Promise.all([
    supabase
      .from("room_reads")
      .select("room_id, last_read_at, pinned, muted_until, archived")
      .eq("user_id", access.user.id)
      .in("room_id", roomIds),
    supabase
      .from("room_agents")
      .select("room_id, agents!inner(handle, display_name)")
      .in("room_id", roomIds),
    supabase
      .from("messages")
      .select("room_id, content, sender_type, sender_id, created_at, mentions")
      .in("room_id", roomIds)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("tool_calls")
      .select("id", { count: "exact", head: true })
      .in("room_id", roomIds)
      .eq("status", "pending_approval"),
    supabase
      .from("tasks")
      .select("id, fold_key, expires_at")
      .in("room_id", roomIds)
      .eq("kind", "request")
      .eq("status", "open"),
  ])

  const reads = new Map(
    ((readsRes.data ?? []) as {
      room_id: string
      last_read_at: string
      pinned: boolean
      muted_until: string | null
      archived: boolean
    }[]).map((row) => [row.room_id, row]),
  )
  const agentNames = new Map<string, string[]>()
  for (const row of (roomAgentsRes.data ?? []) as unknown as {
    room_id: string
    agents: { handle: string; display_name: string }
  }[]) {
    const list = agentNames.get(row.room_id) ?? []
    list.push(row.agents.display_name)
    agentNames.set(row.room_id, list)
  }

  const messages = (messagesRes.data ?? []) as {
    room_id: string
    content: string
    sender_type: "human" | "agent" | "system"
    sender_id: string | null
    created_at: string
    mentions: string[] | null
  }[]

  const agentSenderIds = [...new Set(messages.filter((m) => m.sender_type === "agent" && m.sender_id).map((m) => m.sender_id!))]
  const humanSenderIds = [...new Set(messages.filter((m) => m.sender_type === "human" && m.sender_id && m.sender_id !== access.user.id).map((m) => m.sender_id!))]
  const [agentsData, profilesData] = await Promise.all([
    agentSenderIds.length
      ? supabase.from("agents").select("id, handle, display_name").in("id", agentSenderIds)
      : Promise.resolve({ data: [] }),
    humanSenderIds.length
      ? supabase.from("profiles").select("id, display_name").in("id", humanSenderIds)
      : Promise.resolve({ data: [] }),
  ])
  const senderNames = new Map<string, string>()
  for (const row of (agentsData.data ?? []) as { id: string; handle: string; display_name: string }[]) {
    senderNames.set(row.id, `@${row.handle}`)
  }
  for (const row of (profilesData.data ?? []) as { id: string; display_name: string }[]) {
    senderNames.set(row.id, row.display_name)
  }

  const ownHandle = humanHandle(access.user.displayName)
  const items: ChatListItem[] = rooms.map((room) => {
    const read = reads.get(room.id)
    const lastRead = read ? new Date(read.last_read_at).getTime() : Number.POSITIVE_INFINITY
    const roomMessages = messages.filter((message) => message.room_id === room.id)
    let unread = 0
    let mentions = 0
    for (const message of roomMessages) {
      if (new Date(message.created_at).getTime() <= lastRead) continue
      if (message.sender_type === "human" && message.sender_id === access.user.id) continue
      unread++
      if ((message.mentions ?? []).includes(ownHandle) && message.sender_id !== access.user.id) mentions++
    }
    const last = roomMessages[0]
    let lastSender: string | null = null
    if (last) {
      if (last.sender_type === "system") lastSender = "system"
      else if (last.sender_type === "human" && last.sender_id === access.user.id) lastSender = "You"
      else lastSender = (last.sender_id && senderNames.get(last.sender_id)) ?? (last.sender_type === "human" ? "Someone" : "Agent")
    }
    return {
      id: room.id,
      name: room.name,
      kind: room.kind,
      turnMode: room.turn_mode,
      isBotDm: Boolean(room.agent_dm_agent_id),
      agentId: room.agent_dm_agent_id,
      agentNames: agentNames.get(room.id) ?? [],
      lastMessage: last ? last.content.replace(/\s+/g, " ").trim().slice(0, 120) : null,
      lastSender,
      lastAt: last?.created_at ?? null,
      unreadCount: unread,
      mentionCount: mentions,
      pinned: read?.pinned ?? false,
      mutedUntil: read?.muted_until ?? null,
      archived: read?.archived ?? false,
    }
  })
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return (b.lastAt ?? "").localeCompare(a.lastAt ?? "")
  })
  const nowIso = new Date().toISOString()
  const activeRequests = (
    (requestsRes.data ?? []) as { id: string; fold_key: string | null; expires_at: string | null }[]
  ).filter((r) => !r.expires_at || r.expires_at > nowIso)
  const distinctQuestions = new Set(activeRequests.map((r) => r.fold_key || r.id)).size
  const joinRequests = await countBotJoinRequests(roomIds)
  const inboxCount = (approvalsRes.count ?? 0) + distinctQuestions + joinRequests
  return { items, inboxCount, rooms }
}

export async function loadMeetings(access: OrgAccess): Promise<{
  rooms: RoomRow[]
  schedules: RoomScheduleView[]
  meetings: MeetingView[]
}> {
  const supabase = await createSupabaseServerClient()
  const rooms = await readableRooms(access.org.id)
  if (!rooms.length) return { rooms: [], schedules: [], meetings: [] }
  const roomIds = rooms.map((room) => room.id)
  const roomsById = new Map(rooms.map((room) => [room.id, room]))
  const [schedulesRes, meetingsRes] = await Promise.all([
    supabase.from("room_schedules").select("*").in("room_id", roomIds),
    supabase
      .from("meetings")
      .select("*")
      .in("room_id", roomIds)
      .gte("ends_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("starts_at", { ascending: true })
      .limit(150),
  ])
  const schedules = ((schedulesRes.data ?? []) as {
    room_id: string
    timezone: string
    morning_start_minutes: number
    morning_end_minutes: number
    evening_start_minutes: number
    evening_end_minutes: number
    checkins_enabled: boolean
    checkin_interval_minutes: number
    checkin_start_minutes: number
    checkin_end_minutes: number
    checkin_duration_minutes: number
    last_checkin_at: string | null
  }[]).map((row) => ({
    roomId: row.room_id,
    timezone: row.timezone,
    morningStartMinutes: row.morning_start_minutes,
    morningEndMinutes: row.morning_end_minutes,
    eveningStartMinutes: row.evening_start_minutes,
    eveningEndMinutes: row.evening_end_minutes,
    checkinsEnabled: row.checkins_enabled,
    checkinIntervalMinutes: row.checkin_interval_minutes,
    checkinStartMinutes: row.checkin_start_minutes,
    checkinEndMinutes: row.checkin_end_minutes,
    checkinDurationMinutes: row.checkin_duration_minutes,
    lastCheckinAt: row.last_checkin_at ?? null,
  }))
  const meetings = ((meetingsRes.data ?? []) as MeetingRow[]).map((row) => mapMeeting(row, roomsById.get(row.room_id)?.name ?? "room"))
  return { rooms, schedules, meetings }
}

interface MeetingRow {
  id: string
  org_id: string
  room_id: string
  kind: "meeting" | "checkin"
  title: string
  agenda: string
  starts_at: string
  ends_at: string
  status: "scheduled" | "active" | "ended" | "canceled"
  created_by: string | null
  prompt_message_id: string | null
  metadata: Record<string, unknown>
}

function mapMeeting(row: MeetingRow, roomName: string): MeetingView {
  return {
    id: row.id,
    orgId: row.org_id,
    roomId: row.room_id,
    roomName,
    kind: row.kind,
    title: row.title,
    agenda: row.agenda ?? "",
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: row.status,
    createdBy: row.created_by,
    promptMessageId: row.prompt_message_id,
    metadata: row.metadata ?? {},
  }
}

export async function loadTasks(access: OrgAccess): Promise<TaskView[]> {
  const supabase = await createSupabaseServerClient()
  const [tasksRes, rooms, agents, members] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("org_id", access.org.id)
      .order("updated_at", { ascending: false })
      .limit(300),
    readableRooms(access.org.id),
    listOrgAgents(access.org.id),
    listMemberViews(access.org.id),
  ])
  const taskRows = (tasksRes.data ?? []) as {
    id: string
    number: number
    org_id: string
    room_id: string
    kind: "task" | "request"
    title: string
    description: string
    status: "open" | "in_progress" | "stuck" | "done"
    assignee_user_id: string | null
    assignee_agent_id: string | null
    requested_by_agent_id: string | null
    requested_from_user_id: string | null
    due_at: string | null
    status_changed_at: string
    completed_at: string | null
    unblock_needs: string | null
    unblock_detail: string | null
    blocked_by: string[] | null
    outcome_kind: string | null
    outcome_ref: string | null
    fold_key: string | null
    asked_count: number
    expires_at: string | null
    metadata: Record<string, unknown>
    created_at: string
    updated_at: string
  }[]
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]))
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const memberNames = new Map(members.map((member) => [member.userId, member.displayName]))
  const [commentsRes, eventsRes, runsRes] = await Promise.all([
    taskRows.length
      ? supabase
          .from("task_comments")
          .select("id, task_id, author_type, author_id, content, created_at")
          .in("task_id", taskRows.map((task) => task.id))
          .order("created_at", { ascending: true })
          .limit(500)
      : Promise.resolve({ data: [] }),
    taskRows.length
      ? supabase
          .from("task_events")
          .select("id, task_id, actor_type, actor_id, from_status, to_status, reason, outcome_kind, outcome_ref, metadata, created_at")
          .in("task_id", taskRows.map((task) => task.id))
          .order("created_at", { ascending: true })
          .limit(1000)
      : Promise.resolve({ data: [] }),
    taskRows.length
      ? supabase
          .from("agent_runs")
          .select("task_id, cost_usd")
          .in("task_id", taskRows.map((task) => task.id))
      : Promise.resolve({ data: [] }),
  ])

  const commentsByTask = new Map<string, TaskCommentView[]>()
  for (const row of (commentsRes.data ?? []) as {
    id: string
    task_id: string
    author_type: string
    author_id: string | null
    content: string
    created_at: string
  }[]) {
    const list = commentsByTask.get(row.task_id) ?? []
    list.push({
      id: row.id,
      taskId: row.task_id,
      authorType: row.author_type,
      authorId: row.author_id,
      authorName:
        row.author_type === "agent" && row.author_id
          ? `@${agentsById.get(row.author_id)?.handle ?? "agent"}`
          : row.author_id
            ? memberNames.get(row.author_id) ?? "Someone"
            : "System",
      content: row.content,
      createdAt: row.created_at,
    })
    commentsByTask.set(row.task_id, list)
  }

  const eventsByTask = new Map<string, TaskEventView[]>()
  for (const row of (eventsRes.data ?? []) as {
    id: string
    task_id: string
    actor_type: "human" | "agent" | "system"
    actor_id: string | null
    from_status: string | null
    to_status: string
    reason: string | null
    outcome_kind: string | null
    outcome_ref: string | null
    metadata: Record<string, unknown>
    created_at: string
  }[]) {
    const list = eventsByTask.get(row.task_id) ?? []
    list.push({
      id: row.id,
      taskId: row.task_id,
      actorType: row.actor_type,
      actorId: row.actor_id,
      actorName:
        row.actor_type === "agent" && row.actor_id
          ? `@${agentsById.get(row.actor_id)?.handle ?? "agent"}`
          : row.actor_id
            ? memberNames.get(row.actor_id) ?? "Someone"
            : "System",
      fromStatus: row.from_status,
      toStatus: row.to_status,
      reason: row.reason,
      outcomeKind: row.outcome_kind,
      outcomeRef: row.outcome_ref,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
    })
    eventsByTask.set(row.task_id, list)
  }

  const taskStats = new Map<string, { runs: number; cost: number }>()
  for (const run of (runsRes.data ?? []) as { task_id: string | null; cost_usd: number | string | null }[]) {
    if (!run.task_id) continue
    const curr = taskStats.get(run.task_id) ?? { runs: 0, cost: 0 }
    curr.runs += 1
    curr.cost += Number(run.cost_usd || 0)
    taskStats.set(run.task_id, curr)
  }

  return taskRows.map((row) => {
    const agent = row.assignee_agent_id ? agentsById.get(row.assignee_agent_id) : null
    const requester = row.requested_by_agent_id ? agentsById.get(row.requested_by_agent_id) : null
    const stats = taskStats.get(row.id) ?? { runs: 0, cost: 0 }
    return {
      id: row.id,
      number: row.number,
      orgId: row.org_id,
      roomId: row.room_id,
      roomName: roomNames.get(row.room_id) ?? "room",
      kind: row.kind,
      title: row.title,
      description: row.description,
      status: row.status,
      assigneeUserId: row.assignee_user_id,
      assigneeName: row.assignee_user_id ? memberNames.get(row.assignee_user_id) ?? "Someone" : null,
      assigneeAgentId: row.assignee_agent_id,
      assigneeHandle: agent?.handle ?? null,
      requestedByAgentId: row.requested_by_agent_id,
      requestedByHandle: requester?.handle ?? null,
      requestedFromUserId: row.requested_from_user_id,
      dueAt: row.due_at,
      statusChangedAt: row.status_changed_at,
      completedAt: row.completed_at,
      unblockNeeds: row.unblock_needs,
      unblockDetail: row.unblock_detail,
      blockedBy: row.blocked_by ?? [],
      outcomeKind: row.outcome_kind,
      outcomeRef: row.outcome_ref,
      foldKey: row.fold_key,
      askedCount: row.asked_count ?? 1,
      expiresAt: row.expires_at,
      runsCount: stats.runs,
      costUsd: stats.cost,
      leadAgentId: (row as any).lead_agent_id ?? null,
      parentTaskId: (row as any).parent_task_id ?? null,
      budgetTurns: (row as any).budget_turns ?? null,
      budgetUsd: (row as any).budget_usd ?? null,
      turnsUsed: (row as any).turns_used ?? null,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      comments: commentsByTask.get(row.id) ?? [],
      events: eventsByTask.get(row.id) ?? [],
    }
  })
}

export async function loadInbox(access: OrgAccess): Promise<{
  approvals: InboxApprovalView[]
  requests: InboxRequestView[]
  packets: DecisionPacketView[]
  agedStuck: TaskView[]
  done: InboxDoneView[]
}> {
  const supabase = await createSupabaseServerClient()
  const rooms = await readableRooms(access.org.id)
  const roomIds = rooms.map((room) => room.id)
  if (!roomIds.length) return { approvals: [], requests: [], packets: [], agedStuck: [], done: [] }
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]))
  const agents = await listOrgAgents(access.org.id)
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const [approvalsRes, doneToolsRes, tasks] = await Promise.all([
    supabase
      .from("tool_calls")
      .select("id, run_id, room_id, message_id, tool_name, args, result, status, approved_by, resolved_at, error, created_at")
      .in("room_id", roomIds)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("tool_calls")
      .select("id, room_id, tool_name, status, resolved_at")
      .in("room_id", roomIds)
      .in("status", ["approved", "rejected", "error", "done"])
      .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(30),
    loadTasks(access),
  ])
  const toolRows = (approvalsRes.data ?? []) as RawToolCallRow[]
  const runIds = toolRows.map((row) => row.run_id).filter((id): id is string => Boolean(id))
  const runAgent = new Map<string, string>()
  if (runIds.length) {
    const { data } = await supabase.from("agent_runs").select("id, agent_id").in("id", runIds)
    for (const row of data ?? []) if (row.agent_id) runAgent.set(row.id, row.agent_id)
  }
  const approvals: InboxApprovalView[] = toolRows.map((row) => {
    const agentId = row.run_id ? runAgent.get(row.run_id) : undefined
    const agent = agentId ? agentsById.get(agentId) : undefined
    return {
      toolCall: toolCallFromRow(row),
      roomName: roomNames.get(row.room_id) ?? "room",
      agentHandle: agent?.handle ?? null,
      agentName: agent?.displayName ?? null,
    }
  })

  const nowIso = new Date().toISOString()
  const requests = tasks
    .filter((task) => task.kind === "request" && task.status !== "done" && (!task.expiresAt || task.expiresAt > nowIso))
    .map((task) => ({ task }))

  // Group open requests into decision packets by room
  const packetsMap = new Map<string, DecisionPacketView>()
  for (const req of requests) {
    let packet = packetsMap.get(req.task.roomId)
    if (!packet) {
      packet = {
        id: `packet-${req.task.roomId}`,
        roomId: req.task.roomId,
        roomName: req.task.roomName,
        requests: [],
      }
      packetsMap.set(req.task.roomId, packet)
    }
    packet.requests.push(req)
  }
  const packets = Array.from(packetsMap.values())

  // Aged stuck tasks (>72 hours in stuck status)
  const STUCK_ESCALATION_MS = 72 * 60 * 60 * 1000
  const nowMs = Date.now()
  const agedStuck = tasks.filter((task) => {
    if (task.kind !== "task" || task.status !== "stuck") return false
    const changedAt = task.statusChangedAt
      ? new Date(task.statusChangedAt).getTime()
      : new Date(task.updatedAt).getTime()
    return nowMs - changedAt > STUCK_ESCALATION_MS
  })

  const done: InboxDoneView[] = [
    ...((doneToolsRes.data ?? []) as {
      id: string
      room_id: string
      tool_name: string
      status: string
      resolved_at: string | null
    }[]).map((row) => ({
      id: row.id,
      kind: "approval" as const,
      label: `${row.tool_name} in ${roomNames.get(row.room_id) ?? "room"}`,
      status: row.status,
      resolvedAt: row.resolved_at ?? new Date().toISOString(),
    })),
    ...tasks
      .filter((task) => task.kind === "request" && task.status === "done")
      .map((task) => ({
        id: task.id,
        kind: "request" as const,
        label: task.title,
        status: "done",
        resolvedAt: task.updatedAt,
      })),
  ].slice(0, 30)

  return { approvals, requests, packets, agedStuck, done }
}

/** bot_invites is server-only, so it is read with the service role, scoped to rooms the person can read. */
async function countBotJoinRequests(roomIds: string[]): Promise<number> {
  if (!roomIds.length) return 0
  const { count } = await createAdminClient()
    .from("bot_invites")
    .select("id", { count: "exact", head: true })
    .in("room_id", roomIds)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
  return count ?? 0
}

export async function loadBotJoinRequests(access: OrgAccess): Promise<BotJoinRequestView[]> {
  const rooms = await readableRooms(access.org.id)
  if (!rooms.length) return []
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]))
  const { data } = await createAdminClient()
    .from("bot_invites")
    .select("id, room_id, name, request_name, request_app, request_about, requested_at, rejected_attempts")
    .in("room_id", rooms.map((room) => room.id))
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("requested_at", { ascending: false })
    .limit(50)
  return ((data ?? []) as {
    id: string
    room_id: string
    name: string | null
    request_name: string | null
    request_app: string | null
    request_about: string | null
    requested_at: string | null
    rejected_attempts: unknown[] | null
  }[]).map((row) => ({
    inviteId: row.id,
    roomId: row.room_id,
    roomName: roomNames.get(row.room_id) ?? "room",
    name: row.name || row.request_name || "A bot",
    appLabel: row.request_app ? normalizeClient(row.request_app).label : null,
    about: row.request_about,
    requestedAt: row.requested_at ?? new Date().toISOString(),
    rejectedAttempts: row.rejected_attempts?.length ?? 0,
  }))
}

export async function loadOwnerFacts(access: OrgAccess): Promise<OwnerFactView[]> {
  const supabase = await createSupabaseServerClient()
  const [rooms, agents] = await Promise.all([readableRooms(access.org.id), listOrgAgents(access.org.id)])
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]))
  const handles = new Map(agents.map((agent) => [agent.id, agent.handle]))
  const { data } = await supabase
    .from("owner_facts")
    .select("id, key, label, value, room_id, source, source_agent_id, note, updated_at")
    .eq("org_id", access.org.id)
    .order("updated_at", { ascending: false })
    .limit(300)
  return ((data ?? []) as {
    id: string
    key: string
    label: string
    value: string
    room_id: string | null
    source: OwnerFactView["source"]
    source_agent_id: string | null
    note: string | null
    updated_at: string
  }[]).map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    value: row.value,
    roomId: row.room_id,
    roomName: row.room_id ? (roomNames.get(row.room_id) ?? "a room") : null,
    source: row.source,
    sourceAgentHandle: row.source_agent_id ? (handles.get(row.source_agent_id) ?? null) : null,
    note: row.note,
    updatedAt: row.updated_at,
  }))
}

export async function loadFiles(access: OrgAccess): Promise<FileView[]> {
  const supabase = await createSupabaseServerClient()
  const rooms = await readableRooms(access.org.id)
  if (!rooms.length) return []
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]))
  const { data } = await supabase
    .from("canvases")
    .select("id, room_id, kind, title, language, snapshot_text, updated_at")
    .in("room_id", rooms.map((room) => room.id))
    .order("updated_at", { ascending: false })
    .limit(200)
  return ((data ?? []) as {
    id: string
    room_id: string
    kind: FileView["kind"]
    title: string
    language: string | null
    snapshot_text: string
    updated_at: string
  }[]).map((row) => ({
    id: row.id,
    roomId: row.room_id,
    roomName: roomNames.get(row.room_id) ?? "room",
    kind: row.kind,
    title: row.title,
    language: row.language,
    preview: row.snapshot_text.replace(/\s+/g, " ").trim().slice(0, 180),
    updatedAt: row.updated_at,
  }))
}

export async function loadBotChats(access: OrgAccess): Promise<BotChatView[]> {
  const supabase = await createSupabaseServerClient()
  const rooms = await readableRooms(access.org.id)
  if (!rooms.length) return []
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]))
  const agents = await listOrgAgents(access.org.id)
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]))
  const handles = new Set(agents.map((agent) => agent.handle.toLowerCase()))
  const { data } = await supabase
    .from("messages")
    .select("id, room_id, sender_id, content, mentions, created_at")
    .in("room_id", rooms.map((room) => room.id))
    .eq("sender_type", "agent")
    .order("created_at", { ascending: false })
    .limit(300)
  const byRoom = new Map<string, BotChatView["messages"]>()
  for (const row of (data ?? []) as {
    id: string
    room_id: string
    sender_id: string | null
    content: string
    mentions: string[] | null
    created_at: string
  }[]) {
    const sender = row.sender_id ? agentsById.get(row.sender_id) : null
    if (!sender) continue
    const mentioned = (row.mentions ?? []).filter(
      (mention) => handles.has(mention.toLowerCase()) && mention.toLowerCase() !== sender.handle.toLowerCase(),
    )
    if (!mentioned.length) continue
    const list = byRoom.get(row.room_id) ?? []
    if (list.length >= 20) continue
    list.push({
      id: row.id,
      senderHandle: sender.handle,
      senderName: sender.displayName,
      content: row.content,
      mentions: mentioned,
      createdAt: row.created_at,
    })
    byRoom.set(row.room_id, list)
  }
  return [...byRoom.entries()]
    .map(([roomId, messages]) => ({
      roomId,
      roomName: roomNames.get(roomId) ?? "room",
      messages: messages.slice().reverse(),
      lastAt: messages[0]?.createdAt ?? new Date(0).toISOString(),
    }))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
}

export async function loadRoomSchedule(roomId: string): Promise<RoomScheduleView | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from("room_schedules").select("*").eq("room_id", roomId).maybeSingle()
  if (!data) return null
  return {
    roomId: data.room_id,
    timezone: data.timezone,
    morningStartMinutes: data.morning_start_minutes,
    morningEndMinutes: data.morning_end_minutes,
    eveningStartMinutes: data.evening_start_minutes,
    eveningEndMinutes: data.evening_end_minutes,
    checkinsEnabled: data.checkins_enabled,
    checkinIntervalMinutes: data.checkin_interval_minutes,
    checkinStartMinutes: data.checkin_start_minutes,
    checkinEndMinutes: data.checkin_end_minutes,
    checkinDurationMinutes: data.checkin_duration_minutes,
    lastCheckinAt: data.last_checkin_at ?? null,
  }
}

export type { RoomRow }

export interface MessageSearchResult {
  id: string
  roomId: string
  roomName: string
  threadRootId: string | null
  senderName: string
  content: string
  createdAt: string
}

const SEARCH_LIMIT = 50

/** Case-insensitive search over the rooms this user can read, enforced by Row Level Security. */
export async function searchMessages(
  access: OrgAccess,
  query: string,
): Promise<MessageSearchResult[]> {
  const supabase = await createSupabaseServerClient()
  const rooms = await readableRooms(access.org.id)
  if (!rooms.length) return []
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]))
  const pattern = `%${query.replace(/[\\%_]/g, (match) => `\\${match}`)}%`
  const { data } = await supabase
    .from("messages")
    .select("id, room_id, thread_root_id, sender_type, sender_id, content, created_at")
    .in("room_id", rooms.map((room) => room.id))
    .neq("sender_type", "system")
    .ilike("content", pattern)
    .order("created_at", { ascending: false })
    .limit(SEARCH_LIMIT)
  const rows = (data ?? []) as {
    id: string
    room_id: string
    thread_root_id: string | null
    sender_type: string
    sender_id: string | null
    content: string
    created_at: string
  }[]
  const [members, agents] = await Promise.all([
    listMemberViews(access.org.id),
    listOrgAgents(access.org.id),
  ])
  const names = new Map<string, string>([
    ...members.map((member) => [member.userId, member.displayName] as [string, string]),
    ...agents.map((agent) => [agent.id, agent.displayName] as [string, string]),
  ])
  return rows.map((row) => ({
    id: row.id,
    roomId: row.room_id,
    roomName: roomNames.get(row.room_id) ?? "room",
    threadRootId: row.thread_root_id,
    senderName: (row.sender_id && names.get(row.sender_id)) || "Unknown",
    content: row.content,
    createdAt: row.created_at,
  }))
}
