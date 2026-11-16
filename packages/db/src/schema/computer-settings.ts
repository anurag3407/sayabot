import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { orgs, profiles } from "./identity"

/**
 * The workspace's cloud desktops: one Boat key, one E2B key and one VPS. Keys are sealed with
 * MESH_KEK. A Cloud plan's relay token is never stored here; the person's own key wins at request time.
 */
export const orgComputerSettings = pgTable("org_computer_settings", {
  orgId: uuid("org_id")
    .primaryKey()
    .references(() => orgs.id, { onDelete: "cascade" }),
  boatCiphertext: text("boat_ciphertext"),
  boatIv: text("boat_iv"),
  boatTag: text("boat_tag"),
  boatLast4: text("boat_last4"),
  /** E2B API key (e2b.dev), sealed. One cloud sandbox per bot, paused when idle. */
  e2bCiphertext: text("e2b_ciphertext"),
  e2bIv: text("e2b_iv"),
  e2bTag: text("e2b_tag"),
  e2bLast4: text("e2b_last4"),
  /** SSH config alias. Sayabot never stops this server. Used when no host is saved. */
  vpsSshAlias: text("vps_ssh_alias"),
  /** Direct SSH target: host, login user and port. Wins over the alias when set. */
  vpsHost: text("vps_host"),
  vpsUser: text("vps_user"),
  vpsPort: integer("vps_port"),
  /** SSH private key for vpsHost, sealed. Written to a 0600 temp file only for one ssh call. */
  vpsKeyCiphertext: text("vps_key_ciphertext"),
  vpsKeyIv: text("vps_key_iv"),
  vpsKeyTag: text("vps_key_tag"),
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
