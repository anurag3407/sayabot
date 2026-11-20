import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import type { AgentCapabilities } from "@sayabot/core"
import { DEFAULT_CAPABILITIES } from "@sayabot/core"
import { providerEnum } from "./enums"
import { orgs, profiles } from "./identity"

export interface SecretSlot {
  envName: string
  label: string
  kind: "api_token" | "basic_auth" | "password" | "header_set" | "github_app"
  hosts: string[]
  inject: { mode: "header" | "basic" | "query" | "body"; template?: string; param?: string }
  methods?: string[]
  requiresApproval?: boolean
  required: boolean
  helpUrl?: string
}

export interface StarterTask {
  title: string
  description?: string
}

export const agentTemplates = pgTable(
  "agent_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    icon: text("icon"),
    category: text("category").notNull().default("general"),
    systemPrompt: text("system_prompt").notNull().default(""),
    defaultProvider: providerEnum("default_provider"),
    defaultModel: text("default_model"),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    capabilities: jsonb("capabilities")
      .$type<AgentCapabilities>()
      .notNull()
      .default(DEFAULT_CAPABILITIES),
    secretSlots: jsonb("secret_slots").$type<SecretSlot[]>().notNull().default([]),
    starterTasks: jsonb("starter_tasks").$type<StarterTask[]>().notNull().default([]),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_templates_org_slug_idx").on(t.orgId, t.slug),
    index("agent_templates_org_idx").on(t.orgId),
  ],
)
