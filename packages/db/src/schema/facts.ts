import { sql } from "drizzle-orm"
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { orgs, profiles } from "./identity"
import { rooms } from "./rooms"
import { tasks } from "./tasks"

export type OwnerFactSource = "answer" | "manual" | "agent"

/**
 * Things the people in a workspace have already told their bots ("start date", "CGPA",
 * "LinkedIn URL"). Bots read these before asking, so nobody answers the same question twice.
 * room_id null = every room in the workspace; otherwise only bots in that room can read it.
 */
export const ownerFacts = pgTable(
  "owner_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    value: text("value").notNull(),
    source: text("source").$type<OwnerFactSource>().notNull().default("answer"),
    sourceTaskId: uuid("source_task_id").references(() => tasks.id, { onDelete: "set null" }),
    sourceAgentId: uuid("source_agent_id").references(() => agents.id, { onDelete: "set null" }),
    note: text("note"),
    updatedBy: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("owner_facts_scope_key_idx").on(
      t.orgId,
      sql`coalesce(${t.roomId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.key,
    ),
    index("owner_facts_org_idx").on(t.orgId),
  ],
)
