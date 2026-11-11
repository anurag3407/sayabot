import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { orgs, profiles } from "./identity"

export type DevicePairingStatus = "waiting" | "paired" | "revoked"

/**
 * Phones signed in from a computer with a one-time code. A row starts "waiting" with a short
 * code; the phone trades the code for a sign-in and becomes "paired". Revoking flips it to
 * "revoked" and the phone signs itself out the next time it opens or wakes.
 */
export const devicePairings = pgTable(
  "device_pairings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => orgs.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    status: text("status").$type<DevicePairingStatus>().notNull().default("waiting"),
    deviceName: text("device_name"),
    platform: text("platform"),
    deviceTokenHash: text("device_token_hash"),
    pairedAt: timestamp("paired_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("device_pairings_user_idx").on(t.userId, t.status)],
)
