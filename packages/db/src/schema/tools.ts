import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core"
import { toolCallStatusEnum, mcpTransportEnum } from "./enums"
import { orgs, profiles } from "./identity"
import { agentRuns, messages } from "./messages"
import { rooms } from "./rooms"

export const mcpServers = pgTable(
  "mcp_servers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    transport: mcpTransportEnum("transport").notNull().default("http"),
    url: text("url").notNull(),
    headersEnc: text("headers_enc"),
    /** "static" (headers or nothing) or "oauth" (browser sign-in, see oauthEnc). */
    authKind: text("auth_kind").notNull().default("static"),
    /** Sealed McpOAuthState: client registration, PKCE verifier, state, tokens. */
    oauthEnc: text("oauth_enc"),
    /** "ok", "pending" (sign-in started) or "signed_out" (tokens gone or refused). */
    authStatus: text("auth_status").notNull().default("ok"),
    /** Marketplace app id this row was made from, when it came from the catalog. */
    catalogApp: text("catalog_app"),
    dangerousTools: text("dangerous_tools").array().notNull().default([]),
    enabled: boolean("enabled").notNull().default(true),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_servers_org_idx").on(t.orgId), index("mcp_servers_room_idx").on(t.roomId)],
)

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    toolName: text("tool_name").notNull(),
    args: jsonb("args").$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb("result").$type<unknown>(),
    status: toolCallStatusEnum("status").notNull().default("running"),
    approvedBy: uuid("approved_by").references(() => profiles.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tool_calls_room_idx").on(t.roomId, t.createdAt),
    index("tool_calls_run_idx").on(t.runId),
  ],
)
