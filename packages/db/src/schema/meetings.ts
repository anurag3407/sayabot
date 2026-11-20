import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core"
import { meetingKindEnum, meetingStatusEnum } from "./enums"
import { orgs, profiles } from "./identity"
import { messages } from "./messages"
import { rooms } from "./rooms"

export const roomSchedules = pgTable("room_schedules", {
  roomId: uuid("room_id")
    .primaryKey()
    .references(() => rooms.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  morningStartMinutes: integer("morning_start_minutes").notNull().default(540),
  morningEndMinutes: integer("morning_end_minutes").notNull().default(570),
  eveningStartMinutes: integer("evening_start_minutes").notNull().default(1020),
  eveningEndMinutes: integer("evening_end_minutes").notNull().default(1050),
  checkinsEnabled: boolean("checkins_enabled").notNull().default(false),
  checkinIntervalMinutes: integer("checkin_interval_minutes").notNull().default(60),
  checkinStartMinutes: integer("checkin_start_minutes").notNull().default(540),
  checkinEndMinutes: integer("checkin_end_minutes").notNull().default(1050),
  checkinDurationMinutes: integer("checkin_duration_minutes").notNull().default(10),
  checkinMode: text("checkin_mode").$type<"stream" | "digest">().notNull().default("stream"),
  digestAt: integer("digest_at"),
  lastCheckinAt: timestamp("last_checkin_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    roomId: uuid("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    kind: meetingKindEnum("kind").notNull().default("meeting"),
    title: text("title").notNull(),
    agenda: text("agenda").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: meetingStatusEnum("status").notNull().default("scheduled"),
    createdBy: uuid("created_by").references(() => profiles.id, { onDelete: "set null" }),
    promptMessageId: uuid("prompt_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meetings_room_start_idx").on(t.roomId, t.startsAt),
    index("meetings_org_start_idx").on(t.orgId, t.startsAt),
    index("meetings_status_idx").on(t.status, t.startsAt),
  ],
)
