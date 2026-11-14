import { boolean, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { orgs } from "./identity"

/**
 * Sayabot Cloud only (SAYABOT_EDITION=cloud): a workspace's plan and its monthly usage.
 * Self-hosted servers never fill these. SQL, RLS and bump_server_turns: sql/0033_cloud_plans.sql.
 */
export const orgPlans = pgTable("org_plans", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  plan: text("plan").notNull().default("free"),
  status: text("status").notNull().default("active"),
  provider: text("provider"),
  customerId: text("customer_id"),
  subscriptionId: text("subscription_id"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const orgUsageMonthly = pgTable(
  "org_usage_monthly",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    /** Calendar month in UTC, "2026-11". */
    month: text("month").notNull(),
    serverTurns: integer("server_turns").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.month] })],
)
