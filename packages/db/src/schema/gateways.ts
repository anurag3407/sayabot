import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { orgs, profiles } from "./identity"
import { rooms } from "./rooms"

/**
 * One external bot account bound to one agent. The token is sealed under `MESH_KEK`, and its
 * SHA-256 fingerprint is unique across the whole table: a bot identity can never be shared by two
 * agents, which is what keeps inbound DMs unambiguous.
 */
export const agentGateways = pgTable(
  "agent_gateways",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    /** "telegram" | "discord" */
    source: text("source").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    last4: text("last4").notNull(),
    /** SHA-256 of the raw token, hex. Unique: one bot identity, one agent. */
    tokenFingerprint: text("token_fingerprint").notNull(),
    /** Telegram only: the secret segment of the webhook URL. Sealed. */
    webhookSecretEnc: text("webhook_secret_enc"),
    /** allowedChats / allowedUserIds / silence. The allowlist only chooses who may bind. */
    config: jsonb("config").notNull().default({}),
    /** The one outside chat this bot answers. Set by the first message that passes the allowlist. */
    boundChatId: text("bound_chat_id"),
    /** The app room for that chat. Created when the channel is connected. */
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "set null" }),
    lastError: text("last_error"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_gateways_agent_source_idx").on(t.agentId, t.source),
    uniqueIndex("agent_gateways_token_idx").on(t.tokenFingerprint),
    uniqueIndex("agent_gateways_room_idx").on(t.roomId),
    index("agent_gateways_org_idx").on(t.orgId, t.source),
  ],
)

/** Dedup ledger for gateway webhooks, the gateway counterpart of `messaging_inbound`. */
export const gatewayInbound = pgTable(
  "gateway_inbound",
  {
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => agentGateways.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    messageId: uuid("message_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gateway_inbound_pk").on(t.gatewayId, t.externalId)],
)

/**
 * The bound chat's room, kept so older readers can still label it. One gateway has one room;
 * `room_id` is unique, and a second outside chat never gets a row here.
 */
export const externalChats = pgTable(
  "external_chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    gatewayId: uuid("gateway_id")
      .notNull()
      .references(() => agentGateways.id, { onDelete: "cascade" }),
    externalChatId: text("external_chat_id").notNull(),
    /** "dm" | "group" */
    chatType: text("chat_type").notNull().default("dm"),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    title: text("title"),
    /** Per-chat model override, mirroring a room agent override. */
    modelOverride: jsonb("model_override"),
    systemPrompt: text("system_prompt"),
    /** Optional per-chat sender allowlist (platform user ids). */
    allowedUserIds: text("allowed_user_ids").array().notNull().default([]),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("external_chats_gateway_chat_idx").on(t.gatewayId, t.externalChatId),
    uniqueIndex("external_chats_room_idx").on(t.roomId),
    index("external_chats_org_idx").on(t.orgId),
  ],
)

export type AgentGatewayRow = typeof agentGateways.$inferSelect
export type NewAgentGatewayRow = typeof agentGateways.$inferInsert
export type ExternalChatRow = typeof externalChats.$inferSelect
