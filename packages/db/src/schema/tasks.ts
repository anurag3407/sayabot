import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { taskKindEnum, taskStatusEnum } from "./enums"
import { orgs, profiles } from "./identity"
import { rooms } from "./rooms"

export type UnblockNeeds =
  "human_answer" | "another_agent" | "credential" | "external_access" | "time" | "other"

export type OutcomeKind =
  "artifact" | "submission" | "external_change" | "decision" | "none" | "legacy"

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    number: serial("number").notNull(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    kind: taskKindEnum("kind").notNull().default("task"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: taskStatusEnum("status").notNull().default("open"),
    assigneeUserId: uuid("assignee_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    leadAgentId: uuid("lead_agent_id").references(() => agents.id, { onDelete: "set null" }),
    parentTaskId: uuid("parent_task_id"),
    budgetTurns: integer("budget_turns"),
    budgetUsd: numeric("budget_usd", { precision: 10, scale: 4 }),
    turnsUsed: integer("turns_used").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    requestedFromUserId: uuid("requested_from_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    unblockNeeds: text("unblock_needs").$type<UnblockNeeds>(),
    unblockDetail: text("unblock_detail"),
    blockedBy: uuid("blocked_by").array().notNull().default([]),
    outcomeKind: text("outcome_kind").$type<OutcomeKind>(),
    outcomeRef: text("outcome_ref"),
    foldKey: text("fold_key"),
    askedCount: integer("asked_count").notNull().default(1),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_room_status_idx").on(t.roomId, t.status),
    index("tasks_org_status_idx").on(t.orgId, t.status),
    index("tasks_assignee_agent_idx").on(t.assigneeAgentId),
    index("tasks_lead_agent_idx").on(t.leadAgentId),
    index("tasks_parent_task_idx").on(t.parentTaskId),
  ],
)

export const taskEvents = pgTable(
  "task_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull().$type<"human" | "agent" | "system">(),
    actorId: uuid("actor_id"),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    reason: text("reason"),
    outcomeKind: text("outcome_kind").$type<OutcomeKind>(),
    outcomeRef: text("outcome_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("task_events_task_idx").on(t.taskId, t.createdAt),
    index("task_events_to_status_idx").on(t.toStatus, t.createdAt),
  ],
)

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorType: text("author_type").notNull().default("human"),
    authorId: uuid("author_id"),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId, t.createdAt)],
)
