import { agentRuns, runSteps, runTranscripts } from "@sayabot/db"
import { MockLanguageModelV4 } from "ai/test"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import type { AgentRow } from "../runner/context"
import type { ToolSpec } from "../tools/audited"
import { MAX_CONCURRENT_SUBAGENTS, MAX_TOTAL_SUBAGENTS, READ_ONLY_TOOL_NAMES, SUBAGENT_HEARTBEAT_MS, spawnSubagentSchema, spawnSubagentTool } from "./subagents"

const mocks = vi.hoisted(() => ({
  db: {} as any, generate: vi.fn(), cheap: vi.fn(), same: vi.fn(), audit: vi.fn(), broadcast: vi.fn(),
}))
vi.mock("../db", () => ({ getDb: () => mocks.db }))
vi.mock("../realtime", () => ({ broadcast: mocks.broadcast }))
vi.mock("../runner/llm", () => ({ resolveAgentCheapModel: mocks.cheap, resolveAgentModel: mocks.same }))
vi.mock("ai", async (original) => ({ ...await original<typeof import("ai")>(), generateText: mocks.generate }))
vi.mock("../tools/audited", async (original) => ({ ...await original<typeof import("../tools/audited")>(), toAuditedTools: mocks.audit }))

const agent = { id: "agent", handle: "worker", orgId: "org" } as AgentRow
let parent: Record<string, any>
let children: Map<string, any>
let transcripts: Map<string, any>
let savedSteps: any[]
let operations: string[]
let writes: Array<{ table: unknown; values: any }>
let failTable: unknown
let failHeartbeat: boolean
let failTerminal: boolean
let sequence: number

function sqlValues(query: any): string[] {
  if (typeof query?.value === "string") return [query.value]
  return (query?.queryChunks ?? []).flatMap(sqlValues)
}

function fakeDb() {
  let queue = Promise.resolve()
  const db: any = {
    select: (fields?: unknown) => ({ from: () => ({ where: () => fields ? {
      then: (resolve: (value: unknown) => unknown) => {
        operations.push("count")
        return Promise.resolve([{ total: children.size, active: [...children.values()].filter(r => ["running", "waiting"].includes(r.status)).length }]).then(resolve)
      },
    } : {
      for: async (lock: string) => { operations.push(`lock:${lock}`); return parent ? [parent] : [] },
    } }) }),
    insert: (table: unknown) => ({ values: (values: any) => {
      const insert = async () => {
        if (table === failTable) throw new Error("persist failed PRIVATE_TOKEN")
        writes.push({ table, values })
        if (table === agentRuns) {
          operations.push("insert:child")
          const row = { ...values, id: `child-${++sequence}` }
          children.set(row.id, row)
          return [row]
        }
        if (table === runTranscripts) {
          operations.push("insert:transcript")
          transcripts.set(values.runId, values)
        }
        if (table === runSteps) savedSteps.push(values)
        return []
      }
      return { then: (resolve: any, reject: any) => insert().then(resolve, reject), returning: insert }
    } }),
    update: (table: unknown) => ({ set: (values: any) => ({ where: async (query: any) => {
      if (table === agentRuns && failHeartbeat && Object.keys(values).length === 1) throw new Error("heartbeat failed")
      if (table === agentRuns && failTerminal && values.status) throw new Error("terminal failed PRIVATE_TOKEN")
      writes.push({ table, values })
      const id = sqlValues(query)[0]
      const target = table === agentRuns ? children : transcripts
      if (id && target.has(id)) target.set(id, { ...target.get(id), ...values })
    } }) }),
    transaction: vi.fn(async (fn: (tx: any) => Promise<unknown>, _options?: unknown) => {
      const prior = queue
      let release!: () => void
      queue = new Promise<void>(r => { release = r })
      await prior
      const before = { children: new Map(children), transcripts: new Map(transcripts), savedSteps: [...savedSteps] }
      operations.push("tx.begin")
      try {
        const result = await fn(db)
        operations.push("tx.commit")
        return result
      } catch (error) {
        children = before.children
        transcripts = before.transcripts
        savedSteps = before.savedSteps
        operations.push("tx.rollback")
        throw error
      } finally { release() }
    }),
  }
  return db
}

function step(text = "verified", finishReason = "stop", tool = false) {
  return {
    text, finishReason, toolCalls: tool ? [{ toolName: "fs_read", input: { path: "PRIVATE_TOKEN" } }] : [],
    toolResults: tool ? [{ output: { content: "PRIVATE_TOKEN" } }] : [],
    usage: { inputTokens: 10, outputTokens: 5 },
    response: { messages: [{ role: "assistant", content: text }] },
  }
}
function result(text = "verified", finishReason = "stop") {
  return { text, finishReason, totalUsage: { inputTokens: 10, outputTokens: 5 } }
}
function spec(name: string, dangerous: ToolSpec["dangerous"] = false): ToolSpec {
  return { name, description: name, schema: z.object({}), dangerous, execute: vi.fn(async () => "ok") }
}
function makeTool(available: ToolSpec[] = []) {
  return spawnSubagentTool({
    parentRunId: "parent", roomId: "room", orgId: "org", agent,
    getAvailableToolSpecs: () => available,
    scrub: s => s.replaceAll("PRIVATE_TOKEN", "[scrubbed]"),
  })
}
async function execute(input: Record<string, unknown> = {}, available: ToolSpec[] = [], signal?: AbortSignal) {
  return await makeTool(available).execute({ task: "inspect source", ...input }, signal) as any
}

beforeEach(() => {
  vi.resetAllMocks()
  parent = { id: "parent", roomId: "room", agentId: "agent", parentRunId: null, status: "running" }
  children = new Map()
  transcripts = new Map()
  savedSteps = []
  operations = []
  writes = []
  failTable = null
  failHeartbeat = false
  failTerminal = false
  sequence = 0
  mocks.db = fakeDb()
  mocks.broadcast.mockResolvedValue(undefined)
  mocks.cheap.mockResolvedValue({ model: {}, apiKey: "MODEL_SECRET_123456" })
  mocks.same.mockResolvedValue({ model: {}, apiKey: "MODEL_SECRET_123456" })
  mocks.audit.mockImplementation((specs: ToolSpec[]) => Object.fromEntries(specs.map(s => [s.name, {}])))
  mocks.generate.mockImplementation(async (options) => {
    await options.onStepEnd(step())
    return result()
  })
})
afterEach(() => { vi.useRealTimers() })

describe("subagent lifecycle", () => {
  it("defaults safely and reserves/transcribes in a parent-locked transaction", async () => {
    expect(spawnSubagentSchema.parse({ task: "read" })).toMatchObject({ role: "researcher", tools: "read_only", maxSteps: 10 })
    const response = await execute({}, [spec("fs_read"), spec("computer_shell")])
    expect(response).toMatchObject({ runId: "child-1", ok: true, status: "complete", stepsTaken: 1, readOnly: true, isolation: "shared_tools" })
    expect(operations.slice(0, 6)).toEqual(["tx.begin", "lock:update", "count", "insert:child", "insert:transcript", "tx.commit"])
    expect(mocks.db.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "read committed" })
    expect(children.get(response.runId)).toMatchObject({ status: "complete", steps: 1, inputTokens: 10, outputTokens: 5 })
    expect(Object.keys(mocks.generate.mock.calls[0]![0].tools)).toEqual(["fs_read"])
    expect(mocks.broadcast).toHaveBeenLastCalledWith("room", expect.objectContaining({
      type: "run.step", kind: "subagent", subagent: expect.objectContaining({ runId: response.runId, status: "complete", role: "researcher" }),
    }))
  })

  it.each(["researcher", "planner", "critic"])("forces %s read-only even when same tools are requested", async role => {
    const available = [...READ_ONLY_TOOL_NAMES].map(n => spec(n)).concat([
      spec("computer_shell"), spec("fs_write"), spec("install_skill"), spec("approve_skill"),
      spec("spawn_subagent"), spec("load_skill"), spec("tasks_create"),
    ])
    const response = await execute({ role, tools: "same" }, available)
    const opts = mocks.generate.mock.calls[0]![0]
    expect(Object.keys(opts.tools)).toEqual([...READ_ONLY_TOOL_NAMES])
    expect(opts.system).toContain(`You are a ${role}`)
    expect(opts.system).toContain("read-only tools")
    expect(response.readOnly).toBe(true)
  })

  it("workers can share tools, but never get recursive spawning or skill management", async () => {
    const names = ["computer_shell", "fs_write", "spawn_subagent", "find_tools", "update_plan", "install_skill", "approve_skill", "skills_install", "load_skill", "workspace_fork"]
    const response = await execute({ role: "worker", tools: "same", model: "same" }, names.map(n => spec(n)))
    expect(Object.keys(mocks.generate.mock.calls[0]![0].tools)).toEqual(["computer_shell", "fs_write"])
    expect(mocks.generate.mock.calls[0]![0].system).toContain("NOT an isolated environment")
    expect(response).toMatchObject({ readOnly: false, isolation: "shared_tools" })
    expect(mocks.same).toHaveBeenCalledOnce()
  })

  it("does not trust dangerous or conditional tools just because their names are read-only", async () => {
    await execute({}, [spec("fs_read", true), spec("code_diagnostics", () => false)])
    expect(Object.keys(mocks.generate.mock.calls[0]![0].tools)).toEqual([])
  })

  it("requires and validates explicit worker worktree scope, without claiming confinement", async () => {
    const workspace = { repo: "/repo", worktree: "/home/bot/.saaya/worktrees/00000000-0000-4000-8000-000000000000", baseSha: "a".repeat(40) }
    expect(spawnSubagentSchema.safeParse({ task: "review", role: "critic", workspace }).success).toBe(false)
    expect((await execute({ role: "worker", workspace })).status).toBe("error")
    const inspect = spec("workspace_inspect")
    inspect.execute = vi.fn(async () => workspace)
    const response = await execute({ role: "worker", workspace }, [inspect])
    expect(inspect.execute).toHaveBeenCalledWith(workspace, expect.any(AbortSignal))
    expect(response).toMatchObject({ status: "complete", workspace, isolation: "shared_tools" })
    expect(mocks.generate.mock.calls.at(-1)![0].system).toContain("not a sandbox boundary")
  })

  it("confines worker filesystem tool paths to assigned worktree", async () => {
    const workspace = { repo: "/repo", worktree: "/home/bot/.saaya/worktrees/00000000-0000-4000-8000-000000000000", baseSha: "a".repeat(40) }
    const inspect = spec("workspace_inspect")
    inspect.execute = vi.fn(async () => workspace)
    const fsRead = spec("fs_read")
    fsRead.execute = vi.fn(async (args: any) => ({ content: `read ${args.path}` }))

    await execute({ role: "worker", workspace }, [inspect, fsRead])
    const auditedSpecs = mocks.audit.mock.calls.at(-1)![0] as ToolSpec[]
    const wrappedFsRead = auditedSpecs.find(s => s.name === "fs_read")!
    expect(wrappedFsRead).toBeDefined()

    // Outside worktree
    await expect(wrappedFsRead.execute({ path: "/home/bot/secret.txt" })).rejects.toThrow(/Access denied: Subagent is confined to workspace worktree/)
    await expect(wrappedFsRead.execute({ path: "/repo/file.txt" })).rejects.toThrow(/Access denied: Subagent is confined to workspace worktree/)

    // Inside worktree
    await expect(wrappedFsRead.execute({ path: `${workspace.worktree}/file.txt` })).resolves.toEqual({ content: `read ${workspace.worktree}/file.txt` })
    // In /tmp
    await expect(wrappedFsRead.execute({ path: "/tmp/scratch.txt" })).resolves.toEqual({ content: "read /tmp/scratch.txt" })
  })

  it("prevents concurrent fanout oversubscription and releases reservations on termination", async () => {
    const controller = new AbortController()
    mocks.generate.mockImplementation(({ abortSignal }) => new Promise((_, reject) => {
      abortSignal.addEventListener("abort", () => reject(abortSignal.reason), { once: true })
    }))
    const tasks = Array.from({ length: MAX_CONCURRENT_SUBAGENTS + 3 }, () =>
      execute({}, [], controller.signal).then(value => ({ value }), error => ({ error })))
    await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledTimes(MAX_CONCURRENT_SUBAGENTS))
    expect(children.size).toBe(MAX_CONCURRENT_SUBAGENTS)
    controller.abort()
    const responses = await Promise.all(tasks)
    expect(responses.filter(r => "error" in r)).toHaveLength(3)
    expect([...children.values()].every(r => r.status === "halted")).toBe(true)
  })

  it("counts waiting runs as active and enforces the lifetime cap", async () => {
    for (let n = 0; n < MAX_CONCURRENT_SUBAGENTS; n++) children.set(`seed-${n}`, { status: "waiting" })
    await expect(execute()).rejects.toThrow("concurrency limit")
    children.clear()
    for (let n = 0; n < MAX_TOTAL_SUBAGENTS; n++) children.set(`seed-${n}`, { status: "complete" })
    await expect(execute()).rejects.toThrow("Total subagent limit")
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it("rejects nested/terminated/mismatched parents and invalid inputs before allocation", async () => {
    parent.parentRunId = "grandparent"
    await expect(execute()).rejects.toThrow("Recursive")
    parent.parentRunId = null
    parent.status = "halted"
    await expect(execute()).rejects.toThrow("terminated")
    parent.status = "running"
    parent.roomId = "other"
    await expect(execute()).rejects.toThrow("not found")
    await expect(execute({ task: "x".repeat(30_001) })).rejects.toThrow()
    await expect(execute({ maxSteps: 31 })).rejects.toThrow()
    expect(children.size).toBe(0)
  })

  it("rolls back the reservation if initial transcript persistence fails", async () => {
    failTable = runTranscripts
    await expect(execute()).rejects.toThrow("persist failed")
    expect(children.size).toBe(0)
    expect(operations).toContain("tx.rollback")
    expect(mocks.cheap).not.toHaveBeenCalled()
  })

  it("finalizes setup/model resolution errors instead of leaving running children", async () => {
    mocks.cheap.mockRejectedValue(new Error("model failed PRIVATE_TOKEN"))
    const response = await execute()
    expect(response).toMatchObject({ runId: "child-1", status: "error", error: "model failed [scrubbed]" })
    expect(children.get(response.runId).status).toBe("error")
    expect(mocks.generate).not.toHaveBeenCalled()
  })

  it("persists every step and scrubbed transcript before generation finishes", async () => {
    mocks.generate.mockImplementation(async (options) => {
      await options.onStepEnd(step("PRIVATE_TOKEN MODEL_SECRET_123456", "tool-calls", true))
      expect(savedSteps).toHaveLength(1)
      expect(transcripts.get("child-1").messages).toHaveLength(3)
      expect(children.get("child-1")).toMatchObject({ status: "running", steps: 1 })
      expect(JSON.stringify(writes.map(w => w.values))).not.toContain("PRIVATE_TOKEN")
      expect(JSON.stringify(writes.map(w => w.values))).not.toContain("MODEL_SECRET_123456")
      await options.onStepEnd(step("last evidence"))
      return result("PRIVATE_TOKEN MODEL_SECRET_123456")
    })
    const response = await execute({ task: "read PRIVATE_TOKEN" })
    expect(response.stepsTaken).toBe(2)
    expect(savedSteps.map(s => s.idx)).toEqual([1, 2])
    expect(response.summary).not.toContain("PRIVATE_TOKEN")
    expect(response.summary).not.toContain("MODEL_SECRET_123456")
    expect(JSON.stringify(mocks.broadcast.mock.calls)).not.toContain("PRIVATE_TOKEN")
  })

  it("does not swallow incremental persistence errors", async () => {
    failTable = runSteps
    const response = await execute()
    expect(response).toMatchObject({ status: "error", stepsTaken: 0, error: "persist failed [scrubbed]" })
    expect(savedSteps).toHaveLength(0)
  })

  it.each([
    ["tool-calls", "partial", "tool_step_limit"], ["length", "partial", "output_token_limit"],
    ["stop", "", "no_output"], ["content-filter", "", "content-filter"],
  ])("does not claim completion for %s termination", async (reason, text, expected) => {
    mocks.generate.mockImplementation(async options => {
      await options.onStepEnd(step(text, reason, reason === "tool-calls"))
      return result(text, reason)
    })
    const response = await execute({ maxSteps: 1 })
    expect(response).toMatchObject({ status: "halted", ok: false, finishReason: expected })
    expect(children.get(response.runId)).toMatchObject({ status: "halted", finishReason: expected })
  })

  it("keeps heartbeats active while model resolution is pending and propagates cancellation", async () => {
    vi.useFakeTimers()
    mocks.cheap.mockReturnValue(new Promise(() => {}))
    const controller = new AbortController()
    const pending = execute({}, [], controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    const initial = children.get("child-1").heartbeatAt
    await vi.advanceTimersByTimeAsync(SUBAGENT_HEARTBEAT_MS * 2)
    expect(children.get("child-1").heartbeatAt.getTime()).toBeGreaterThan(initial.getTime())
    controller.abort(new Error("stopped PRIVATE_TOKEN"))
    expect(await pending).toMatchObject({ status: "halted", finishReason: "abort", error: "stopped [scrubbed]" })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("heartbeats throughout generation, then stops heartbeating on completion", async () => {
    vi.useFakeTimers()
    let finish!: () => void
    const wait = new Promise<void>(resolve => { finish = resolve })
    mocks.generate.mockImplementation(async options => {
      await options.onStepEnd(step("partial", "tool-calls", true))
      await wait
      await options.onStepEnd(step("done"))
      return result("done")
    })
    const pending = execute()
    await vi.advanceTimersByTimeAsync(0)
    expect(children.get("child-1").steps).toBe(1)
    const initial = children.get("child-1").heartbeatAt.getTime()
    await vi.advanceTimersByTimeAsync(SUBAGENT_HEARTBEAT_MS * 2)
    expect(children.get("child-1").heartbeatAt.getTime()).toBeGreaterThan(initial)
    finish()
    expect(await pending).toMatchObject({ status: "complete", stepsTaken: 2 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("halts on the final tool step even if a provider labels it stop", async () => {
    mocks.generate.mockImplementation(async options => {
      await options.onStepEnd(step("not yet verified", "stop", true))
      return result("not yet verified", "stop")
    })
    expect(await execute({ maxSteps: 1 })).toMatchObject({ status: "halted", finishReason: "tool_step_limit" })
  })

  it("propagates cancellation to executing tools/generation and retains completed steps", async () => {
    const controller = new AbortController()
    mocks.generate.mockImplementation(async options => {
      await options.onStepEnd(step("partial", "tool-calls", true))
      controller.abort()
      options.abortSignal.throwIfAborted()
    })
    expect(await execute({}, [], controller.signal)).toMatchObject({ status: "halted", finishReason: "abort", stepsTaken: 1 })
    expect(mocks.generate.mock.calls[0]![0].abortSignal.aborted).toBe(true)
    expect(savedSteps).toHaveLength(1)
    const alreadyStopped = new AbortController()
    alreadyStopped.abort()
    await expect(execute({}, [], alreadyStopped.signal)).rejects.toThrow()
    expect(children.size).toBe(1)
  })

  it("fails closed on heartbeat failure and clears the timer", async () => {
    vi.useFakeTimers()
    mocks.cheap.mockReturnValue(new Promise(() => {}))
    failHeartbeat = true
    const pending = execute()
    await vi.advanceTimersByTimeAsync(SUBAGENT_HEARTBEAT_MS)
    expect(await pending).toMatchObject({ status: "error", error: "heartbeat failed" })
    expect(vi.getTimerCount()).toBe(0)
  })

  it("surfaces terminal persistence failure with child ID and scrubbed error", async () => {
    failTerminal = true
    await expect(execute()).rejects.toThrow("Subagent child-1 terminal persistence failed: terminal failed [scrubbed]")
    expect(mocks.broadcast).toHaveBeenLastCalledWith("room", expect.objectContaining({
      subagent: expect.objectContaining({ status: "error", finishReason: "persistence_error" }),
    }))
  })

  it("uses the real SDK per-step hook and records model/tool messages incrementally", async () => {
    const actual = await vi.importActual<typeof import("ai")>("ai")
    let calls = 0
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        calls++
        if (calls === 2) expect(savedSteps).toHaveLength(1)
        return {
          content: calls === 1
            ? [{ type: "tool-call", toolCallId: "read-1", toolName: "fs_read", input: "{}" }]
            : [{ type: "text", text: "SDK evidence" }],
          finishReason: { unified: calls === 1 ? "tool-calls" : "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 5, text: 5, reasoning: undefined },
          }, warnings: [],
        }
      },
    })
    const read = spec("fs_read")
    read.execute = vi.fn(async (_input, signal) => {
      expect(signal).toBeInstanceOf(AbortSignal)
      return "read evidence"
    })
    mocks.audit.mockImplementation((specs: ToolSpec[]) => Object.fromEntries(specs.map(s => [s.name,
      actual.tool({ inputSchema: s.schema, execute: (input, options) => s.execute(input, options.abortSignal) }),
    ])))
    mocks.cheap.mockResolvedValue({ model })
    mocks.generate.mockImplementation(actual.generateText)
    const response = await execute({}, [read])
    expect(response).toMatchObject({ status: "complete", stepsTaken: 2, summary: "SDK evidence" })
    expect(savedSteps).toHaveLength(2)
    expect(read.execute).toHaveBeenCalledOnce()
    expect(transcripts.get(response.runId).messages.map((m: any) => m.role)).toEqual(["system", "user", "assistant", "tool", "assistant"])
  })
})
