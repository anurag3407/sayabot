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
    status: text("status").notNull().default("queued"),
    prompt: text("prompt").notNull(),
    output: text("output"),
    error: text("error"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("local_runner_jobs_host_idx").on(t.hostId, t.status)],
)
