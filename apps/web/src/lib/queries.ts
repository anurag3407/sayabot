import "server-only"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { openSecret } from "@sayabot/llm"
import { getKek } from "@/lib/env"
import type {
  AgentApiKeyView,
  AgentView,
  AuditLogView,
  CanvasView,
  MemberView,
  MessageView,
  OrgToolConfigView,
  PricingView,
  McpServerView,
  ProviderKeyView,
  RoomAgentView,
  RoomPageData,
  RoomRole,
  RoomView,
  SessionView,
  ToolCallView,
  WebhookDeliveryView,
} from "@/lib/types"
import type { RoomAccess } from "@/lib/types"

export interface RoomListItem {
  id: string
  name: string
  kind: RoomView["kind"]
  turnMode: RoomView["turnMode"]
}

export async function listRooms(orgId: string): Promise<RoomListItem[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("rooms")
    .select("id, name, kind, turn_mode")
    .eq("org_id", orgId)
    .order("kind", { ascending: true })
    .order("name", { ascending: true })
  return ((data ?? []) as {
    id: string
    name: string
    kind: RoomListItem["kind"]
    turn_mode: RoomListItem["turnMode"]
  }[]).map((r) => ({ id: r.id, name: r.name, kind: r.kind, turnMode: r.turn_mode }))
}

export async function loadRoomPageData(access: RoomAccess): Promise<RoomPageData> {
  const supabase = await createSupabaseServerClient()
  const roomId = access.room.id
  const [messagesRes, toolsRes, roomAgentsRes, canvasesRes, membersRes, sessionRes, threadRowsRes, activeMeetingRes, nextMeetingRes, scheduleRes, readRes, roomMembersRes] =
    await Promise.all([
      supabase
        .from("messages")
        .select(
          "id, room_id, thread_root_id, sender_type, sender_id, content, status, mentions, run_id, metadata, created_at",
        )
        .eq("room_id", roomId)
        .is("thread_root_id", null)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("tool_calls")
        .select(
          "id, run_id, room_id, message_id, tool_name, args, result, status, approved_by, resolved_at, error, created_at",
        )
        .eq("room_id", roomId)
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("room_agents")
        .select(
          "position, agents!inner(id, org_id, handle, display_name, kind, provider_key_id, model, system_prompt, params, tool_ids, webhook_url, created_at)",
        )
        .eq("room_id", roomId)
        .order("position", { ascending: true }),
      supabase
        .from("canvases")
        .select("id, room_id, kind, title, language, snapshot_text, updated_at")
        .eq("room_id", roomId)
        .order("created_at", { ascending: true }),
      supabase
        .from("org_members")
        .select("user_id, role, profiles!inner(display_name, avatar_url)")
        .eq("org_id", access.org.id),
      supabase
        .from("turn_sessions")
        .select("id, thread_root_id, state, queue")
        .eq("room_id", roomId)
        .eq("state", "active")
        .is("thread_root_id", null)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("messages")
        .select("thread_root_id")
        .eq("room_id", roomId)
        .not("thread_root_id", "is", null)
        .limit(1_000),
      supabase
        .from("meetings")
        .select("*")
        .eq("room_id", roomId)
        .eq("status", "active")
        .order("starts_at", { ascending: false })
        .limit(1),
      supabase
        .from("meetings")
        .select("*")
        .eq("room_id", roomId)
        .eq("status", "scheduled")
        .gte("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(1),
      supabase.from("room_schedules").select("*").eq("room_id", roomId).maybeSingle(),
      supabase
        .from("room_reads")
        .select("last_read_at")
        .eq("room_id", roomId)
        .eq("user_id", access.user.id)
        .maybeSingle(),
      supabase.from("room_members").select("user_id").eq("room_id", roomId),
    ])

  const rawMessages = ((messagesRes.data ?? []) as {
    id: string
    room_id: string
    thread_root_id: string | null
    sender_type: MessageView["senderType"]
    sender_id: string | null
    content: string
    status: MessageView["status"]
    mentions: string[]
    run_id: string | null
    metadata: Record<string, unknown>
    created_at: string
  }[]).reverse()

  const roomAgents: RoomAgentView[] = ((roomAgentsRes.data ?? []) as unknown as {
    position: number
    agents: {
      id: string
      org_id: string
      handle: string
      display_name: string
      kind: AgentView["kind"]
      provider_key_id: string | null
      model: string | null
      system_prompt: string
      params: Record<string, unknown>
      tool_ids: string[]
      webhook_url: string | null
      created_at: string
    }
  }[]).map((row) => ({
    position: row.position,
    agent: {
      id: row.agents.id,
      orgId: row.agents.org_id,
      handle: row.agents.handle,
      displayName: row.agents.display_name,
      kind: row.agents.kind,
      providerKeyId: row.agents.provider_key_id,
      model: row.agents.model,
      systemPrompt: row.agents.system_prompt,
      params: row.agents.params ?? {},
      toolIds: row.agents.tool_ids ?? [],
      webhookUrl: row.agents.webhook_url,
      createdAt: row.agents.created_at,
    },
  }))

  const members: MemberView[] = ((membersRes.data ?? []) as unknown as {
    user_id: string
    role: MemberView["role"]
    profiles: { display_name: string; avatar_url: string | null }
  }[]).map((row) => ({
    userId: row.user_id,
    displayName: row.profiles.display_name,
    avatarUrl: row.profiles.avatar_url,
    role: row.role,
  }))

  const agentMap = new Map(roomAgents.map(({ agent }) => [agent.id, agent]))
  const memberMap = new Map(members.map((m) => [m.userId, m]))
  const extraAgentIds = [
    ...new Set(
      rawMessages
        .filter((m) => m.sender_type === "agent" && m.sender_id && !agentMap.has(m.sender_id))
        .map((m) => m.sender_id as string),
    ),
  ]
  if (extraAgentIds.length) {
    const { data: extraAgents } = await supabase
      .from("agents")
      .select("id, org_id, handle, display_name, kind, provider_key_id, model, system_prompt, params, tool_ids, webhook_url, created_at")
      .in("id", extraAgentIds)
    for (const row of extraAgents ?? []) {
      agentMap.set(row.id, {
        id: row.id,
        orgId: row.org_id,
        handle: row.handle,
        displayName: row.display_name,
        kind: row.kind,
        providerKeyId: row.provider_key_id,
        model: row.model,
        systemPrompt: row.system_prompt,
        params: row.params ?? {},
        toolIds: row.tool_ids ?? [],
        webhookUrl: row.webhook_url,
        createdAt: row.created_at,
      })
    }
  }

  const extraHumanIds = [
    ...new Set(
      rawMessages
        .filter((m) => m.sender_type === "human" && m.sender_id && !memberMap.has(m.sender_id))
        .map((m) => m.sender_id as string),
    ),
  ]
  const extraHumans = new Map<string, { displayName: string; avatarUrl: string | null }>()
  if (extraHumanIds.length) {
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", extraHumanIds)
    for (const row of data ?? []) {
      extraHumans.set(row.id, { displayName: row.display_name, avatarUrl: row.avatar_url })
    }
  }

  const messages: MessageView[] = rawMessages.map((m) => {
    const agent = m.sender_id ? agentMap.get(m.sender_id) : undefined
    const human = m.sender_id ? memberMap.get(m.sender_id) : undefined
    const extraHuman = m.sender_id ? extraHumans.get(m.sender_id) : undefined
    return {
      id: m.id,
      roomId: m.room_id,
      threadRootId: m.thread_root_id,
      senderType: m.sender_type,
      senderId: m.sender_id,
      content: m.content,
      status: m.status,
      mentions: m.mentions ?? [],
      runId: m.run_id,
      metadata: m.metadata ?? {},
      createdAt: m.created_at,
      senderName:
        m.sender_type === "system"
          ? "system"
          : agent?.displayName ?? human?.displayName ?? extraHuman?.displayName ?? "unknown",
      senderHandle: agent?.handle ?? null,
    }
  })

  const memberAvatars: Record<string, string> = {}
  for (const member of members) {
    if (member.avatarUrl) memberAvatars[member.userId] = member.avatarUrl
  }
  for (const [id, human] of extraHumans) {
    if (human.avatarUrl) memberAvatars[id] = human.avatarUrl
  }

  const toolCalls: ToolCallView[] = ((toolsRes.data ?? []) as unknown as {
    id: string
    run_id: string | null
    room_id: string
    message_id: string | null
    tool_name: string
    args: Record<string, unknown>
    result: unknown
    status: ToolCallView["status"]
    approved_by: string | null
    resolved_at: string | null
    error: string | null
    created_at: string
  }[]).map((row) => ({
    id: row.id,
    runId: row.run_id,
    roomId: row.room_id,
    messageId: row.message_id,
    toolName: row.tool_name,
    args: row.args ?? {},
    result: row.result,
    status: row.status,
    approvedBy: row.approved_by,
    resolvedAt: row.resolved_at,
    error: row.error,
    createdAt: row.created_at,
  }))

  const canvases: CanvasView[] = ((canvasesRes.data ?? []) as {
    id: string
    room_id: string
    kind: CanvasView["kind"]
    title: string
    language: string | null
    snapshot_text: string
    updated_at: string
  }[]).map((row) => ({
    id: row.id,
    roomId: row.room_id,
    kind: row.kind,
    title: row.title,
    language: row.language,
    snapshotText: row.snapshot_text,
    updatedAt: row.updated_at,
  }))

  const sessionRow = (sessionRes.data ?? [])[0] as
    | { id: string; thread_root_id: string | null; state: string; queue: { agentId: string; role: string }[] }
    | undefined
  const activeSession: SessionView | null = sessionRow
    ? {
        id: sessionRow.id,
        threadRootId: sessionRow.thread_root_id,
        state: sessionRow.state,
        queue: sessionRow.queue ?? [],
      }
    : null

  const activeMeetingRow = (activeMeetingRes.data ?? [])[0]
  const nextMeetingRow = (nextMeetingRes.data ?? [])[0]
  const meetingRow = activeMeetingRow ?? nextMeetingRow
  const meeting = meetingRow
    ? {
        id: meetingRow.id,
        orgId: meetingRow.org_id,
        roomId: meetingRow.room_id,
        roomName: access.room.name,
        kind: meetingRow.kind as "meeting" | "checkin",
        title: meetingRow.title,
        agenda: meetingRow.agenda ?? "",
        startsAt: meetingRow.starts_at,
        endsAt: meetingRow.ends_at,
        status: meetingRow.status as "scheduled" | "active" | "ended" | "canceled",
        createdBy: meetingRow.created_by ?? null,
        promptMessageId: meetingRow.prompt_message_id ?? null,
        metadata: meetingRow.metadata ?? {},
      }
    : null
  const scheduleRow = scheduleRes.data
  const roomSchedule = scheduleRow
    ? {
        roomId: scheduleRow.room_id,
        timezone: scheduleRow.timezone,
        morningStartMinutes: scheduleRow.morning_start_minutes,
        morningEndMinutes: scheduleRow.morning_end_minutes,
        eveningStartMinutes: scheduleRow.evening_start_minutes,
        eveningEndMinutes: scheduleRow.evening_end_minutes,
        checkinsEnabled: scheduleRow.checkins_enabled,
        checkinIntervalMinutes: scheduleRow.checkin_interval_minutes,
        checkinStartMinutes: scheduleRow.checkin_start_minutes,
        checkinEndMinutes: scheduleRow.checkin_end_minutes,
        checkinDurationMinutes: scheduleRow.checkin_duration_minutes,
        lastCheckinAt: scheduleRow.last_checkin_at ?? null,
      }
    : null

  const threadCounts: Record<string, number> = {}
  for (const row of (threadRowsRes.data ?? []) as { thread_root_id: string | null }[]) {
    if (!row.thread_root_id) continue
    threadCounts[row.thread_root_id] = (threadCounts[row.thread_root_id] ?? 0) + 1
  }

  return {
    room: access.room,
    roomRole: access.roomRole,
    canAdmin: access.canAdmin,
    user: access.user,
    org: access.org,
    orgRole: access.orgRole,
    messages,
    toolCalls,
    roomAgents,
    canvases,
    members: members.map((member) => ({ ...member, avatarUrl: null })),
    memberAvatars,
    activeSession,
    threadCounts,
    meeting,
    roomSchedule,
    lastReadAt: (readRes.data as { last_read_at: string } | null)?.last_read_at ?? null,
    roomMemberIds: ((roomMembersRes.data ?? []) as { user_id: string }[]).map((row) => row.user_id),
  }
}

export async function listRoomAgents(roomId: string): Promise<RoomAgentView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("room_agents")
    .select(
      "position, agents!inner(id, org_id, handle, display_name, kind, provider_key_id, model, system_prompt, params, tool_ids, webhook_url, created_at)",
    )
    .eq("room_id", roomId)
    .order("position", { ascending: true })
  return ((data ?? []) as unknown as {
    position: number
    agents: {
      id: string
      org_id: string
      handle: string
      display_name: string
      kind: AgentView["kind"]
      provider_key_id: string | null
      model: string | null
      system_prompt: string
      params: Record<string, unknown>
      tool_ids: string[]
      webhook_url: string | null
      created_at: string
    }
  }[]).map((row) => ({
    position: row.position,
    agent: {
      id: row.agents.id,
      orgId: row.agents.org_id,
      handle: row.agents.handle,
      displayName: row.agents.display_name,
      kind: row.agents.kind,
      providerKeyId: row.agents.provider_key_id,
      model: row.agents.model,
      systemPrompt: row.agents.system_prompt,
      params: row.agents.params ?? {},
      toolIds: row.agents.tool_ids ?? [],
      webhookUrl: row.agents.webhook_url,
      createdAt: row.agents.created_at,
    },
  }))
}

export async function listOrgAgents(orgId: string): Promise<AgentView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("agents")
    .select(
      "id, org_id, handle, display_name, kind, provider_key_id, model, system_prompt, params, tool_ids, webhook_url, created_at",
    )
    .eq("org_id", orgId)
    .order("handle")
  return ((data ?? []) as {
    id: string
    org_id: string
    handle: string
    display_name: string
    kind: AgentView["kind"]
    provider_key_id: string | null
    model: string | null
    system_prompt: string
    params: Record<string, unknown>
    tool_ids: string[]
    webhook_url: string | null
    created_at: string
  }[]).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    handle: row.handle,
    displayName: row.display_name,
    kind: row.kind,
    providerKeyId: row.provider_key_id,
    model: row.model,
    systemPrompt: row.system_prompt,
    params: row.params ?? {},
    toolIds: row.tool_ids ?? [],
    webhookUrl: row.webhook_url,
    createdAt: row.created_at,
  }))
}

export async function listProviderKeys(orgId: string): Promise<ProviderKeyView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("provider_keys_public")
    .select("id, provider, base_url, label, last4, created_at")
    .eq("org_id", orgId)
    .order("created_at")
  return ((data ?? []) as {
    id: string
    provider: string
    base_url: string | null
    label: string
    last4: string
    created_at: string
  }[]).map((row) => ({
    id: row.id,
    provider: row.provider,
    baseUrl: row.base_url,
    label: row.label,
    last4: row.last4,
    createdAt: row.created_at,
  }))
}

export async function listMcpServers(orgId: string): Promise<McpServerView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("mcp_servers")
    .select("id, org_id, room_id, name, transport, url, dangerous_tools, enabled, created_at")
    .eq("org_id", orgId)
    .order("name")
  return ((data ?? []) as {
    id: string
    org_id: string
    room_id: string | null
    name: string
    transport: "http" | "sse"
    url: string
    dangerous_tools: string[]
    enabled: boolean
    created_at: string
  }[]).map((row) => ({
    id: row.id,
    orgId: row.org_id,
    roomId: row.room_id,
    name: row.name,
    transport: row.transport,
    url: row.url,
    dangerousTools: row.dangerous_tools ?? [],
    enabled: row.enabled,
    createdAt: row.created_at,
  }))
}

export async function listOrgToolConfigs(orgId: string): Promise<OrgToolConfigView[]> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("org_tool_configs")
    .select("id, org_id, tool, config_enc, enabled, updated_at")
    .eq("org_id", orgId)
  if (!data) return []
  let kek = ""
  try {
    kek = getKek()
  } catch {}
  return data.map((row) => {
    let provider: string | undefined
    let last4: string | undefined
    let baseUrl: string | undefined
    if (kek && row.config_enc) {
      try {
        const parsed = JSON.parse(openSecret(row.config_enc, kek))
        provider = parsed.provider
        baseUrl = parsed.baseUrl
        if (parsed.apiKey) last4 = parsed.apiKey.slice(-4)
        else if (parsed.token) last4 = parsed.token.slice(-4)
      } catch {}
    }
    return {
      id: row.id,
      orgId: row.org_id,
      tool: row.tool,
      enabled: row.enabled,
      provider,
      last4,
      baseUrl,
      updatedAt: row.updated_at,
    }
  })
}

export async function listAgentApiKeys(orgId: string): Promise<AgentApiKeyView[]> {
  const supabase = createAdminClient()
  const { data: agents } = await supabase.from("agents").select("id").eq("org_id", orgId)
  const ids = (agents ?? []).map((a) => a.id)
  if (!ids.length) return []
  const { data } = await supabase
    .from("agent_api_keys")
    .select("id, agent_id, prefix, label, scopes, revoked_at, last_used_at, created_at")
    .in("agent_id", ids)
    .order("created_at", { ascending: false })
  return ((data ?? []) as {
    id: string
    agent_id: string
    prefix: string
    label: string
    scopes: string[]
    revoked_at: string | null
    last_used_at: string | null
    created_at: string
  }[]).map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    prefix: row.prefix,
    label: row.label,
    scopes: row.scopes ?? [],
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }))
}

export async function listWebhookDeliveries(orgId: string): Promise<WebhookDeliveryView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("webhook_deliveries")
    .select("id, agent_id, message_id, attempt, status_code, response_ms, error, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50)
  return ((data ?? []) as {
    id: string
    agent_id: string | null
    message_id: string | null
    attempt: number
    status_code: number | null
    response_ms: number | null
    error: string | null
    created_at: string
  }[]).map((row) => ({
    id: row.id,
    agentId: row.agent_id,
    messageId: row.message_id,
    attempt: row.attempt,
    statusCode: row.status_code,
    responseMs: row.response_ms,
    error: row.error,
    createdAt: row.created_at,
  }))
}

export async function listAuditLogs(orgId: string): Promise<AuditLogView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("audit_logs")
    .select("id, actor_type, actor_id, action, target, metadata, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100)
  return ((data ?? []) as {
    id: string
    actor_type: string
    actor_id: string | null
    action: string
    target: string | null
    metadata: Record<string, unknown>
    created_at: string
  }[]).map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    target: row.target,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
  }))
}

export async function listPricing(): Promise<PricingView[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("model_pricing")
    .select("provider, model, input_per_mtok, output_per_mtok, updated_at")
    .order("provider")
    .order("model")
  return ((data ?? []) as {
    provider: string
    model: string
    input_per_mtok: number | string
    output_per_mtok: number | string
    updated_at: string
  }[]).map((row) => ({
    provider: row.provider,
    model: row.model,
    inputPerMtok: Number(row.input_per_mtok),
    outputPerMtok: Number(row.output_per_mtok),
    updatedAt: row.updated_at,
  }))
}

export async function listRoomMemberRows(
  roomId: string,
): Promise<{ userId: string; role: RoomRole }[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("room_members")
    .select("user_id, role")
    .eq("room_id", roomId)
  return ((data ?? []) as { user_id: string; role: RoomRole }[]).map((row) => ({
    userId: row.user_id,
    role: row.role,
  }))
}

export async function listMemberViews(orgId: string): Promise<MemberView[]> {  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("org_members")
    .select("user_id, role, profiles!inner(display_name, avatar_url)")
    .eq("org_id", orgId)
    .order("created_at")
  return ((data ?? []) as unknown as {
    user_id: string
    role: MemberView["role"]
    profiles: { display_name: string; avatar_url: string | null }
  }[]).map((row) => ({
    userId: row.user_id,
    displayName: row.profiles.display_name,
    avatarUrl: row.profiles.avatar_url,
    role: row.role,
  }))
}
