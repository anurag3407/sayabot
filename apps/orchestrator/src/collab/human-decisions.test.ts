import { describe, expect, it, vi } from "vitest"

const pushNotifications: any[] = []

vi.mock("../push", () => ({
  notifyHumansNeeded: vi.fn((opts) => {
    pushNotifications.push(opts)
  }),
}))

import { requestHumanDecision } from "./index"

function createMockDb() {
  const tasksTable: any[] = []
  const eventsTable: any[] = []

  function extractStrings(cond: any): string[] {
    const result: string[] = []
    if (!cond) return result
    if (typeof cond === "string") return [cond]
    if (Array.isArray(cond.queryChunks)) {
      for (const chunk of cond.queryChunks) {
        if (typeof chunk === "string" && !["", " = ", "(", ")", " and ", " or "].includes(chunk)) {
          result.push(chunk)
        } else if (chunk && typeof chunk === "object") {
          if ("value" in chunk) {
            if (typeof chunk.value === "string") result.push(chunk.value)
          } else if ("queryChunks" in chunk) {
            result.push(...extractStrings(chunk))
          }
        }
      }
    }
    return result
  }

  const db: any = {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () =>
              Promise.resolve([
                { id: "00000000-0000-0000-0000-000000000001", name: "general" },
              ]),
          }),
        }),
        where: (condition: any) => ({
          limit: (n: number) => {
            const strings = extractStrings(condition)
            const matched = tasksTable.filter((t) => strings.includes(t.id))
            if (matched.length) return matched.slice(0, n)

            const openReqs = tasksTable.filter(
              (t) => t.kind === "request" && t.status === "open",
            )
            return openReqs.slice(0, n)
          },
        }),
      }),
    }),
    update: () => ({
      set: (updates: any) => ({
        where: () => {
          const req = tasksTable.find((t) => t.kind === "request" && t.status === "open")
          if (req) Object.assign(req, updates)
          return [req]
        },
      }),
    }),
    insert: (_table: any) => ({
      values: (vals: any) => ({
        returning: async () => {
          const row = { id: `req-${tasksTable.length + 1}`, number: tasksTable.length + 1, ...vals }
          tasksTable.push(row)
          return [row]
        },
        then: (resolve: any) => {
          eventsTable.push(vals)
          return Promise.resolve(resolve([vals]))
        },
      }),
    }),
  }

  return { db, tasksTable, eventsTable }
}

describe("requestHumanDecision deduplication & folding", () => {
  const agent = {
    agentId: "agent-1",
    orgId: "org-1",
    handle: "testbot",
  }
  const roomId = "00000000-0000-0000-0000-000000000001"

  it("invariant: two calls with matching foldKey produce one open request with asked_count=2", async () => {
    pushNotifications.length = 0
    const { db, tasksTable } = createMockDb()

    // Mock getDb in collab
    const dbModule = await import("../db")
    vi.spyOn(dbModule, "getDb").mockReturnValue(db)

    // Call 1: initial request
    const res1 = await requestHumanDecision(agent, {
      roomId,
      question: "Can you please approve the budget for AWS?",
    })

    expect(res1.folded).toBe(false)
    expect(res1.asked_count).toBe(1)
    expect(tasksTable.length).toBe(1)
    expect(pushNotifications.length).toBe(1)

    // Call 2: repeated question (different wording with pleasantries)
    const res2 = await requestHumanDecision(agent, {
      roomId,
      question: "Hey, approve the AWS budget!",
    })

    expect(res2.folded).toBe(true)
    expect(res2.asked_count).toBe(2)
    expect(res2.request_id).toBe(res1.request_id)
    // Invariant: no duplicate row created
    expect(tasksTable.length).toBe(1)
    // Invariant: no duplicate push sent on repeated ask
    expect(pushNotifications.length).toBe(1)
  })

  it("invariant: requestHumanDecision stores taskId in metadata", async () => {
    pushNotifications.length = 0
    const { db, tasksTable } = createMockDb()

    const dbModule = await import("../db")
    vi.spyOn(dbModule, "getDb").mockReturnValue(db)

    tasksTable.push({ id: "task-100", kind: "task", status: "in_progress", number: 100 })

    const res = await requestHumanDecision(agent, {
      roomId,
      taskId: "task-100",
      question: "Which database schema version to migrate?",
    })

    expect(res.status).toBe("waiting_for_human")
    const request = tasksTable.find((t) => t.kind === "request")
    expect(request.metadata?.taskId).toBe("task-100")
  })

  it("invariant: requestHumanDecision rejects asks on already done tasks as moot", async () => {
    const { db, tasksTable } = createMockDb()
    tasksTable.push({
      id: "task-already-done",
      number: 105,
      kind: "task",
      status: "done",
    })

    const dbModule = await import("../db")
    vi.spyOn(dbModule, "getDb").mockReturnValue(db)

    await expect(
      requestHumanDecision(agent, {
        roomId,
        taskId: "task-already-done",
        question: "Should we run extra migrations?",
      }),
    ).rejects.toThrow("task is already done; this ask is moot")
  })
})
