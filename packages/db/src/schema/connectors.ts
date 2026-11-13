import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { orgs, profiles } from "./identity"

// ── 1. Workspace Connectors Table (Tier-1 Workspace Level) ───────────────────

export const workspaceConnectors = pgTable(
  "workspace_connectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "set null" }),
    source: text("source").notNull(), // google_drive, slack, github, jira, discord, telegram, whatsapp
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    authType: text("auth_type").notNull().default("token"),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    last4: text("last4").notNull(),
    config: jsonb("config").notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workspace_connectors_org_idx").on(t.orgId),
    index("workspace_connectors_source_idx").on(t.orgId, t.source),
  ],
)

// ── 2. Agent Connector Grants Table (Tier-2 Agent Scoping) ──────────────────

export const agentConnectorGrants = pgTable(
  "agent_connector_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id")
      .notNull()
      .references(() => workspaceConnectors.id, { onDelete: "cascade" }),
    scopeConfig: jsonb("scope_config").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_connector_grants_agent_idx").on(t.orgId, t.agentId),
  ],
)

// ── Types ───────────────────────────────────────────────────────────────────

export type WorkspaceConnectorRow = typeof workspaceConnectors.$inferSelect
export type NewWorkspaceConnectorRow = typeof workspaceConnectors.$inferInsert
export type AgentConnectorGrantRow = typeof agentConnectorGrants.$inferSelect
export type NewAgentConnectorGrantRow = typeof agentConnectorGrants.$inferInsert
