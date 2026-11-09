import { describe, expect, it, vi } from "vitest"
import { cronjobTool } from "./cronjob"

const mockRoutinesTable: any[] = []

vi.mock("../../db", () => ({
  getDb: () => ({
    insert: () => ({
      values: (val: any) => ({
        returning: () => {
          const item = { ...val, id: "routine-test-123", createdAt: new Date() }
          mockRoutinesTable.push(item)
          return Promise.resolve([item])
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(mockRoutinesTable),
          }),
          limit: () => Promise.resolve([mockRoutinesTable[0]]),
        }),
      }),
    }),
    update: () => ({
      set: (val: any) => ({
        where: () => ({
          returning: () => {
            if (mockRoutinesTable[0]) {
              Object.assign(mockRoutinesTable[0], val)
            }
            return Promise.resolve([mockRoutinesTable[0]])
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve([{ id: "routine-test-123", name: "Daily Standup" }]),
      }),
    }),
  }),
}))

vi.mock("../../scheduler/routines", () => ({
  runRoutineNow: vi.fn().mockResolvedValue({ success: true, runId: "run-abc-123" }),
}))

describe("cronjob tool", () => {
  const tool = cronjobTool({
    orgId: "org-1",
    agentId: "agent-1",
    roomId: "room-1",
  })

  it("creates a routine from natural language schedule", async () => {
    const result = (await tool.execute({
      action: "create",
      name: "Daily Standup",
      schedule: "daily at 9am",
      prompt: "Summarize previous day and outline focus tasks.",
      timezone: "UTC",
    })) as any

    expect(result.success).toBe(true)
    expect(result.routine.schedule).toBe("0 9 * * *")
    expect(result.routine.humanSchedule).toBe("Daily at 09:00")
    expect(result.routine.nextRunAt).toBeDefined()
  })

  it("rejects invalid cron schedule expression", async () => {
    const result = (await tool.execute({
      action: "create",
      name: "Bad Schedule",
      schedule: "every 500 hours and bananas",
      prompt: "test",
    })) as any

    expect(result.error).toBeDefined()
    expect(result.error).toContain("Invalid cron schedule")
  })

  it("lists existing routines with human readable schedule", async () => {
    const result = (await tool.execute({
      action: "list",
    })) as any

    expect(result.routines).toBeDefined()
    expect(result.routines.length).toBeGreaterThan(0)
    expect(result.routines[0].humanSchedule).toBe("Daily at 09:00")
  })

  it("pauses and resumes a routine", async () => {
    const pauseRes = (await tool.execute({
      action: "pause",
      id: "routine-test-123",
    })) as any
    expect(pauseRes.success).toBe(true)
    expect(pauseRes.message).toContain("paused")

    const resumeRes = (await tool.execute({
      action: "resume",
      id: "routine-test-123",
    })) as any
    expect(resumeRes.success).toBe(true)
    expect(resumeRes.message).toContain("resumed")
  })

  it("triggers immediate execution", async () => {
    const runRes = (await tool.execute({
      action: "run",
      id: "routine-test-123",
    })) as any
    expect(runRes.success).toBe(true)
    expect(runRes.runId).toBe("run-abc-123")
  })

  it("removes a routine", async () => {
    const removeRes = (await tool.execute({
      action: "remove",
      id: "routine-test-123",
    })) as any
    expect(removeRes.success).toBe(true)
    expect(removeRes.message).toContain("removed")
  })
})
