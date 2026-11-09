import { getNextCronRun, isValidCron } from "@sayabot/core"
import { agents, messages, routineRuns, routines, rooms } from "@sayabot/db"
import { and, eq, lte } from "drizzle-orm"
import { getDb, getPool } from "../db"
import { enqueueRoomMessage } from "../jobs"

const ROUTINES_LOCK = "mesh:routine-scheduler"
const SCAN_MS = 30_000

let timer: ReturnType<typeof setInterval> | null = null

export async function runRoutineNow(
  routineId: string,
): Promise<{ success: boolean; error?: string; runId?: string }> {
  const db = getDb()
  const now = new Date()

  const [routine] = await db
    .select()
    .from(routines)
    .where(eq(routines.id, routineId))
    .limit(1)

  if (!routine) {
    return { success: false, error: "Routine not found" }
  }

  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, routine.agentId))
    .limit(1)

  if (!agent) {
    return { success: false, error: `Assigned agent ${routine.agentId} not found` }
  }

  let targetRoomId = routine.roomId
  if (!targetRoomId) {
    const [fallbackRoom] = await db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.orgId, routine.orgId))
      .limit(1)
    targetRoomId = fallbackRoom?.id ?? null
  }

  if (!targetRoomId) {
    return { success: false, error: "No room available to execute routine" }
  }

  const [runRecord] = await db
    .insert(routineRuns)
    .values({
      routineId: routine.id,
      orgId: routine.orgId,
      status: "running",
      startedAt: now,
    })
    .returning({ id: routineRuns.id })

  try {
    const content = `[Routine: ${routine.name}]\n\n@${agent.handle} ${routine.prompt}`
    const [msg] = await db
      .insert(messages)
      .values({
        roomId: targetRoomId,
        threadRootId: null,
        senderType: "system",
        senderId: null,
        content,
        status: "complete",
        mentions: [agent.handle],
        metadata: {
          routineId: routine.id,
          routineRunId: runRecord?.id,
          routineName: routine.name,
          automated: true,
          kind: "routine",
        },
      })
      .returning({ id: messages.id })

    if (msg) {
      await enqueueRoomMessage(targetRoomId, msg.id)
    }

    const nextRun = isValidCron(routine.scheduleExpr)
      ? getNextCronRun(routine.scheduleExpr, now, routine.timezone)
      : null

    await db
      .update(routines)
      .set({
        lastRunAt: now,
        lastStatus: "success",
        lastError: null,
        runCount: routine.runCount + 1,
        nextRunAt: nextRun,
        updatedAt: now,
      })
      .where(eq(routines.id, routine.id))

    if (runRecord) {
      await db
        .update(routineRuns)
        .set({
          status: "success",
          finishedAt: new Date(),
          output: `Enqueued routine prompt message ${msg?.id} to room ${targetRoomId}`,
        })
        .where(eq(routineRuns.id, runRecord.id))
    }

    return { success: true, runId: runRecord?.id }
  } catch (err: any) {
    const errMsg = err?.message ?? String(err)

    await db
      .update(routines)
      .set({
        lastRunAt: now,
        lastStatus: "failed",
        lastError: errMsg,
        updatedAt: now,
      })
      .where(eq(routines.id, routine.id))

    if (runRecord) {
      await db
        .update(routineRuns)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: errMsg,
        })
        .where(eq(routineRuns.id, runRecord.id))
    }

    return { success: false, error: errMsg }
  }
}

async function scanRoutinesOnce(): Promise<void> {
  const db = getDb()
  const now = new Date()

  // 1. Initialise nextRunAt for enabled routines where it is missing
  const uninitialized = await db
    .select({
      id: routines.id,
      scheduleExpr: routines.scheduleExpr,
      timezone: routines.timezone,
    })
    .from(routines)
    .where(and(eq(routines.enabled, true), eq(routines.lastStatus, "idle")))
    .limit(20)

  for (const item of uninitialized) {
    if (isValidCron(item.scheduleExpr)) {
      const nextRun = getNextCronRun(item.scheduleExpr, now, item.timezone)
      if (nextRun) {
        await db
          .update(routines)
          .set({ nextRunAt: nextRun, updatedAt: now })
          .where(and(eq(routines.id, item.id), eq(routines.lastStatus, "idle")))
      }
    }
  }

  // 2. Fetch routines that are due to execute
  const due = await db
    .select()
    .from(routines)
    .where(and(eq(routines.enabled, true), lte(routines.nextRunAt, now)))
    .limit(10)

  for (const routine of due) {
    // Atomically claim the routine
    const [claimed] = await db
      .update(routines)
      .set({ lastStatus: "running", updatedAt: now })
      .where(and(eq(routines.id, routine.id), eq(routines.enabled, true)))
      .returning({ id: routines.id })

    if (!claimed) continue

    void runRoutineNow(routine.id).catch((err) =>
      console.error(`[routines] routine run failed for ${routine.id}`, err),
    )
  }
}

async function guardedScan(): Promise<void> {
  const pool = getPool()
  const client = await pool.connect()
  try {
    const { rows } = await client.query(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [ROUTINES_LOCK],
    )
    if (!rows[0]?.locked) return
    try {
      await scanRoutinesOnce()
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [ROUTINES_LOCK])
    }
  } finally {
    client.release()
  }
}

export function startRoutineScheduler(): void {
  if (timer) return
  const run = () => {
    void guardedScan().catch((error) => console.error("[routines] scheduler scan failed", error))
  }
  run()
  timer = setInterval(run, SCAN_MS)
  timer.unref?.()
  console.log("[routines] routine scheduler online")
}

export function stopRoutineScheduler(): void {
  if (!timer) return
  clearInterval(timer)
  timer = null
}
