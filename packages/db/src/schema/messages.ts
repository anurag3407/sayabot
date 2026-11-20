import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import {
  agentRunStatusEnum,
  messageStatusEnum,
  senderTypeEnum,
  turnRoleEnum,
  turnSessionStateEnum,
} from "./enums"
import { agents } from "./agents"
import { rooms } from "./rooms"
import { tasks } from "./tasks"

export interface TurnQueueItem {
  agentId: string
  role: "responder" | "producer" | "critic" | "summarizer" | "moderator"
}

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    threadRootId: uuid("thread_root_id"),
    senderType: senderTypeEnum("sender_type").notNull(),
    senderId: uuid("sender_id"),
    content: text("content").notNull().default(""),
    status: messageStatusEnum("status").notNull().default("complete"),
    mentions: text("mentions").array().notNull().default([]),
    runId: uuid("run_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("messages_room_created_idx").on(t.roomId, t.createdAt),
    index("messages_thread_idx").on(t.threadRootId),
    index("messages_run_idx").on(t.runId),
  ],
)

export const turnSessions = pgTable(
  "turn_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    threadRootId: uuid("thread_root_id"),
    triggerMessageId: uuid("trigger_message_id"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    botTurnsUsed: integer("bot_turns_used").notNull().default(0),
    state: turnSessionStateEnum("state").notNull().default("active"),
    queue: jsonb("queue").$type<TurnQueueItem[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("turn_sessions_room_idx").on(t.roomId, t.createdAt)],
)

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").references(() => turnSessions.id, { onDelete: "set null" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    step: integer("step").notNull().default(0),
    role: turnRoleEnum("role").notNull().default("responder"),
    status: agentRunStatusEnum("status").notNull().default("running"),
    finishReason: text("finish_reason"),
    steps: integer("steps"),
    engine: text("engine").notNull().default("v1"),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    parentRunId: uuid("parent_run_id"),
    waitingReason: text("waiting_reason"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    ttftMs: integer("ttft_ms"),
    latencyMs: integer("latency_ms"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_runs_room_created_idx").on(t.roomId, t.createdAt),
    index("agent_runs_session_idx").on(t.sessionId),
    index("agent_runs_task_idx").on(t.taskId),
  ],
)
