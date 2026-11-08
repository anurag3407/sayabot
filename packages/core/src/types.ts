import { z } from "zod"

export const TURN_MODES = ["mentions", "debate", "moderated"] as const
export type TurnMode = (typeof TURN_MODES)[number]

export const ROOM_KINDS = ["public", "private", "dm"] as const
export type RoomKind = (typeof ROOM_KINDS)[number]

export const SENDER_TYPES = ["human", "agent", "system"] as const
export type SenderType = (typeof SENDER_TYPES)[number]

export const MESSAGE_STATUSES = ["streaming", "complete", "error", "halted"] as const
export type MessageStatus = (typeof MESSAGE_STATUSES)[number]

export const PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "cerebras",
  "openrouter",
  "copilot",
  "opencode",
  "command-code",
  "deepseek",
  "minimax",
  "grok",
  "kimi",
  "qwen",
  "cursor",
  "openai-compatible",
] as const
export type Provider = (typeof PROVIDERS)[number]

export const CANVAS_KINDS = ["markdown", "code", "svg", "html"] as const
export type CanvasKind = (typeof CANVAS_KINDS)[number]

export const TOOL_CALL_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "running",
  "done",
  "error",
] as const
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number]

/** Minimal agent descriptor the coordinator needs; full rows live in @sayabot/db. */
export interface AgentRef {
  id: string
  handle: string
  kind: "llm" | "external"
}

/** A message as seen by the coordinator and context builder. */
export interface ChatMessage {
  id: string
  senderType: SenderType
  senderId: string | null
  senderName: string
  content: string
  createdAt: string
}

/** Events broadcast on Realtime channel `room:{id}`. */
export const roomEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("message.delta"),
    messageId: z.string(),
    seq: z.number().int(),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("message.done"),
    messageId: z.string(),
    status: z.enum(MESSAGE_STATUSES),
  }),
  z.object({
    type: z.literal("turn.state"),
    sessionId: z.string(),
    activeAgentId: z.string().nullable(),
    queue: z.array(z.string()),
    threadRootId: z.string().nullable().optional(),
  }),
  z.object({
    type: z.literal("tool.approval_requested"),
    toolCallId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool.approval_resolved"),
    toolCallId: z.string(),
    status: z.enum(["approved", "rejected"]),
  }),
  z.object({
    type: z.literal("tool.started"),
    toolCallId: z.string(),
    agentId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    type: z.literal("tool.finished"),
    toolCallId: z.string(),
    status: z.enum(["done", "error", "rejected"]),
    durationMs: z.number(),
  }),
  z.object({
    type: z.literal("tool.output"),
    toolCallId: z.string(),
    seq: z.number().int(),
    chunk: z.string(),
  }),
  z.object({
    type: z.literal("agent.connected"),
    agentId: z.string(),
    handle: z.string(),
    client: z.string().optional(),
  }),
  z.object({
    type: z.literal("computer.state"),
    agentId: z.string(),
    status: z.string(),
  }),
  z.object({
    type: z.literal("room.notice"),
    level: z.enum(["info", "warn", "error"]),
    message: z.string(),
  }),
  z.object({
    type: z.literal("run.step"),
    runId: z.string(),
    step: z.number().int(),
    kind: z.enum(["model", "tool", "compaction", "recall", "plan", "subagent", "verify"]),
    label: z.string(),
  }),
  z.object({
    type: z.literal("run.status"),
    runId: z.string(),
    status: z.enum(["thinking", "tool", "waiting:approval", "waiting:answer", "compacting"]),
  }),
  z.object({
    type: z.literal("run.plan"),
    runId: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        status: z.enum(["pending", "in_progress", "done", "blocked"]),
        note: z.string().optional(),
      }),
    ),
  }),
])
export type RoomEvent = z.infer<typeof roomEventSchema>

/** Webhook payload sent to external bots (PRD §4.8). */
export const webhookPayloadSchema = z.union([
  z.object({
    event: z.literal("message.created"),
    room_id: z.string(),
    thread_id: z.string().nullable(),
    message_id: z.string(),
    sender: z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(SENDER_TYPES),
    }),
    content: z.string(),
    mentions: z.array(z.string()),
    context_snapshot: z.array(z.object({ sender: z.string(), content: z.string() })),
  }),
  z.object({
    event: z.literal("task.assigned"),
    room_id: z.string(),
    task_id: z.string(),
    task_number: z.number().int(),
    title: z.string(),
    description: z.string(),
    reason: z.string().optional(),
  }),
])
export type WebhookPayload = z.infer<typeof webhookPayloadSchema>

/** Body accepted by POST /v1/rooms/:roomId/messages from external bots. */
export const botMessageBodySchema = z.object({
  content: z.string().min(1).max(100_000),
  thread_id: z.string().nullable().optional(),
  reply_to: z.string().optional(),
})

/** One NDJSON line on POST /v1/rooms/:roomId/messages/stream. */
export const botStreamLineSchema = z.union([
  z.object({ delta: z.string() }),
  z.object({ done: z.literal(true) }),
])
