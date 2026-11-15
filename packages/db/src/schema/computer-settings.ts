import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { orgs, profiles } from "./identity"

/**
 * One Boat key and one VPS for the workspace. The key is sealed with MESH_KEK.
 * A Cloud plan's relay token is never stored here; the person's own key wins at request time.
 */
export const orgComputerSettings = pgTable("org_computer_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  boatCiphertext: text("boat_ciphertext"),
  boatIv: text("boat_iv"),
  boatTag: text("boat_tag"),
  boatLast4: text("boat_last4"),
  /** SSH config alias. Sayabot never stops this server. */
  vpsSshAlias: text("vps_ssh_alias"),
  /** Auto may create this bot's container on the VPS. Off until an admin turns it on. */
  vpsStartAutomatically: boolean("vps_start_automatically").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

/** The Mac's bots, chats, routines, and keys, kept once while a Cloud plan is active. */
export const cloudHomeCopies = pgTable("cloud_home_copies", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => profiles.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").references(() => orgs.id, { onDelete: "set null" }),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  copiedAt: timestamp("copied_at", { withTimezone: true }).notNull().defaultNow(),
  restoredAt: timestamp("restored_at", { withTimezone: true }),
})
