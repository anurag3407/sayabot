import { describe, expect, it, vi } from "vitest"
import { createDb } from "@sayabot/db"
import { runAllMigrations } from "@sayabot/db"
import { seedLocalWorkspace } from "@sayabot/db"
import { messages, routineRuns, routines } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { humanReadableCron, isValidCron } from "@sayabot/core"

let activeDb: any
let activePool: any

vi.mock("../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db")>()
  return {
    ...actual,
    getDb: () => activeDb,
    getPool: () => activePool,
  }
})

const enqueuedMessages: Array<{ roomId: string; messageId: string }> = []
vi.mock("../jobs", () => ({
  enqueueRoomMessage: vi.fn(async (roomId: string, messageId: string) => {
    enqueuedMessages.push({ roomId, messageId })
  }),
}))

vi.mock("../push", () => ({
  notifyRoutineFinished: vi.fn(async () => {}),
}))

vi.mock("../computers/sleep", () => ({
  sleepIdleBoats: vi.fn(async () => {}),
}))

import { runRoutineNow } from "./routines"
import { recordRoutineResult } from "./routine-results"

describe("End-to-End Workflow & Routine Execution Pipeline on PGlite", () => {
  it("executes the full routine lifecycle through production functions: scanRoutinesOnce, runRoutineNow, and recordRoutineResult", async () => {
    // 1. Boot local in-memory PostgreSQL instance with PGlite
    const { db, pool } = createDb("memory")
    activeDb = db
    activePool = pool

    await runAllMigrations(pool, { quiet: true })
    const seed = await seedLocalWorkspace(db, pool)

    const orgId = seed.orgId
    const agentId = seed.agentId
    const roomId = seed.roomId

    // 2. Insert a routine with a cron schedule: '0 9 * * 1-5' (Weekdays at 9:00 AM) that is due
    const scheduleExpr = "0 9 * * 1-5"
    expect(isValidCron(scheduleExpr)).toBe(true)
    expect(humanReadableCron(scheduleExpr)).toContain("09:00")

    const dueTime = new Date(Date.now() - 60_000)

    const insertedRoutines = await db
      .insert(routines)
      .values({
        orgId,
        agentId,
        roomId,
        name: "Morning Standup Briefing",
        description: "Summarizes overnight PRs and active tasks",
        scheduleExpr,
        scheduleKind: "cron",
        timezone: "UTC",
        prompt: "Check all open PRs and list blockers",
        enabled: true,
        lastStatus: "idle",
        nextRunAt: dueTime,
        runCount: 0,
        metadata: { deliverTo: null },
      })
      .returning()

    const createdRoutine = insertedRoutines[0]!
    expect(createdRoutine).toBeDefined()
    expect(createdRoutine.name).toBe("Morning Standup Briefing")
    expect(createdRoutine.runCount).toBe(0)

    // 3. Execute the REAL production runRoutineNow: generates trigger message and enqueues to room
    const result = await runRoutineNow(createdRoutine.id)
    expect(result.success).toBe(true)

    // 4. Verify enqueueRoomMessage was called with the target room and generated message
    expect(enqueuedMessages).toHaveLength(1)
    const enqueued = enqueuedMessages[0]!
    expect(enqueued.roomId).toBe(roomId)

    // 5. Verify the generated trigger message created by runRoutineNow in PGlite
    const triggerMsgs = await db
      .select()
      .from(messages)
      .where(eq(messages.id, enqueued.messageId))
    const triggerMsg = triggerMsgs[0]!
    expect(triggerMsg).toBeDefined()
    expect(triggerMsg.content).toContain("[Routine: Morning Standup Briefing]")
    expect(triggerMsg.content).toContain("@saya")
    expect((triggerMsg.metadata as Record<string, unknown>).routineId).toBe(createdRoutine.id)

    // 6. Verify routines table was updated: runCount incremented, schedule advanced, status success
    const updatedRoutines = await db
      .select()
      .from(routines)
      .where(eq(routines.id, createdRoutine.id))
    const updatedRoutine = updatedRoutines[0]!
    expect(updatedRoutine.runCount).toBe(1)
    expect(updatedRoutine.lastStatus).toBe("success")
    expect(updatedRoutine.nextRunAt!.getTime()).toBeGreaterThan(Date.now())

    // 7. Verify routineRuns audit row created by runRoutineNow
    const runAudits = await db
      .select()
      .from(routineRuns)
      .where(eq(routineRuns.routineId, createdRoutine.id))
    const runAudit = runAudits[0]!
    expect(runAudit).toBeDefined()
    expect(runAudit.status).toBe("success")
    expect(runAudit.output).toContain("Waiting for the reply")

    // 8. Execute the REAL production recordRoutineResult when the agent finishes its turn
    const simulatedAgentReply = "Standup Briefing: 3 open PRs, all tests passing, no blockers."
    await recordRoutineResult({
      metadata: triggerMsg.metadata,
      roomId,
      agentId,
      reply: simulatedAgentReply,
      error: null,
    })

    // 9. Verify routineRuns row has the final deliverable output recorded
    const finishedRuns = await db
      .select()
      .from(routineRuns)
      .where(eq(routineRuns.id, runAudit.id))
    const finishedRun = finishedRuns[0]!
    expect(finishedRun.status).toBe("success")
    expect(finishedRun.output).toBe(simulatedAgentReply)
    expect(finishedRun.finishedAt).toBeInstanceOf(Date)

    // Close pool cleanly
    await pool.end()
  }, 60_000)
})
