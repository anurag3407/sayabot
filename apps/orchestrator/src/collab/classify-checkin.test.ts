import { describe, expect, it, vi } from "vitest"
import { getTableName } from "drizzle-orm"

const postedMessages: any[] = []

vi.mock("./index", async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    resolveAgentRoomId: vi.fn(
      async (_agent, roomId) => roomId || "00000000-0000-0000-0000-000000000001",
    ),
    postAgentMessage: vi.fn(async (_agent, opts) => {
      const msg = { message_id: `msg-${postedMessages.length + 1}`, ...opts }
      postedMessages.push(msg)
      return msg
    }),
  }
})

import { classifyAndRecordCheckin } from "./classify-checkin"

function createMockDb(opts: {
  checkinMode: "stream" | "digest"
  lastReportedAt: Date
  events: Array<{ id: string; taskId: string; createdAt: Date }>
}) {
  const readsUpserts: any[] = []

  const db: any = {
    select: () => ({
      from: (table: any) => {
        let tableName = ""
        try {
          tableName = getTableName(table)
        } catch {
          tableName = table?._?.name ?? ""
        }

        return {
          where: () => ({
            limit: () => {
              if (tableName === "agent_reads") {
                return [{ lastReportedAt: opts.lastReportedAt }]
              }
              if (tableName === "room_schedules") {
                return [{ checkinMode: opts.checkinMode }]
              }
              if (tableName === "task_events") {
                return opts.events.filter((e) => e.createdAt > opts.lastReportedAt)
              }
              return []
            },
            then: (resolve: any) => {
              const matched = opts.events.filter((e) => e.createdAt > opts.lastReportedAt)
              return Promise.resolve(resolve(matched))
            },
          }),
        }
      },
    }),
    insert: () => ({
      values: (vals: any) => ({
        onConflictDoUpdate: async () => {
          readsUpserts.push(vals)
          return [vals]
        },
      }),
    }),
  }

  return { db, readsUpserts }
}

describe("classifyAndRecordCheckin", () => {
  const agent = {
    agentId: "agent-1",
    orgId: "org-1",
    handle: "testbot",
  }
  const roomId = "00000000-0000-0000-0000-000000000001"

  it("digest mode: no_change checkin suppresses room message and records digest entry", async () => {
    postedMessages.length = 0
    const { db, readsUpserts } = createMockDb({
      checkinMode: "digest",
      lastReportedAt: new Date(Date.now() - 3600_000),
      events: [],
    })

    const res = await classifyAndRecordCheckin(
      agent,
      {
        roomId,
        noChange: true,
      },
      db,
    )

    expect(res.posted).toBe(false)
    expect(res.isChanged).toBe(false)
    expect(res.mode).toBe("digest")
    expect(postedMessages.length).toBe(0)
    expect(readsUpserts.length).toBe(1)
  })

  it("digest mode: changed checkin with valid cited task event posts room message", async () => {
    postedMessages.length = 0
    const eventTime = new Date(Date.now() - 1000)
    const validEventId = "00000000-0000-0000-0000-000000000042"
    const { db } = createMockDb({
      checkinMode: "digest",
      lastReportedAt: new Date(Date.now() - 3600_000),
      events: [{ id: validEventId, taskId: "task-1", createdAt: eventTime }],
    })

    const res = await classifyAndRecordCheckin(
      agent,
      {
        roomId,
        summary: "Completed search index optimization",
        changed: [{ eventId: validEventId }],
      },
      db,
    )

    expect(res.posted).toBe(true)
    expect(res.isChanged).toBe(true)
    expect(res.validEventCount).toBe(1)
    expect(postedMessages.length).toBe(1)
    expect(postedMessages[0].metadata?.changed).toBe(true)
  })

  it("digest mode: claimed change with no citable event is recorded as no_change and flagged as manufactured trivia", async () => {
    postedMessages.length = 0
    const { db } = createMockDb({
      checkinMode: "digest",
      lastReportedAt: new Date(Date.now() - 3600_000),
      events: [],
    })

    const res = await classifyAndRecordCheckin(
      agent,
      {
        roomId,
        summary: "I looked through 10 files and did some reading",
        changed: [{ eventId: "00000000-0000-0000-0000-000000000099" }],
      },
      db,
    )

    expect(res.posted).toBe(false)
    expect(res.isChanged).toBe(false)
    expect(res.manufacturedTrivia).toBe(true)
    expect(postedMessages.length).toBe(0)
  })

  it("stream mode: no_change checkin posts with quiet fold metadata", async () => {
    postedMessages.length = 0
    const { db } = createMockDb({
      checkinMode: "stream",
      lastReportedAt: new Date(Date.now() - 3600_000),
      events: [],
    })

    const res = await classifyAndRecordCheckin(
      agent,
      {
        roomId,
        noChange: true,
      },
      db,
    )

    expect(res.posted).toBe(true)
    expect(res.isChanged).toBe(false)
    expect(res.quiet).toBe(true)
    expect(postedMessages.length).toBe(1)
    expect(postedMessages[0].metadata?.quiet).toBe(true)
  })
})
