export type OrgRole = "owner" | "admin" | "member"
export type RoomRole = "admin" | "member"
export type RoomKind = "public" | "private" | "dm"
export type TurnMode = "mentions" | "debate" | "moderated"
export type SenderType = "human" | "agent" | "system"
export type MessageStatus = "streaming" | "complete" | "error" | "halted"
export type CanvasKind = "markdown" | "code" | "svg" | "html"
export type ToolCallStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "running"
  | "done"
  | "error"

export interface OrgSummary {
  id: string
  slug: string
  name: string
  role: OrgRole
  ssoEnabled: boolean
}

export interface OrgAccess {
  org: { id: string; slug: string; name: string; ssoEnabled: boolean }
  role: OrgRole
  user: {
    id: string
    email: string | null
    displayName: string
    avatarUrl: string | null
    notifications: "all" | "mentions" | "off"
    sound: boolean
  }
}

export interface RoomView {
  id: string
  orgId: string
  name: string
  kind: RoomKind
  turnMode: TurnMode
  systemDirective: string | null
  turnCap: number
  rpmLimit: number | null
  dailyBudgetUsd: number | null
  moderatorAgentId: string | null
  debateOrder: string[]
  timezone: string
  agentDmUserId: string | null
  agentDmAgentId: string | null
  createdAt: string
}

export interface RoomAccess {
  org: OrgAccess["org"]
  orgRole: OrgRole
  user: OrgAccess["user"]
  room: RoomView
  roomRole: RoomRole | null
  canAdmin: boolean
}

export interface AgentView {
  id: string
  orgId: string
  handle: string
  displayName: string
  kind: "llm" | "external"
  providerKeyId: string | null
  model: string | null
  systemPrompt: string
  params: Record<string, unknown>
  toolIds: string[]
  webhookUrl: string | null
  createdAt: string
}

export interface RoomAgentView {
  agent: AgentView
  position: number
}

export interface MessageView {
  id: string
  roomId: string
  threadRootId: string | null
  senderType: SenderType
  senderId: string | null
  content: string
  status: MessageStatus
  mentions: string[]
  runId: string | null
  metadata: Record<string, unknown>
  createdAt: string
  senderName: string
  senderHandle: string | null
}

export interface ToolCallView {
  id: string
  runId: string | null
  roomId: string
  messageId: string | null
  toolName: string
  args: Record<string, unknown>
  result: unknown
  status: ToolCallStatus
  approvedBy: string | null
  resolvedAt: string | null
  error: string | null
  createdAt: string
  liveOutput?: string
}

export interface CanvasView {
  id: string
  roomId: string
  kind: CanvasKind
  title: string
  language: string | null
  snapshotText: string
  updatedAt: string
}

export interface CanvasVersionView {
  id: string
  canvasId: string
  authorType: string
  authorId: string | null
  snapshotText: string
  createdAt: string
}

export interface TurnStateView {
  sessionId: string
  activeAgentId: string | null
  queue: string[]
  threadRootId?: string | null
}

export interface MemberView {
  userId: string
  displayName: string
  avatarUrl: string | null
  role: OrgRole
}

export interface ProviderKeyView {
  id: string
  provider: string
  baseUrl: string | null
  label: string
  last4: string
  createdAt: string
}

export interface McpServerView {
  id: string
  orgId: string
  roomId: string | null
  name: string
  transport: "http" | "sse"
  url: string
  dangerousTools: string[]
  enabled: boolean
  createdAt: string
}

export interface OrgToolConfigView {
  id: string
  orgId: string
  tool: string
  enabled: boolean
  provider?: string
  last4?: string
  baseUrl?: string
  updatedAt: string
}

export interface WebhookDeliveryView {
  id: string
  agentId: string | null
  messageId: string | null
  attempt: number
  statusCode: number | null
  responseMs: number | null
  error: string | null
  createdAt: string
}

export interface AgentApiKeyView {
  id: string
  agentId: string
  prefix: string
  label: string
  scopes: string[]
  revokedAt: string | null
  lastUsedAt: string | null
  createdAt: string
}

export interface AuditLogView {
  id: string
  actorType: string
  actorId: string | null
  action: string
  target: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface PricingView {
  provider: string
  model: string
  inputPerMtok: number
  outputPerMtok: number
  updatedAt: string
}

export interface SessionView {
  id: string
  threadRootId: string | null
  state: string
  queue: { agentId: string; role: string }[]
}

export interface RoomScheduleView {
  roomId: string
  timezone: string
  morningStartMinutes: number
  morningEndMinutes: number
  eveningStartMinutes: number
  eveningEndMinutes: number
  checkinsEnabled: boolean
  checkinIntervalMinutes: number
  checkinStartMinutes: number
  checkinEndMinutes: number
  checkinDurationMinutes: number
  checkinMode?: "stream" | "digest"
  digestAt?: number | null
  lastCheckinAt: string | null
}

export interface MeetingView {
  id: string
  orgId: string
  roomId: string
  roomName: string
  kind: "meeting" | "checkin"
  title: string
  agenda: string
  startsAt: string
  endsAt: string
  status: "scheduled" | "active" | "ended" | "canceled"
  createdBy: string | null
  promptMessageId: string | null
  metadata: Record<string, unknown>
}

export interface ChatListItem {
  id: string
  name: string
  kind: RoomKind
  turnMode: TurnMode
  isBotDm: boolean
  agentId: string | null
  agentNames: string[]
  lastMessage: string | null
  lastSender: string | null
  lastAt: string | null
  unreadCount: number
  mentionCount: number
  pinned: boolean
  mutedUntil: string | null
  archived: boolean
}

export interface TaskCommentView {
  id: string
  taskId: string
  authorType: string
  authorId: string | null
  authorName: string
  content: string
  createdAt: string
}

export interface TaskEventView {
  id: string
  taskId: string
  actorType: "human" | "agent" | "system"
  actorId: string | null
  actorName?: string | null
  fromStatus: string | null
  toStatus: string
  reason: string | null
  outcomeKind: string | null
  outcomeRef: string | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface TaskView {
  id: string
  number: number
  orgId: string
  roomId: string
  roomName: string
  kind: "task" | "request"
  title: string
  description: string
  status: "open" | "in_progress" | "stuck" | "done"
  assigneeUserId: string | null
  assigneeName: string | null
  assigneeAgentId: string | null
  assigneeHandle: string | null
  requestedByAgentId: string | null
  requestedByHandle: string | null
  requestedFromUserId: string | null
  dueAt?: string | null
  statusChangedAt?: string
  completedAt?: string | null
  unblockNeeds?: string | null
  unblockDetail?: string | null
  blockedBy?: string[]
  outcomeKind?: string | null
  outcomeRef?: string | null
  foldKey?: string | null
  askedCount?: number
  expiresAt?: string | null
  costUsd?: number
  runsCount?: number
  leadAgentId?: string | null
  parentTaskId?: string | null
  budgetTurns?: number | null
  budgetUsd?: number | null
  turnsUsed?: number | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  comments: TaskCommentView[]
  events?: TaskEventView[]
}

export interface InboxApprovalView {
  toolCall: ToolCallView
  roomName: string
  agentHandle: string | null
  agentName: string | null
}

export interface InboxRequestView {
  task: TaskView
}

export interface DecisionPacketView {
  id: string
  roomId: string
  roomName: string
  requests: InboxRequestView[]
}

export interface InboxDoneView {
  id: string
  kind: "approval" | "request"
  label: string
  status: string
  resolvedAt: string
}

export interface FileView {
  id: string
  roomId: string
  roomName: string
  kind: CanvasKind
  title: string
  language: string | null
  preview: string
  updatedAt: string
}

export interface BotChatMessage {
  id: string
  senderHandle: string
  senderName: string
  content: string
  mentions: string[]
  createdAt: string
}

export interface BotChatView {
  roomId: string
  roomName: string
  messages: BotChatMessage[]
  lastAt: string
}

export interface RoomPageData {
  room: RoomView
  roomRole: RoomRole | null
  canAdmin: boolean
  user: OrgAccess["user"]
  org: OrgAccess["org"]
  orgRole: OrgRole
  messages: MessageView[]
  toolCalls: ToolCallView[]
  roomAgents: RoomAgentView[]
  canvases: CanvasView[]
  members: MemberView[]
  memberAvatars: Record<string, string>
  activeSession: SessionView | null
  threadCounts: Record<string, number>
  meeting: MeetingView | null
  roomSchedule: RoomScheduleView | null
  lastReadAt: string | null
  roomMemberIds: string[]
}

export interface ActionResult {
  ok: boolean
  error?: string
  message?: string
  warning?: string
  data?: Record<string, unknown>
}
