import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { orgs, profiles } from "./identity"

export interface DesktopHostSettings {
  /** only_me | admins | members (of org_id) */
  whoCanControl?: "only_me" | "admins" | "members"
  /** Each remote session waits for a person at the computer to allow it. */
  askOnComputer?: boolean
  /** Let this computer run agents on the apps signed in here (Claude Code, Codex…). */
  runnerEnabled?: boolean
  /**
   * Run the owner's agents here by default (agents with no key or computer of their own, in
   * workspaces where the owner is the only member). Unset: never decided, so Sayabot for Mac
   * turns it on once it finds a signed-in app. `false`: the owner turned it off.
   */
  localDefault?: { app: string } | false
}

/**
 * A computer running the Sayabot desktop app. It signs in once and keeps its own token, so
 * remote desktop and the local runner keep working after the person's login session expires.
 */
export const desktopHosts = pgTable(
  "desktop_hosts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    appVersion: text("app_version"),
    tokenHash: text("token_hash").notNull(),
    permissions: jsonb("permissions").$type<Record<string, string>>().notNull().default({}),
    localAgents: jsonb("local_agents").$type<Array<Record<string, unknown>>>().notNull().default([]),
    settings: jsonb("settings").$type<DesktopHostSettings>().notNull().default({}),
    /** What Sayabot uses on that computer, measured by the desktop app. */
    storage: jsonb("storage").$type<Record<string, unknown>>().notNull().default({}),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("desktop_hosts_user_idx").on(t.userId)],
)

/** One remote-desktop connection: WebRTC offer/answer exchanged through the server. */
export const remoteSessions = pgTable(
  "remote_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => desktopHosts.id, { onDelete: "cascade" }),
    viewerUserId: uuid("viewer_user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("requested"),
    control: boolean("control").notNull().default(false),
    offer: text("offer"),
    answer: text("answer"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("remote_sessions_host_idx").on(t.hostId, t.status)],
)

/** Agents that run on a person's computer through a signed-in app (Claude Code, Codex…). */
export const localRunnerJobs = pgTable(
  "local_runner_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => desktopHosts.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").notNull(),
    messageId: uuid("message_id").notNull(),
    replyMessageId: uuid("reply_message_id"),
    /** The agent run this job answers for; the Mac's tool cards attach to it. */
    runId: uuid("run_id"),
    /** Which app runs it (claude-code, codex…): chosen per agent, or the Mac's default. */
    app: text("app"),
    status: text("status").notNull().default("queued"),
    prompt: text("prompt").notNull(),
    /** One-run MCP token for Sayabot's room tools, sealed with MESH_KEK; cleared once claimed. */
    mcpTokenEnc: text("mcp_token_enc"),
    /** The oauth_tokens row behind it, revoked when the job ends. */
    mcpTokenId: uuid("mcp_token_id"),
    output: text("output"),
    error: text("error"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("local_runner_jobs_host_idx").on(t.hostId, t.status)],
)

/**
 * A password-manager read that has to run on the person's computer (`op`, `bw`, `pass-cli`).
 * The result is sealed. The token is never stored on this row; the claim route reads it.
 */
export const desktopSecretJobs = pgTable(
  "desktop_secret_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => desktopHosts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    connectorId: uuid("connector_id").notNull(),
    source: text("source").notNull(),
    action: text("action").notNull(),
    query: text("query").notNull(),
    vault: text("vault"),
    status: text("status").notNull().default("queued"),
    resultEnc: text("result_enc"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("desktop_secret_jobs_host_idx").on(t.hostId, t.status)],
)

/** One MCP call for a local app that only runs on the person's computer. */
export const desktopMcpCalls = pgTable(
  "desktop_mcp_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hostId: uuid("host_id")
      .notNull()
      .references(() => desktopHosts.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    serverId: uuid("server_id").notNull(),
    appId: text("app_id").notNull(),
    method: text("method").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("queued"),
    result: jsonb("result").$type<unknown>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("desktop_mcp_calls_host_idx").on(t.hostId, t.status)],
)
