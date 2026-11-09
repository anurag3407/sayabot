import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { routineStatusEnum } from "./enums"
import { orgs, profiles } from "./identity"
import { rooms } from "./rooms"

export const routines = pgTable(
  "routines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    scheduleExpr: text("schedule_expr").notNull(),
    scheduleKind: text("schedule_kind").notNull().default("cron"),
    timezone: text("timezone").notNull().default("UTC"),
    prompt: text("prompt").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastStatus: routineStatusEnum("last_status").notNull().default("idle"),
    lastError: text("last_error"),
    runCount: integer("run_count").notNull().default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdByUserId: uuid("created_by_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("routines_org_idx").on(t.orgId, t.enabled),
    index("routines_next_run_idx").on(t.enabled, t.nextRunAt),
    index("routines_agent_idx").on(t.agentId),
    index("routines_room_idx").on(t.roomId),
  ],
)

export const routineRuns = pgTable(
  "routine_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    routineId: uuid("routine_id")
      .notNull()
      .references(() => routines.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    status: routineStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    output: text("output"),
    error: text("error"),
  },
  (t) => [
    index("routine_runs_routine_idx").on(t.routineId, t.startedAt),
    index("routine_runs_org_idx").on(t.orgId, t.startedAt),
  ],
)
