import { describe, expect, it } from "vitest"
import { applyTaskMutation, autoCloseMootRequests } from "./tasks-service"

interface MockTask {
  id: string
  number: number
  orgId: string
  roomId: string
  kind: "task" | "request"
  title: string
  description: string
  status: "open" | "in_progress" | "stuck" | "done"
  assigneeUserId: string | null
  assigneeAgentId: string | null
  dueAt: Date | null
  statusChangedAt: Date
  completedAt: Date | null
  unblockNeeds: string | null
  unblockDetail: string | null
  blockedBy: string[]
  outcomeKind: string | null
  outcomeRef: string | null
  expiresAt?: Date | null
  metadata: Record<string, unknown>
}

function createMockDb(initialTasks: MockTask[]) {
  const tasksMap = new Map(initialTasks.map((t) => [t.id, { ...t }]))
  const events: any[] = []
  const comments: any[] = []

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

  const tx: any = {
    select: () => ({
      from: () => ({
        where: (condition: any) => {
          const strings = extractStrings(condition)
          const matchedId = strings.find((s) => tasksMap.has(s))
          let matched: MockTask[] = []

          if (matchedId) {
            const row = tasksMap.get(matchedId)
            matched = row ? [{ ...row }] : []
          } else if (strings.includes("request")) {
            matched = Array.from(tasksMap.values()).filter(
              (t) => t.kind === "request" && (!strings.includes("open") || t.status === "open"),
            )
          } else {
            matched = Array.from(tasksMap.values()).map((r) => ({ ...r }))
          }

          return {
            limit: (n: number) => matched.slice(0, n),
            then: (resolve: any) => Promise.resolve(resolve(matched)),
          }
        },
      }),
    }),
    update: () => ({
      set: (updates: any) => ({
        where: (condition: any) => {
          const strings = extractStrings(condition)
          const matchedId = strings.find((s) => tasksMap.has(s))
          const row = matchedId ? tasksMap.get(matchedId) : Array.from(tasksMap.values())[0]
          if (row) Object.assign(row, updates)
          return {
            returning: async () => (row ? [{ ...row }] : []),
            then: (resolve: any) => Promise.resolve(resolve(row ? [{ ...row }] : [])),
          }
        },
      }),
    }),
    insert: () => ({
      values: (vals: any) => {
        const row = { id: `event-${events.length + 1}`, ...vals }
        events.push(row)
        return {
          returning: async () => [row],
          then: (resolve: any) => Promise.resolve(resolve([row])),
        }
      },
    }),
  }

  const db: any = {
    transaction: async (cb: any) => cb(tx),
  }

  return { db, tasksMap, events, comments }
}

describe("applyTaskMutation invariant checks", () => {
  const baseTask: MockTask = {
    id: "task-1",
    number: 101,
    orgId: "org-1",
    roomId: "room-1",
    kind: "task",
    title: "Implement indexing for search",
    description: "Build fast vector search",
    status: "open",
    assigneeUserId: null,
    assigneeAgentId: "agent-1",
    dueAt: null,
    statusChangedAt: new Date("2026-11-01T10:00:00Z"),
    completedAt: null,
    unblockNeeds: null,
    unblockDetail: null,
    blockedBy: [],
    outcomeKind: null,
    outcomeRef: null,
    metadata: {},
  }

  it("invariant: title is immutable after creation", async () => {
    const { db } = createMockDb([baseTask])
    await expect(
      applyTaskMutation(
        {
          taskId: "task-1",
          actor: { type: "agent", id: "agent-1" },
          title: "Renamed Title Should Fail",
        },
        db,
      ),
    ).rejects.toThrow("title is immutable after creation")
  })

  it("invariant: done requires completed_at and outcome_kind", async () => {
    const { db } = createMockDb([baseTask])
    await expect(
      applyTaskMutation(
        {
          taskId: "task-1",
          actor: { type: "agent", id: "agent-1" },
          status: "done",
          // outcome omitted
        },
        db,
      ),
    ).rejects.toThrow("done tasks require an outcome (kind and optional ref)")
  })

  it("invariant: done with outcome.kind = 'none' is human-only", async () => {
    const { db } = createMockDb([baseTask])
    await expect(
      applyTaskMutation(
        {
          taskId: "task-1",
          actor: { type: "agent", id: "agent-1" },
          status: "done",
          outcome: { kind: "none" },
        },
        db,
      ),
    ).rejects.toThrow("agents cannot close tasks with outcome 'none'")

    // Human actor with outcome 'none' succeeds
    const result = await applyTaskMutation(
      {
        taskId: "task-1",
        actor: { type: "human", id: "user-1" },
        status: "done",
        outcome: { kind: "none" },
      },
      db,
    )
    expect(result.task.status).toBe("done")
    expect(result.task.outcomeKind).toBe("none")
    expect(result.task.completedAt).not.toBeNull()
  })

  it("invariant: stuck requires unblock_needs", async () => {
    const { db } = createMockDb([baseTask])
    await expect(
      applyTaskMutation(
        {
          taskId: "task-1",
          actor: { type: "agent", id: "agent-1" },
          status: "stuck",
          // unblockNeeds omitted
        },
        db,
      ),
    ).rejects.toThrow("marking a task stuck requires unblock_needs")
  })

  it("invariant: stuck with human_answer requires form evidence for agent actors", async () => {
    const { db } = createMockDb([baseTask])
    await expect(
      applyTaskMutation(
        {
          taskId: "task-1",
          actor: { type: "agent", id: "agent-1" },
          status: "stuck",
          unblockNeeds: "human_answer",
          unblockDetail: "Need your GPA score",
        },
        db,
      ),
    ).rejects.toThrow(
      "cannot claim a human-fact blocker before reading the form that would ask for it",
    )
  })

  it("invariant: stuck with human_answer succeeds when formRef is provided", async () => {
    const { db, events } = createMockDb([baseTask])
    const result = await applyTaskMutation(
      {
        taskId: "task-1",
        actor: { type: "agent", id: "agent-1" },
        status: "stuck",
        unblockNeeds: "human_answer",
        unblockDetail: "Need confirmation for field",
        metadata: { formRef: "https://lever.co/company/jobs/42/apply" },
      },
      db,
    )
    expect(result.task.status).toBe("stuck")
    expect(result.task.unblockNeeds).toBe("human_answer")
    expect(events.length).toBe(1)
    expect(events[0].toStatus).toBe("stuck")
  })

  it("invariant: stuck with human_answer succeeds when unblockDetail cites form and field", async () => {
    const { db, events } = createMockDb([baseTask])
    const result = await applyTaskMutation(
      {
        taskId: "task-1",
        actor: { type: "agent", id: "agent-1" },
        status: "stuck",
        unblockNeeds: "human_answer",
        unblockDetail: "The job application form requires your official legal name field",
      },
      db,
    )
    expect(result.task.status).toBe("stuck")
    expect(result.task.unblockNeeds).toBe("human_answer")
    expect(events.length).toBe(1)
    expect(events[0].toStatus).toBe("stuck")
  })

  it("invariant: human actor can mark stuck with human_answer without form restriction", async () => {
    const { db } = createMockDb([baseTask])
    const result = await applyTaskMutation(
      {
        taskId: "task-1",
        actor: { type: "human", id: "user-1" },
        status: "stuck",
        unblockNeeds: "human_answer",
        unblockDetail: "Waiting on answer",
      },
      db,
    )
    expect(result.task.status).toBe("stuck")
    expect(result.task.unblockNeeds).toBe("human_answer")
  })

  it("invariant: stuck with other unblock_needs (credential, etc.) succeeds without form restriction", async () => {
    const { db, events } = createMockDb([baseTask])
    const result = await applyTaskMutation(
      {
        taskId: "task-1",
        actor: { type: "agent", id: "agent-1" },
        status: "stuck",
        unblockNeeds: "credential",
        unblockDetail: "Waiting on AWS credential confirmation",
      },
      db,
    )
    expect(result.task.status).toBe("stuck")
    expect(result.task.unblockNeeds).toBe("credential")
    expect(events.length).toBe(1)
    expect(events[0].toStatus).toBe("stuck")
  })

  it("invariant: completing a task auto-closes open requests linked to it with typed events", async () => {
    const linkedRequest: MockTask = {
      id: "req-1",
      number: 202,
      orgId: "org-1",
      roomId: "room-1",
      kind: "request",
      title: "Confirm budget",
      description: "Need confirmation",
      status: "open",
      assigneeUserId: null,
      assigneeAgentId: null,
      dueAt: null,
      statusChangedAt: new Date(),
      completedAt: null,
      unblockNeeds: null,
      unblockDetail: null,
      blockedBy: [],
      outcomeKind: null,
      outcomeRef: null,
      metadata: { taskId: "task-1" },
    }

    const { db, tasksMap, events } = createMockDb([baseTask, linkedRequest])

    const res = await applyTaskMutation(
      {
        taskId: "task-1",
        actor: { type: "agent", id: "agent-1" },
        status: "done",
        outcome: { kind: "artifact", ref: "https://github.com/pull/42" },
      },
      db,
    )

    expect(res.task.status).toBe("done")
    const updatedReq = tasksMap.get("req-1")!
    expect(updatedReq.status).toBe("done")
    expect(updatedReq.outcomeKind).toBe("decision")

    // Verify system typed event for moot request closure
    const mootEvent = events.find((e) => e.taskId === "req-1")
    expect(mootEvent).toBeDefined()
    expect(mootEvent.actorType).toBe("system")
    expect(mootEvent.toStatus).toBe("done")
    expect(mootEvent.reason).toContain("task MESH-101 completed, ask is moot")
  })

  it("autoCloseMootRequests: closes expired requests and requests whose linked tasks are done", async () => {
    const doneTask: MockTask = {
      ...baseTask,
      id: "task-done",
      status: "done",
      outcomeKind: "artifact",
    }
    const expiredReq: MockTask = {
      id: "req-expired",
      number: 301,
      orgId: "org-1",
      roomId: "room-1",
      kind: "request",
      title: "Old question",
      description: "Old",
      status: "open",
      assigneeUserId: null,
      assigneeAgentId: null,
      dueAt: null,
      statusChangedAt: new Date(Date.now() - 80 * 3600_000),
      completedAt: null,
      unblockNeeds: null,
      unblockDetail: null,
      blockedBy: [],
      outcomeKind: null,
      outcomeRef: null,
      expiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
      metadata: {},
    }
    const mootLinkedReq: MockTask = {
      id: "req-linked-done",
      number: 302,
      orgId: "org-1",
      roomId: "room-1",
      kind: "request",
      title: "Already solved task question",
      description: "Solves",
      status: "open",
      assigneeUserId: null,
      assigneeAgentId: null,
      dueAt: null,
      statusChangedAt: new Date(),
      completedAt: null,
      unblockNeeds: null,
      unblockDetail: null,
      blockedBy: [],
      outcomeKind: null,
      outcomeRef: null,
      expiresAt: new Date(Date.now() + 24 * 3600_000),
      metadata: { taskId: "task-done" },
    }

    const { db, tasksMap, events } = createMockDb([doneTask, expiredReq, mootLinkedReq])

    const res = await autoCloseMootRequests({ roomId: "room-1" }, db)
    expect(res.closedCount).toBe(2)
    expect(tasksMap.get("req-expired")!.status).toBe("done")
    expect(tasksMap.get("req-linked-done")!.status).toBe("done")

    const expiredEvent = events.find((e) => e.taskId === "req-expired")
    expect(expiredEvent).toBeDefined()
    expect(expiredEvent.reason).toContain("expired without response (moot)")

    const mootEvent = events.find((e) => e.taskId === "req-linked-done")
    expect(mootEvent).toBeDefined()
    expect(mootEvent.reason).toContain("already done (moot)")
  })

  it("invariant: every status change writes exactly one task_events row in the same transaction", async () => {
    const { db, events } = createMockDb([baseTask])
    const res = await applyTaskMutation(
      {
        taskId: "task-1",
        actor: { type: "agent", id: "agent-1" },
        status: "done",
        outcome: { kind: "artifact", ref: "https://github.com/pull/42" },
      },
      db,
    )
    expect(res.task.status).toBe("done")
    expect(events.length).toBe(1)
    expect(events[0].fromStatus).toBe("open")
    expect(events[0].toStatus).toBe("done")
    expect(events[0].outcomeKind).toBe("artifact")
    expect(events[0].outcomeRef).toBe("https://github.com/pull/42")
  })
})
