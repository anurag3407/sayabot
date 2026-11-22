import { describe, expect, it } from "vitest"
import { createDb } from "@sayabot/db"
import { runAllMigrations } from "@sayabot/db"
import { seedLocalWorkspace } from "@sayabot/db"
import { agents, messages, routineRuns, routines } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { getNextCronRun, humanReadableCron, isValidCron } from "@sayabot/core"

describe("End-to-End Workflow & Routine Execution Pipeline on PGlite", () => {
  it("executes the full routine lifecycle: creation, scheduling, claim, execution, and result recording", async () => {
    // 1. Boot local in-memory PostgreSQL instance with PGlite
    const { db, pool } = createDb("memory")
    await runAllMigrations(pool, { quiet: true })
    const seed = await seedLocalWorkspace(db, pool)

    const orgId = seed.orgId
    const agentId = seed.agentId
    const roomId = seed.roomId

    // 2. Insert a routine with a cron schedule: '0 9 * * 1-5' (Weekdays at 9:00 AM)
    const scheduleExpr = "0 9 * * 1-5"
    expect(isValidCron(scheduleExpr)).toBe(true)
    expect(humanReadableCron(scheduleExpr)).toContain("09:00")

    const now = new Date()
    const initialNextRun = getNextCronRun(scheduleExpr, now, "UTC")
    expect(initialNextRun).toBeInstanceOf(Date)

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
        nextRunAt: initialNextRun,
        runCount: 0,
        metadata: { deliverTo: null },
      })
      .returning()

    const createdRoutine = insertedRoutines[0]!
    expect(createdRoutine).toBeDefined()
    expect(createdRoutine.name).toBe("Morning Standup Briefing")
    expect(createdRoutine.runCount).toBe(0)

    // 3. Simulate time elapsed: the routine is now due (nextRunAt <= now)
    const pastTime = new Date(Date.now() - 60_000)
    await db
      .update(routines)
      .set({ nextRunAt: pastTime })
      .where(eq(routines.id, createdRoutine.id))

    // 4. Test atomic claim of due routine (the exact SQL pattern used in scanRoutinesOnce)
    const dueRoutines = await db
      .select()
      .from(routines)
      .where(eq(routines.enabled, true))

    const due = dueRoutines.filter((r) => r.nextRunAt && r.nextRunAt <= new Date())
    expect(due).toHaveLength(1)

    const claimedRoutines = await db
      .update(routines)
      .set({ lastStatus: "running", updatedAt: new Date() })
      .where(eq(routines.id, due[0]!.id))
      .returning()

    const claimed = claimedRoutines[0]!
    expect(claimed).toBeDefined()
    expect(claimed.lastStatus).toBe("running")

    // 5. Test execution: insert routine_runs audit row
    const runAudits = await db
      .insert(routineRuns)
      .values({
        routineId: claimed.id,
        orgId: claimed.orgId,
        status: "running",
        startedAt: new Date(),
      })
      .returning()

    const runAudit = runAudits[0]!
    expect(runAudit).toBeDefined()
    expect(runAudit.status).toBe("running")

    // 6. Test system trigger message generation into the target room
    const agentRows = await db.select().from(agents).where(eq(agents.id, claimed.agentId))
    const agent = agentRows[0]!
    expect(agent).toBeDefined()

    const triggerContent = `[Routine: ${claimed.name}]\n\n@${agent.handle} ${claimed.prompt}`
    const triggerMsgs = await db
      .insert(messages)
      .values({
        roomId,
        threadRootId: null,
        senderType: "system",
        senderId: null,
        content: triggerContent,
        status: "complete",
        mentions: [agent.handle],
        metadata: {
          routineId: claimed.id,
          routineRunId: runAudit.id,
          routineName: claimed.name,
          automated: true,
          kind: "routine",
        },
      })
      .returning()

    const triggerMsg = triggerMsgs[0]!
    expect(triggerMsg).toBeDefined()
    expect(triggerMsg.content).toContain("@" + agent.handle)
    expect((triggerMsg.metadata as Record<string, unknown>).routineId).toBe(claimed.id)

    // 7. Advance routine schedule
    const nextExecution = getNextCronRun(claimed.scheduleExpr, new Date(), claimed.timezone)
    await db
      .update(routines)
      .set({
        lastRunAt: new Date(),
        lastStatus: "success",
        runCount: claimed.runCount + 1,
        nextRunAt: nextExecution,
        updatedAt: new Date(),
      })
      .where(eq(routines.id, claimed.id))

    const updatedRoutines = await db
      .select()
      .from(routines)
      .where(eq(routines.id, claimed.id))

    const updatedRoutine = updatedRoutines[0]!
    expect(updatedRoutine.runCount).toBe(1)
    expect(updatedRoutine.lastStatus).toBe("success")
    expect(updatedRoutine.nextRunAt!.getTime()).toBeGreaterThan(Date.now())

    // 8. Simulate agent completion: update routine_runs with output deliverable
    const simulatedAgentReply = "Standup Briefing: 3 open PRs, all tests passing, no blockers."
    await db
      .update(routineRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        output: simulatedAgentReply,
      })
      .where(eq(routineRuns.id, runAudit.id))

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
