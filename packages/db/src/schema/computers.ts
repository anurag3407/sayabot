import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { agents } from "./agents"
import { computerProfileEnum, computerStatusEnum } from "./enums"
import { orgs } from "./identity"

export const agentComputers = pgTable(
  "agent_computers",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agents.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    profile: computerProfileEnum("profile").notNull().default("standard"),
    status: computerStatusEnum("status").notNull().default("none"),
    containerId: text("container_id"),
    containerIp: text("container_ip"),
    volume: text("volume").notNull(),
    proxySecretHash: text("proxy_secret_hash"),
    cpuMillis: integer("cpu_millis").notNull().default(1000),
    memMb: integer("mem_mb").notNull().default(1024),
    diskMb: integer("disk_mb").notNull().default(5120),
    diskUsedMb: integer("disk_used_mb").notNull().default(0),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    error: text("error"),
  },
  (t) => [
    index("agent_computers_org_status_idx").on(t.orgId, t.status),
    index("agent_computers_idle_sweeper_idx").on(t.status, t.lastActiveAt),
  ],
)
