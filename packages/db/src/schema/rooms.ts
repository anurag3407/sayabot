import { sql } from "drizzle-orm"
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import { roomKindEnum, roomMemberRoleEnum, turnModeEnum } from "./enums"
import { agents } from "./agents"
import { orgs, profiles } from "./identity"

/**
 * One bot's model in one chat ("only this chat"). `keyId`/`model`/`effort` are the picker's
 * choice; `providerKeyId`/`agentModel`/`runner` are what a turn applies to the bot, resolved and
 * checked when it was saved.
 */
export interface RoomModelOverride {
  keyId: string | null
  model: string | null
  effort: string | null
  providerKeyId: string | null
  agentModel: string | null
  runner: Record<string, unknown> | null
}

/**
 * Execution mode, picked in the composer. "review_all": every step asks. "ask_risky" (default):
 * risky steps ask. "auto": on the person's own Mac, read-only commands run without asking;
 * server tools marked dangerous still ask. "turbo": every command and tool in this room runs
 * without asking, including server tools marked dangerous. On a Mac, auto and turbo apply only
 * when that Mac's owner set the mode.
 */
export type RoomExecutionMode = "review_all" | "ask_risky" | "auto" | "turbo"

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: roomKindEnum("kind").notNull().default("private"),
    turnMode: turnModeEnum("turn_mode").notNull().default("mentions"),
    systemDirective: text("system_directive"),
    turnCap: integer("turn_cap").notNull().default(3),
    rpmLimit: integer("rpm_limit"),
    dailyBudgetUsd: numeric("daily_budget_usd", { precision: 12, scale: 6, mode: "number" }),
    moderatorAgentId: uuid("moderator_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    debateOrder: uuid("debate_order").array().notNull().default([]),
    timezone: text("timezone").notNull().default("UTC"),
    /** How bots in this chat ask before acting (see RoomExecutionMode). */
    executionMode: text("execution_mode").$type<RoomExecutionMode>().notNull().default("ask_risky"),
    /** Who picked the mode. A Mac honours auto/turbo only when its owner picked them. */
    executionModeSetBy: uuid("execution_mode_set_by").references(() => profiles.id, {
      onDelete: "set null",
    }),
    agentDmUserId: uuid("agent_dm_user_id").references(() => profiles.id, { onDelete: "set null" }),
    agentDmAgentId: uuid("agent_dm_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rooms_org_idx").on(t.orgId),
    uniqueIndex("rooms_agent_dm_idx").on(t.agentDmUserId, t.agentDmAgentId),
    check("rooms_turn_cap_check", sql`${t.turnCap} between 1 and 10`),
    check(
      "rooms_execution_mode_check",
      sql`${t.executionMode} in ('review_all', 'ask_risky', 'auto', 'turbo')`,
    ),
  ],
)

export const roomMembers = pgTable(
  "room_members",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    role: roomMemberRoleEnum("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
)

export const roomAgents = pgTable(
  "room_agents",
  {
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** "Only this chat": another model for this bot here. null follows the bot's default. */
    modelOverride: jsonb("model_override").$type<RoomModelOverride | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.roomId, t.agentId] }),
    index("room_agents_agent_idx").on(t.agentId),
  ],
)

export const roomReads = pgTable(
  "room_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    pinned: boolean("pinned").notNull().default(false),
    mutedUntil: timestamp("muted_until", { withTimezone: true }),
    archived: boolean("archived").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roomId] }), index("room_reads_room_idx").on(t.roomId)],
)

/**
 * Read cursor for agents that pull work (MCP-connected bots). `get_inbox` and
 * `get_room_messages` advance it so a bot only sees what is new since its last look.
 */
export const agentReads = pgTable(
  "agent_reads",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    lastReadAt: timestamp("last_read_at", { withTimezone: true }).notNull().defaultNow(),
    lastReportedAt: timestamp("last_reported_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.roomId] })],
)
