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
import { rooms } from "./rooms"

export const roomInvites = pgTable(
  "room_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    client: text("client").notNull(),
    handleHint: text("handle_hint"),
    displayNameHint: text("display_name_hint"),
    scopes: text("scopes")
      .array()
      .notNull()
      .default([
        "messages:write",
        "tasks:write",
        "votes:write",
        "profile:write",
        "canvas:read",
        "activity:wait",
      ]),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    claimedAgentId: uuid("claimed_agent_id").references(() => agents.id, { onDelete: "set null" }),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("room_invites_room_expires_idx").on(t.roomId, t.expiresAt),
    index("room_invites_code_hash_idx").on(t.codeHash),
  ],
)

export const oauthClients = pgTable(
  "oauth_clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: text("client_id").notNull().unique(),
    clientName: text("client_name").notNull(),
    redirectUris: text("redirect_uris").array().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_clients_client_id_idx").on(t.clientId)],
)

export const oauthCodes = pgTable(
  "oauth_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    codeHash: text("code_hash").notNull().unique(),
    clientId: text("client_id").notNull(),
    inviteId: uuid("invite_id").references(() => roomInvites.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    codeChallenge: text("code_challenge").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_codes_code_hash_idx").on(t.codeHash)],
)

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().$type<"access" | "refresh">(),
    tokenHash: text("token_hash").notNull().unique(),
    clientId: text("client_id").notNull(),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "cascade" }),
    roomIds: uuid("room_ids").array(),
    scopes: text("scopes").array().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    rotatedFrom: uuid("rotated_from"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("oauth_tokens_token_hash_idx").on(t.tokenHash)],
)

export type BotInviteStatus = "waiting" | "pending" | "approved" | "joined" | "declined" | "revoked"

/**
 * "Add an agent" links. The link holds no credential: a bot opens it and asks to join, a
 * person approves the request in their Inbox, and only then does that bot (and only the
 * one that asked, proven by its poll token) receive its connection key, exactly once.
 */
export const botInvites = pgTable(
  "bot_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    code: text("code").notNull().unique(),
    name: text("name"),
    app: text("app"),
    status: text("status").$type<BotInviteStatus>().notNull().default("waiting"),
    requestName: text("request_name"),
    requestApp: text("request_app"),
    requestAbout: text("request_about"),
    requestUserAgent: text("request_user_agent"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    pollTokenHash: text("poll_token_hash"),
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => profiles.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    rejectedAttempts: jsonb("rejected_attempts").$type<Array<{ at: string; app?: string; userAgent?: string }>>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("bot_invites_room_idx").on(t.roomId, t.status), index("bot_invites_org_idx").on(t.orgId, t.status)],
)
