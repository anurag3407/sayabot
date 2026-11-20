import type { MessageView, ToolCallView } from "@/lib/types"

export interface PersonLookup {
  agents: Map<string, { displayName: string; handle: string }>
  members: Map<string, { displayName: string }>
}

export interface RawMessageRow {
  id: string
  room_id: string
  thread_root_id: string | null
  sender_type: MessageView["senderType"]
  sender_id: string | null
  content: string
  status: MessageView["status"]
  mentions: string[] | null
  run_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export function messageFromRow(row: RawMessageRow, lookup: PersonLookup): MessageView {
  const agent = row.sender_id ? lookup.agents.get(row.sender_id) : undefined
  const member = row.sender_id ? lookup.members.get(row.sender_id) : undefined
  return {
    id: row.id,
    roomId: row.room_id,
    threadRootId: row.thread_root_id,
    senderType: row.sender_type,
    senderId: row.sender_id,
    content: row.content,
    status: row.status,
    mentions: row.mentions ?? [],
    runId: row.run_id,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    senderName:
      row.sender_type === "system"
        ? "system"
        : (agent?.displayName ??
          member?.displayName ??
          (row.sender_type === "agent" ? "Removed agent" : "Former member")),
    senderHandle: agent?.handle ?? null,
  }
}

export interface RawToolCallRow {
  id: string
  run_id: string | null
  room_id: string
  message_id: string | null
  tool_name: string
  args: Record<string, unknown> | null
  result: unknown
  status: ToolCallView["status"]
  approved_by: string | null
  resolved_at: string | null
  error: string | null
  created_at: string
}

export function toolCallFromRow(row: RawToolCallRow): ToolCallView {
  return {
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
  }
}

export function sortMessages(messages: MessageView[]): MessageView[] {
  return [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function sortToolCalls(calls: ToolCallView[]): ToolCallView[] {
  return [...calls].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
