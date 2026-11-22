import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  selectQueue: [] as any[][],
  inserts: [] as any[],
  updates: [] as any[],
  enqueued: [] as { roomId: string; messageId: string }[],
  advisoryLocked: true,
  queryLog: [] as string[],
  releasedClient: false,
}))

vi.mock("../db", () => {
  const chain = () => {
    const q: any = {
      from: () => q,
      where: () => q,
      limit: async () => state.selectQueue.shift() ?? [],
      returning: (_fields?: any) => {
        const item = state.inserts[state.inserts.length - 1] || state.updates[state.updates.length - 1] || { id: "ret-1" }
        return Promise.resolve([item])
      },
      set: (val: any) => {
        state.updates.push(val)
        return q
      },
    }
    return q
  }

  const mockDb = {
    select: chain,
    insert: (_table: any) => ({
      values: (val: any) => {
        const row = { ...val, id: `ins-${state.inserts.length + 1}` }
        state.inserts.push(row)
        return {
          returning: async () => [row],
        }
      },
    }),
    update: (_table: any) => ({
      set: (val: any) => {
        state.updates.push(val)
        return {
          where: () => ({
            returning: async () => [{ id: "claimed-routine-id" }],
          }),
        }
      },
    }),
  }

  const mockClient = {
    query: async (sql: string, _params?: any[]) => {
      state.queryLog.push(sql)
      if (sql.includes("pg_try_advisory_lock")) {
        return { rows: [{ locked: state.advisoryLocked }] }
      }
      if (sql.includes("pg_advisory_unlock")) {
        return { rows: [{ pg_advisory_unlock: true }] }
      }
      return { rows: [] }
    },
    release: () => {
      state.releasedClient = true
    },
  }

  const mockPool = {
    connect: async () => mockClient,
    query: async (sql: string) => mockClient.query(sql),
  }

  return {
    getDb: () => mockDb,
    getPool: () => mockPool,
  }
})

vi.mock("../jobs", () => ({
  enqueueRoomMessage: vi.fn(async (roomId: string, messageId: string) => {
    state.enqueued.push({ roomId, messageId })
  }),
}))

vi.mock("../computers/sleep", () => ({
  sleepIdleBoats: vi.fn(async () => {}),
}))

import {
  guardedScan,
  runRoutineNow,
  scanRoutinesOnce,
  startRoutineScheduler,
  stopRoutineScheduler,
} from "./routines"

describe("routines scheduler and execution", () => {
  beforeEach(() => {
    state.selectQueue = []
    state.inserts = []
    state.updates = []
    state.enqueued = []
    state.advisoryLocked = true
    state.queryLog = []
    state.releasedClient = false
    stopRoutineScheduler()
  })

  describe("runRoutineNow", () => {
    it("returns error if routine is not found", async () => {
      state.selectQueue.push([]) // routine lookup returns nothing
      const res = await runRoutineNow("non-existent-id")
      expect(res.success).toBe(false)
      expect(res.error).toBe("Routine not found")
    })

    it("returns error if assigned agent is not found", async () => {
      const routine = {
        id: "routine-1",
        orgId: "org-1",
        agentId: "agent-missing",
        name: "Morning Digest",
        roomId: "room-1",
      }
      state.selectQueue.push([routine]) // routine found
      state.selectQueue.push([]) // agent lookup returns nothing
      const res = await runRoutineNow("routine-1")
      expect(res.success).toBe(false)
      expect(res.error).toContain("Assigned agent")
    })

    it("falls back to the organization's default room when roomId is null", async () => {
      const routine = {
        id: "routine-1",
        orgId: "org-1",
        agentId: "agent-1",
        name: "Morning Digest",
        roomId: null, // null roomId
        prompt: "Provide daily digest",
        scheduleExpr: "0 9 * * *",
        timezone: "UTC",
        runCount: 0,
        metadata: {},
      }
      const agent = { id: "agent-1", handle: "digestbot" }
      const fallbackRoom = { id: "room-fallback" }

      state.selectQueue.push([routine]) // routine lookup
      state.selectQueue.push([agent]) // agent lookup
      state.selectQueue.push([fallbackRoom]) // fallback room lookup

      const res = await runRoutineNow("routine-1")
      expect(res.success).toBe(true)
      expect(res.runId).toBeDefined()

      // Verify message enqueued into the fallback room
      expect(state.enqueued).toHaveLength(1)
      expect(state.enqueued[0]?.roomId).toBe("room-fallback")

      // Verify message content mentions the agent handle
      const insertedMsg = state.inserts.find((row) => row.senderType === "system")
      expect(insertedMsg).toBeDefined()
      expect(insertedMsg.content).toContain("@digestbot")
      expect(insertedMsg.metadata.routineId).toBe("routine-1")
      expect(insertedMsg.metadata.automated).toBe(true)
    })

    it("executes successfully and advances the cron schedule", async () => {
      const routine = {
        id: "routine-1",
        orgId: "org-1",
        agentId: "agent-1",
        name: "Hourly Check",
        roomId: "room-1",
        prompt: "Run healthcheck",
        scheduleExpr: "0 * * * *",
        timezone: "UTC",
        runCount: 5,
        metadata: {},
      }
      const agent = { id: "agent-1", handle: "checker" }

      state.selectQueue.push([routine])
      state.selectQueue.push([agent])

      const res = await runRoutineNow("routine-1")
      expect(res.success).toBe(true)

      // Verify routine updated with incremented runCount and nextRunAt
      const routineUpdate = state.updates.find((u) => u.runCount === 6)
      expect(routineUpdate).toBeDefined()
      expect(routineUpdate.lastStatus).toBe("success")
      expect(routineUpdate.nextRunAt).toBeInstanceOf(Date)
    })

    it("handles invalid cron expression by degrading nextRunAt to null without throwing", async () => {
      const routine = {
        id: "routine-bad-cron",
        orgId: "org-1",
        agentId: "agent-1",
        name: "Broken Cron",
        roomId: "room-1",
        prompt: "Run once",
        scheduleExpr: "invalid-cron-expr",
        timezone: "UTC",
        runCount: 0,
        metadata: {},
      }
      const agent = { id: "agent-1", handle: "one-shot" }

      state.selectQueue.push([routine])
      state.selectQueue.push([agent])

      const res = await runRoutineNow("routine-bad-cron")
      expect(res.success).toBe(true)

      const routineUpdate = state.updates.find((u) => u.lastStatus === "success")
      expect(routineUpdate.nextRunAt).toBeNull()
    })
  })

  describe("scheduler lifecycle and scanning", () => {
    it("starts and stops scheduler interval cleanly", () => {
      startRoutineScheduler()
      // Calling start again is idempotent
      startRoutineScheduler()
      stopRoutineScheduler()
      // Calling stop again is safe
      stopRoutineScheduler()
    })

    it("acquires advisory lock and scans due routines in guardedScan", async () => {
      state.advisoryLocked = true
      state.selectQueue.push([]) // uninitialized routines
      state.selectQueue.push([]) // due routines

      await guardedScan()

      expect(state.queryLog.some((q) => q.includes("pg_try_advisory_lock"))).toBe(true)
      expect(state.queryLog.some((q) => q.includes("pg_advisory_unlock"))).toBe(true)
      expect(state.releasedClient).toBe(true)
    })

    it("skips scan if advisory lock is already held by another instance", async () => {
      state.advisoryLocked = false // simulate another instance holding the lock

      await guardedScan()

      expect(state.releasedClient).toBe(true)
      // When lock is false, no select queue should have been popped
      expect(state.enqueued).toHaveLength(0)
    })
  })
})
