import { beforeEach, describe, expect, it, vi } from "vitest"

// Each select chain resolves to the next queued result; inserts/updates are recorded.
const selects: unknown[][] = []
const inserts: Array<Record<string, unknown>> = []
const updates: Array<Record<string, unknown>> = []
function selectChain(): unknown {
  const c: Record<string, unknown> = {}
  for (const m of ["from", "innerJoin", "where", "orderBy"]) c[m] = () => c
  c.limit = () => Promise.resolve(selects.shift() ?? [])
  return c
}
vi.mock("../db", () => ({
  getDb: () => ({
    select: () => selectChain(),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        inserts.push(v)
        return { returning: () => Promise.resolve([{ id: "call-new" }]) }
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v)
        return { where: () => Promise.resolve([]) }
      },
    }),
  }),
}))
const broadcast = vi.fn(() => Promise.resolve())
vi.mock("../realtime", () => ({ broadcast }))
const notifyHumansNeeded = vi.fn()
vi.mock("../push", () => ({ notifyHumansNeeded }))
vi.mock("../tools/approvals", () => ({ waitForApproval: () => new Promise(() => {}) }))

const { recordMacToolEvents, requestMacApproval, storedArgs } = await import("./local-events")

const HOST = "11111111-1111-1111-1111-111111111111"
const job = {
  id: "job-1",
  status: "running",
  hostId: HOST,
  roomId: "room-1",
  runId: "run-1",
  replyMessageId: "msg-1",
  agentId: "agent-1",
  agentName: "Helper",
  hostName: "Anurag's Mac",
  ownerId: "user-1",
}

describe("Mac tool activity", () => {
  beforeEach(() => {
    selects.length = 0
    inserts.length = 0
    updates.length = 0
    broadcast.mockClear()
    notifyHumansNeeded.mockClear()
  })

  it("refuses a job that belongs to another computer", async () => {
    selects.push([{ ...job, hostId: "22222222-2222-2222-2222-222222222222" }])
    await expect(recordMacToolEvents("job-1", HOST, [])).rejects.toThrow("job not found")
  })

  it("refuses a job that is no longer running", async () => {
    selects.push([{ ...job, status: "done" }])
    await expect(recordMacToolEvents("job-1", HOST, [])).rejects.toThrow("not running")
  })

  it("creates a live tool card for a new step, marked as coming from the Mac", async () => {
    selects.push([job], [])
    const ids = await recordMacToolEvents("job-1", HOST, [
      { type: "started", key: "toolu_1", toolName: "Bash", args: { command: "npm test" } },
    ])
    expect(ids).toEqual({ toolu_1: "call-new" })
    expect(inserts[0]).toMatchObject({
      runId: "run-1",
      roomId: "room-1",
      messageId: "msg-1",
      toolName: "Bash",
      status: "running",
      args: {
        command: "npm test",
        _mac: { key: "toolu_1", jobId: "job-1", hostId: HOST, ownerId: "user-1" },
      },
    })
    expect(broadcast).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({ type: "tool.started" }),
    )
  })

  it("turns an existing step into an approval and alerts the owner", async () => {
    selects.push([job], [{ id: "call-1", status: "running", createdAt: new Date() }])
    const result = await requestMacApproval("job-1", HOST, {
      key: "toolu_1",
      toolName: "Bash",
      args: { command: "touch x" },
    })
    expect(result).toEqual({ toolCallId: "call-1" })
    expect(inserts).toHaveLength(0)
    expect(updates[0]).toMatchObject({ status: "pending_approval" })
    expect(broadcast).toHaveBeenCalledWith(
      "room-1",
      expect.objectContaining({ type: "tool.approval_requested", toolCallId: "call-1" }),
    )
    expect(notifyHumansNeeded).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "approval", refId: "call-1" }),
    )
  })

  it("rejects malformed keys and tool names", async () => {
    selects.push([job])
    await expect(
      requestMacApproval("job-1", HOST, { key: "bad key with spaces", toolName: "Bash", args: {} }),
    ).rejects.toThrow("invalid tool key")
  })
})

describe("storedArgs", () => {
  it("drops hidden keys, scrubs secrets and cuts long values", () => {
    const stored = storedArgs({
      _mac: { spoofed: true },
      command:
        "curl -H 'Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789' x",
      content: "a".repeat(5_000),
    })
    expect(stored._mac).toBeUndefined()
    expect(String(stored.command)).not.toContain(
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
    )
    expect(String(stored.content).length).toBeLessThan(2_100)
  })
})
