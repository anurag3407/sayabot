import { isWithinWindow, minutesInTimeZone } from "@sayabot/core"
import {
  meetings,
  messages,
  orgMembers,
  roomAgents,
  roomSchedules,
  rooms,
  taskEvents,
  tasks,
} from "@sayabot/db"
import { and, desc, eq, gt, gte, isNull, lte, or, sql } from "drizzle-orm"
import { getDb, getPool } from "../db"
import { enqueueRoomMessage } from "../jobs"
import { loadTaskContext } from "../runner/context"

const SCHEDULER_LOCK = "mesh:meeting-scheduler"
const SCAN_MS = 60_000

let timer: ReturnType<typeof setInterval> | null = null

interface RoomRow {
  id: string
  orgId: string
  name: string
  createdBy: string | null
}

function localDateKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00"
  return `${value("year")}-${value("month")}-${value("day")}`
}

async function orgOwner(orgId: string): Promise<string | null> {
  const [owner] = await getDb()
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(and(eq(orgMembers.orgId, orgId), eq(orgMembers.role, "owner")))
    .limit(1)
  return owner?.userId ?? null
}

async function loadEveningRollup(roomId: string): Promise<string> {
  const db = getDb()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const [agentsRes, eventsRes, agedStuckRes, openQuestionsRes] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(roomAgents)
      .where(eq(roomAgents.roomId, roomId)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(taskEvents)
      .innerJoin(tasks, eq(tasks.id, taskEvents.taskId))
      .where(and(eq(tasks.roomId, roomId), gte(taskEvents.createdAt, todayStart))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.roomId, roomId),
          eq(tasks.kind, "task"),
          eq(tasks.status, "stuck"),
          lte(tasks.statusChangedAt, new Date(Date.now() - 72 * 60 * 60 * 1000)),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.roomId, roomId),
          eq(tasks.kind, "request"),
          eq(tasks.status, "open"),
        ),
      ),
  ])

  const agentCount = agentsRes[0]?.count ?? 0
  const stateChanges = eventsRes[0]?.count ?? 0
  const agedStuck = agedStuckRes[0]?.count ?? 0
  const openQuestions = openQuestionsRes[0]?.count ?? 0

  return `Evening rollup: ${agentCount} agent${agentCount === 1 ? "" : "s"}, ${stateChanges} state change${stateChanges === 1 ? "" : "s"}, ${agedStuck} aged-stuck, ${openQuestions} open question${openQuestions === 1 ? "" : "s"}.`
}

async function postMeetingPrompt(args: {
  meetingId: string
  room: RoomRow
  kind: "meeting" | "checkin"
  title: string
  agenda: string
  wake?: boolean
  hasAgents: boolean
}): Promise<void> {
  const db = getDb()
  if (!args.hasAgents) {
    await db.insert(messages).values({
      roomId: args.room.id,
      threadRootId: null,
      senderType: "system",
      senderId: null,
      content: `${args.kind === "checkin" ? "Check-in" : "Meeting"} started: ${args.title}. No agents are in this room yet.`,
      status: "complete",
      metadata: { meetingId: args.meetingId, automated: true },
    })
    return
  }
  const host = args.room.createdBy ?? (await orgOwner(args.room.orgId))
  if (!host) {
    console.error(`[meetings] room ${args.room.id} has no host available`)
    return
  }
  const isEvening = args.title.toLowerCase().includes("evening")
  const eveningRollup = isEvening ? await loadEveningRollup(args.room.id).catch(() => "") : ""
  const lead = args.wake
    ? `Wake up: the meeting "${args.title}" is live.`
    : args.kind === "checkin"
      ? `Check-in: ${args.title}.`
      : `Meeting started: ${args.title}.`
  const agenda = args.agenda.trim() ? `\n\nAgenda: ${args.agenda.trim()}` : ""
  const rollupSection = eveningRollup ? `\n\n${eveningRollup}` : ""
  const board = await loadTaskContext(args.room.id).catch(() => "")
  const boardSection = board
    ? `\n\nOpen board:\n${board}\n\nUpdate the tasks you hold with update_task. If something is stuck, say who can unstick it. Claim unowned work that fits you with claim_task.`
    : ""
  const content = `${lead}${agenda}${rollupSection}${boardSection}\n\n@all_bots Agents: report what you have done, what you are doing next, and anything you need from the humans.`
  const [message] = await db
    .insert(messages)
    .values({
      roomId: args.room.id,
      threadRootId: null,
      senderType: "human",
      senderId: host,
      content,
      status: "complete",
      mentions: ["all_bots"],
      metadata: { meetingId: args.meetingId, automated: true },
    })
    .returning({ id: messages.id })
  if (!message) throw new Error("could not post the meeting prompt")
  await db.update(meetings).set({ promptMessageId: message.id }).where(eq(meetings.id, args.meetingId))
  await enqueueRoomMessage(args.room.id, message.id)
}

async function startMeetingInstance(args: {
  room: RoomRow
  kind: "meeting" | "checkin"
  title: string
  agenda: string
  endsAt: Date
  metadata: Record<string, unknown>
  hasAgents: boolean
}): Promise<void> {
  const now = new Date()
  const [meeting] = await getDb()
    .insert(meetings)
    .values({
      orgId: args.room.orgId,
      roomId: args.room.id,
      kind: args.kind,
      title: args.title,
      agenda: args.agenda,
      startsAt: now,
      endsAt: args.endsAt,
      status: "active",
      metadata: args.metadata,
    })
    .returning({ id: meetings.id })
  if (!meeting) return
  await postMeetingPrompt({
    meetingId: meeting.id,
    room: args.room,
    kind: args.kind,
    title: args.title,
    agenda: args.agenda,
    hasAgents: args.hasAgents,
  })
}

async function roomHasAgents(roomId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ agentId: roomAgents.agentId })
    .from(roomAgents)
    .where(eq(roomAgents.roomId, roomId))
    .limit(1)
  return Boolean(row)
}

async function activeMeetingExists(roomId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: meetings.id })
    .from(meetings)
    .where(and(eq(meetings.roomId, roomId), eq(meetings.status, "active")))
    .limit(1)
  return Boolean(row)
}

async function recurringAlreadyStarted(
  roomId: string,
  slot: string,
  localDate: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ metadata: meetings.metadata })
    .from(meetings)
    .where(and(eq(meetings.roomId, roomId), eq(meetings.kind, "meeting")))
    .orderBy(desc(meetings.startsAt))
    .limit(20)
  return rows.some(
    (row) => row.metadata.slot === slot && row.metadata.localDate === localDate,
  )
}

async function scanOnce(): Promise<void> {
  const db = getDb()
  const now = new Date()

  await db
    .update(meetings)
    .set({ status: "ended", updatedAt: now })
    .where(and(eq(meetings.status, "active"), lte(meetings.endsAt, now)))
  await db
    .update(meetings)
    .set({ status: "canceled", updatedAt: now })
    .where(and(eq(meetings.status, "scheduled"), lte(meetings.endsAt, now)))

  const scheduled = await db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.status, "scheduled"),
        lte(meetings.startsAt, now),
        gt(meetings.endsAt, now),
      ),
    )
    .limit(20)
  for (const meeting of scheduled) {
    if (meeting.endsAt <= now) continue
    const [claimed] = await db
      .update(meetings)
      .set({ status: "active", startsAt: now, updatedAt: now })
      .where(and(eq(meetings.id, meeting.id), eq(meetings.status, "scheduled")))
      .returning({ id: meetings.id })
    if (!claimed) continue
    const [room] = await db.select().from(rooms).where(eq(rooms.id, meeting.roomId)).limit(1)
    if (!room) continue
    await postMeetingPrompt({
      meetingId: meeting.id,
      room: room as RoomRow,
      kind: meeting.kind,
      title: meeting.title,
      agenda: meeting.agenda,
      hasAgents: await roomHasAgents(room.id),
    })
    console.log(`[meetings] started scheduled ${meeting.kind} ${meeting.id}`)
  }

  const schedules = await db
    .select({ schedule: roomSchedules, room: rooms })
    .from(roomSchedules)
    .innerJoin(rooms, eq(rooms.id, roomSchedules.roomId))
  for (const { schedule, room } of schedules) {
    if (room.kind === "dm") continue
    const hasAgents = await roomHasAgents(room.id)
    if (!hasAgents) continue
    const timeZone = schedule.timezone || room.timezone || "UTC"
    let local: number
    try {
      local = minutesInTimeZone(now, timeZone)
    } catch {
      local = minutesInTimeZone(now, "UTC")
    }
    const localDate = localDateKey(now, timeZone)
    const roomView = room as RoomRow

    const slots = [
      {
        slot: "morning",
        title: "Morning meeting",
        start: schedule.morningStartMinutes,
        end: schedule.morningEndMinutes,
      },
      {
        slot: "evening",
        title: "Evening meeting",
        start: schedule.eveningStartMinutes,
        end: schedule.eveningEndMinutes,
      },
    ]
    for (const slot of slots) {
      if (!isWithinWindow(local, slot.start, slot.end)) continue
      if (await recurringAlreadyStarted(room.id, slot.slot, localDate)) continue
      if (await activeMeetingExists(room.id)) continue
      const minutesLeft = slot.end > local ? slot.end - local : 15
      await startMeetingInstance({
        room: roomView,
        kind: "meeting",
        title: slot.title,
        agenda: "Share progress, blockers and what happens next.",
        endsAt: new Date(now.getTime() + Math.max(1, minutesLeft) * 60_000),
        metadata: { slot: slot.slot, localDate, automated: true },
        hasAgents,
      })
      console.log(`[meetings] started ${slot.slot} meeting for room ${room.id}`)
    }

    if (
      schedule.checkinsEnabled &&
      isWithinWindow(local, schedule.checkinStartMinutes, schedule.checkinEndMinutes)
    ) {
      if (await activeMeetingExists(room.id)) continue
      const cutoff = new Date(
        now.getTime() - schedule.checkinIntervalMinutes * 60_000,
      )
      const [claimed] = await db
        .update(roomSchedules)
        .set({ lastCheckinAt: now, updatedAt: now })
        .where(
          and(
            eq(roomSchedules.roomId, room.id),
            eq(roomSchedules.checkinsEnabled, true),
            or(
              isNull(roomSchedules.lastCheckinAt),
              lte(roomSchedules.lastCheckinAt, cutoff),
            ),
          ),
        )
        .returning({ roomId: roomSchedules.roomId })
      if (!claimed) continue
      await startMeetingInstance({
        room: roomView,
        kind: "checkin",
        title: "Check-in",
        agenda: "What moved since the last check-in? What is blocked?",
        endsAt: new Date(now.getTime() + schedule.checkinDurationMinutes * 60_000),
        metadata: { slot: "checkin", automated: true },
        hasAgents,
      })
      console.log(`[meetings] started check-in for room ${room.id}`)
    }
  }
}

async function guardedScan(): Promise<void> {
  const client = await getPool().connect()
  try {
    const { rows } = await client.query(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [SCHEDULER_LOCK],
    )
    if (!rows[0]?.locked) return
    try {
      await scanOnce()
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [SCHEDULER_LOCK])
    }
  } finally {
    client.release()
  }
}

export function startMeetingScheduler(): void {
  if (timer) return
  const run = () => {
    void guardedScan().catch((error) => console.error("[meetings] scheduler scan failed", error))
  }
  run()
  timer = setInterval(run, SCAN_MS)
  timer.unref?.()
  console.log("[meetings] scheduler online")
}

export function stopMeetingScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
