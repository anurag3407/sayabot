import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agents } from "./agents"
import {
  epistemicStatusEnum,
  memoryKindEnum,
  memoryLinkTypeEnum,
  memoryScopeEnum,
  memorySourceEnum,
  openLoopStatusEnum,
} from "./enums"
import { orgs, profiles } from "./identity"
import { rooms } from "./rooms"

// ── 1. Core Memories Table (enhanced with cognitive & epistemic attributes) ──

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    scope: memoryScopeEnum("scope").notNull().default("agent"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
    kind: memoryKindEnum("kind").notNull().default("fact"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    tags: text("tags").array().notNull().default([]),
    source: memorySourceEnum("source").notNull().default("agent"),
    sourceRef: text("source_ref"),
    confidence: numeric("confidence", { precision: 4, scale: 3, mode: "number" })
      .notNull()
      .default(1.0),
    pinned: boolean("pinned").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by"),
    createdByUserId: uuid("created_by_user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    useCount: integer("use_count").notNull().default(0),

    // Cognitive additions (GBrain-grade)
    perspective: text("perspective").notNull().default("first_person"),
    emotionalSalience: numeric("emotional_salience", { precision: 3, scale: 2, mode: "number" })
      .notNull()
      .default(0.5),
    epistemicStatus: epistemicStatusEnum("epistemic_status").notNull().default("belief"),
    evidenceRefs: text("evidence_refs").array().notNull().default([]),
    targetAgentId: uuid("target_agent_id").references(() => agents.id, { onDelete: "set null" }),
    decayHalfLifeDays: integer("decay_half_life_days").notNull().default(30),
    withdrawalReason: text("withdrawal_reason"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memories_scope_idx").on(t.orgId, t.scope, t.agentId, t.roomId),
    index("memories_pinned_idx").on(t.orgId, t.pinned),
    index("memories_last_used_idx").on(t.orgId, t.lastUsedAt),
    index("memories_epistemic_idx").on(t.orgId, t.epistemicStatus),
    index("memories_salience_idx").on(t.orgId, t.emotionalSalience),
    index("memories_target_agent_idx").on(t.orgId, t.targetAgentId),
  ],
)

// ── 2. Memory Sources Table (Multi-tenancy & federated visibility) ────────────

export const memorySources = pgTable(
  "memory_sources",
  {
    id: text("id").primaryKey(), // e.g. "agent:uuid", "room:uuid", "org:uuid"
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    federated: boolean("federated").notNull().default(false),
    config: jsonb("config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memory_sources_org_idx").on(t.orgId, t.federated),
  ],
)

// ── 3. Open Loops Table (Commitments, promises & follow-ups across turns) ────

export const openLoops = pgTable(
  "open_loops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    status: openLoopStatusEnum("status").notNull().default("open"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    blockerReason: text("blocker_reason"),
    resolution: text("resolution"),
    sourceRef: text("source_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("open_loops_agent_status_idx").on(t.orgId, t.agentId, t.status),
    index("open_loops_room_idx").on(t.orgId, t.roomId),
  ],
)

// ── 4. Memory Links Table (Knowledge graph & concept wikilinks) ──────────────

export const memoryLinks = pgTable(
  "memory_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    sourceMemoryId: uuid("source_memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    targetMemoryId: uuid("target_memory_id").references(() => memories.id, { onDelete: "cascade" }),
    targetSlug: text("target_slug"),
    relationship: memoryLinkTypeEnum("relationship").notNull().default("relates_to"),
    weight: numeric("weight", { precision: 3, scale: 2, mode: "number" })
      .notNull()
      .default(1.0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memory_links_source_idx").on(t.orgId, t.sourceMemoryId),
    index("memory_links_target_idx").on(t.orgId, t.targetMemoryId),
    index("memory_links_slug_idx").on(t.orgId, t.targetSlug),
  ],
)

// ── Type definitions ────────────────────────────────────────────────────────

export type MemoryRow = typeof memories.$inferSelect
export type NewMemoryRow = typeof memories.$inferInsert
export type MemorySourceRow = typeof memorySources.$inferSelect
export type OpenLoopRow = typeof openLoops.$inferSelect
export type MemoryLinkRow = typeof memoryLinks.$inferSelect
