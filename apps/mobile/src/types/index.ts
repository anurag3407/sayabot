export type SenderType = "human" | "agent" | "system"
export type MessageStatus = "streaming" | "complete" | "error" | "halted"
export type TurnMode = "mentions" | "debate" | "moderated"
export type RoomKind = "public" | "private" | "dm"

export interface Room {
  id: string
  orgId: string
  name: string
  kind: RoomKind
  turnMode: TurnMode
  systemDirective?: string | null
  timezone: string
  unreadCount?: number
}

export interface Message {
  id: string
  roomId: string
  threadRootId?: string | null
  senderType: SenderType
  senderId: string | null
  senderName?: string
  senderHandle?: string | null
  content: string
  status: MessageStatus
  mentions?: string[]
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface TaskItem {
  id: string
  number: number
  title: string
  description?: string | null
  status: "open" | "in_progress" | "blocked" | "stuck" | "done"
  kind: "task" | "request" | "milestone"
  priority: "low" | "medium" | "high" | "urgent"
  assigneeAgentId?: string | null
  assigneeHandle?: string | null
  assigneeUserId?: string | null
  budgetTurns: number
  turnsUsed: number
  costUsd: number
  unblockNeeds?: string | null
  roomId?: string
  updatedAt?: string
}

export interface PendingApproval {
  toolCallId: string
  toolName: string
  agentId: string
  args: Record<string, unknown>
}

export interface ComputerContainerState {
  agentId: string
  agentHandle: string
  status: "none" | "starting" | "running" | "stopping" | "stopped" | "error" | "over_quota"
  containerId?: string | null
  ip?: string | null
  profile: "standard" | "browser"
  error?: string | null
}
