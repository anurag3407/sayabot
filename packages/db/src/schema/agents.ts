import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"
import type { AgentCapabilities } from "@sayabot/core"
import { DEFAULT_CAPABILITIES } from "@sayabot/core"
import { agentKindEnum, agentVisibilityEnum, providerEnum } from "./enums"
import { orgs, profiles } from "./identity"
import { agentTemplates } from "./templates"

export const providerKeys = pgTable(
  "provider_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "set null" }),
    provider: providerEnum("provider").notNull(),
    baseUrl: text("base_url"),
    label: text("label").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    last4: text("last4").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("provider_keys_org_idx").on(t.orgId)],
)

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    handle: text("handle").notNull(),
    displayName: text("display_name").notNull(),
    kind: agentKindEnum("kind").notNull().default("llm"),
    providerKeyId: uuid("provider_key_id").references(() => providerKeys.id, {
      onDelete: "set null",
    }),
    model: text("model"),
    systemPrompt: text("system_prompt").notNull().default(""),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    toolIds: uuid("tool_ids").array().notNull().default([]),
    webhookUrl: text("webhook_url"),
    webhookSecretEnc: text("webhook_secret_enc"),
    templateId: uuid("template_id").references(() => agentTemplates.id, { onDelete: "set null" }),
    ownerUserId: uuid("owner_user_id").references(() => profiles.id, { onDelete: "set null" }),
    visibility: agentVisibilityEnum("visibility").notNull().default("org"),
    avatar: text("avatar"),
    bio: text("bio"),
    capabilities: jsonb("capabilities").$type<AgentCapabilities>().notNull().default(DEFAULT_CAPABILITIES),
    /** Last time an invited agent's own app called Sayabot (key or sign-in token). */
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agents_org_handle_idx").on(t.orgId, t.handle),
    index("agents_org_idx").on(t.orgId),
  ],
)

export const agentApiKeys = pgTable(
  "agent_api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull().unique(),
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull().default(["messages:write"]),
    label: text("label").notNull().default("default"),
    roomIds: uuid("room_ids").array(),
    oauthClientId: uuid("oauth_client_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("agent_api_keys_agent_idx").on(t.agentId)],
)

export const orgToolConfigs = pgTable(
  "org_tool_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    configEnc: text("config_enc").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    updatedBy: uuid("updated_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("org_tool_configs_org_tool_idx").on(t.orgId, t.tool)],
)
