import { describe, expect, it, vi, beforeEach } from "vitest"
import { toAuditedTools, type ToolSpec, type ToolRuntime } from "./audited"
import { z } from "zod"

const broadcastEvents: Array<{ roomId: string; event: any }> = []

vi.mock("../realtime", () => ({
  broadcast: (roomId: string, event: any) => {
    broadcastEvents.push({ roomId, event })
    return Promise.resolve()
  },
}))

const insertedToolCallId = "tool-call-123"
const lastInsertedValues: any[] = []
const roomState = { mode: "ask_risky" as string }

vi.mock("../db", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ mode: roomState.mode }]),
        }),
      }),
    }),
    insert: () => ({
      values: (val: any) => {
        lastInsertedValues.push(val)
        return {
          returning: () => Promise.resolve([{ id: insertedToolCallId }]),
        }
      },
    }),
    update: () => ({
      set: () => ({
        where: () => Promise.resolve(),
      }),
    }),
  }),
}))

vi.mock("../push", () => ({
  notifyHumansNeeded: vi.fn(),
}))

vi.mock("./approvals", () => ({
  waitForApproval: vi.fn().mockResolvedValue("approved"),
  resolveApprovalWaiter: vi.fn(),
}))

describe("toAuditedTools", () => {
  beforeEach(() => {
    broadcastEvents.length = 0
    lastInsertedValues.length = 0
    roomState.mode = "ask_risky"
  })

  const readSpec: ToolSpec = {
    name: "read_tool",
    description: "Reads something",
    schema: z.object({}),
    dangerous: false,
    execute: async () => ({ ok: true }),
  }
  const runtime: ToolRuntime = { orgId: "org-1", roomId: "room-1", agentId: "agent-1" }

  it("lets a safe tool run without asking in the default mode", async () => {
    const toolSet = toAuditedTools([readSpec], runtime)
    await (toolSet.read_tool as any).execute({}, {})
    expect(lastInsertedValues[0]?.status).toBe("running")
    expect(broadcastEvents.some((e) => e.event.type === "tool.approval_requested")).toBe(false)
  })

  it("asks before every tool when the room reviews every step", async () => {
    roomState.mode = "review_all"
    const toolSet = toAuditedTools([readSpec], runtime)
    await (toolSet.read_tool as any).execute({}, {})
    expect(lastInsertedValues[0]?.status).toBe("pending_approval")
    expect(broadcastEvents.some((e) => e.event.type === "tool.approval_requested")).toBe(true)
  })

  it("threads toolCallId into ctx and broadcasts tool.started and tool.finished", async () => {
    let receivedToolCallId = ""

    const dummySpec: ToolSpec = {
      name: "test_tool",
      description: "A test tool",
      schema: z.object({ query: z.string() }),
      dangerous: false,
      execute: async (input, signal, ctx) => {
        receivedToolCallId = ctx?.toolCallId ?? ""
        return { result: "ok for " + input.query }
      },
    }

    const runtime: ToolRuntime = {
      orgId: "org-1",
      roomId: "room-1",
      agentId: "agent-1",
      runId: "run-1",
      messageId: "msg-1",
    }

    const toolSet = toAuditedTools([dummySpec], runtime)
    const result = await (toolSet.test_tool as any).execute({ query: "hello" }, {})

    expect(receivedToolCallId).toBe("tool-call-123")
    expect(result).toEqual({ result: "ok for hello" })

    // Check broadcast events
    const started = broadcastEvents.find((e) => e.event.type === "tool.started")
    expect(started).toBeDefined()
    expect(started?.event.toolCallId).toBe("tool-call-123")
    expect(started?.event.toolName).toBe("test_tool")

    const finished = broadcastEvents.find((e) => e.event.type === "tool.finished")
    expect(finished).toBeDefined()
    expect(finished?.event.toolCallId).toBe("tool-call-123")
    expect(finished?.event.status).toBe("done")
    expect(finished?.event.durationMs).toBeGreaterThanOrEqual(0)
  })

  it("redacts secrets in results and errors before sending them to the model", async () => {
    const runtime = { orgId: "org", roomId: "room", agentId: "agent", scrub: (s: string) => s.replaceAll("private-value", "[REDACTED]") }
    const specs: ToolSpec[] = [
      { name: "success", description: "", schema: z.object({}), dangerous: false, execute: async () => ({ value: "private-value" }) },
      { name: "failure", description: "", schema: z.object({}), dangerous: false, execute: async () => { throw new Error("private-value") } },
    ]
    const tools = toAuditedTools(specs, runtime)
    expect(JSON.stringify(await (tools.success as any).execute({}, {}))).not.toContain("private-value")
    expect(JSON.stringify(await (tools.failure as any).execute({}, {}))).not.toContain("private-value")
  })

  it("does not execute a cancelled non-dangerous call", async () => {
    const execute = vi.fn()
    const tools = toAuditedTools([{ name: "write", description: "", schema: z.object({}), dangerous: false, execute }], { orgId: "o", roomId: "r", agentId: "a" })
    await (tools.write as any).execute({}, { abortSignal: AbortSignal.abort() })
    expect(execute).not.toHaveBeenCalled()
  })

  it("sanitizes non-UUID runId and messageId to null", async () => {
    lastInsertedValues.length = 0
    const dummySpec: ToolSpec = {
      name: "safe_tool",
      description: "A test tool",
      schema: z.object({}),
      dangerous: false,
      execute: async () => ({ ok: true }),
    }

    const runtime: ToolRuntime = {
      orgId: "org-1",
      roomId: "room-1",
      agentId: "agent-1",
      runId: "critic-12345",
      messageId: "",
    }

    const toolSet = toAuditedTools([dummySpec], runtime)
    await (toolSet.safe_tool as any).execute({}, {})

    expect(lastInsertedValues.length).toBe(1)
    expect(lastInsertedValues[0].runId).toBeNull()
    expect(lastInsertedValues[0].messageId).toBeNull()
  })
})
