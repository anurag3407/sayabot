import { beforeEach, describe, expect, it, vi } from "vitest"

const write = vi.fn(async (input: any) => ({ id: "mem-1", title: input.title, scope: input.scope }))
const recall = vi.fn(async () => [
  { id: "m1", scope: "agent", title: "T", body: "B", kind: "fact" },
])
const forget = vi.fn(async () => true)
const withdrawBelief = vi.fn(async () => ({ id: "mem-1", epistemicStatus: "withdrawn" }))
const createOpenLoop = vi.fn(async () => ({ id: "l1", status: "open" }))
const updateOpenLoop = vi.fn(async () => ({ id: "l1", status: "resolved" }))
const resolveOpenLoop = vi.fn(async () => ({ id: "l1", status: "resolved" }))
const getActiveLoops = vi.fn(async () => [])
const detectContradictions = vi.fn(async () => [])
const getBeliefLineage = vi.fn(async () => [])
const graphWalk = vi.fn(async () => ({ rootMemoryId: "m1", nodes: [], edges: [] }))
const supersedeBelief = vi.fn(async () => true)
const relevantOwnerFacts = vi.fn(async () => ({
  facts: [{ key: "start_date", label: "Start date", value: "Monday", scope: "workspace" }],
  total: 1,
}))

vi.mock("../../src/memory/service", () => ({
  getMemoryService: () => ({
    write,
    recall,
    forget,
    withdrawBelief,
    createOpenLoop,
    updateOpenLoop,
    resolveOpenLoop,
    getActiveLoops,
    detectContradictions,
    getBeliefLineage,
    graphWalk,
    supersedeBelief,
    relevantOwnerFacts,
  }),
}))

const access = { orgId: "o1", agentId: "a1", roomId: "r1" }

import { memoryTools } from "../../src/memory/tools"

const tools = () => memoryTools({ orgId: "o1", agentId: "a1", roomId: "r1" })

describe("memoryTools (service stubbed)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("exposes all cognitive tools with unique names", () => {
    expect(tools().map((t) => t.name)).toEqual([
      "remember",
      "recall",
      "open_loop",
      "reflect",
      "graph_walk",
      "forget",
    ])
  })

  it("remember forces agentId/roomId from scope", async () => {
    const remember = tools().find((t) => t.name === "remember")!
    const out = (await remember.execute({
      title: "T",
      body: "B",
      scope: "room",
      kind: "fact",
      epistemic_status: "belief",
    })) as any
    expect(out).toMatchObject({ ok: true, id: "mem-1" })
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "o1", roomId: "r1", agentId: null, createdByAgentId: "a1" }),
    )
  })

  it("remember schema rejects empty title/body and unknown scope/kind", () => {
    const remember = tools().find((t) => t.name === "remember")!
    expect(remember.schema.safeParse({ title: "", body: "b" }).success).toBe(false)
    expect(remember.schema.safeParse({ title: "t", body: "b", scope: "global" }).success).toBe(
      false,
    )
    expect(remember.schema.safeParse({ title: "t", body: "b", kind: "rumor" }).success).toBe(false)
    expect(remember.schema.safeParse({ title: "t", body: "b" }).success).toBe(true)
  })

  it("recall maps results to the model-facing shape and caps limit at 20 via schema", async () => {
    const recallTool = tools().find((t) => t.name === "recall")!
    const out = (await recallTool.execute({ query: "deploy", limit: 3 })) as any
    expect(out).toMatchObject({ query: "deploy", count: 1 })
    expect(out.memories[0]).toMatchObject({
      id: "m1",
      scope: "private",
      title: "T",
      body: "B",
      kind: "fact",
    })
    expect(out.owner_facts).toEqual([
      { key: "start_date", label: "Start date", value: "Monday", scope: "workspace" },
    ])
    expect(recall).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "o1", agentId: "a1", roomId: "r1", reinforce: true }),
    )
    expect(recallTool.schema.safeParse({ query: "q", limit: 21 }).success).toBe(false)
  })

  it("remember supersedes only through the access-checked service path", async () => {
    const remember = tools().find((t) => t.name === "remember")!
    const old = "22222222-2222-4222-8222-222222222222"
    const out = (await remember.execute({
      title: "T",
      body: "B",
      scope: "agent",
      kind: "fact",
      epistemic_status: "belief",
      supersedes_memory_id: old,
    })) as any
    expect(out).toMatchObject({ ok: true, superseded: true })
    expect(supersedeBelief).toHaveBeenCalledWith(old, "mem-1", access)
  })

  it("forget withdraws by default and only hard-deletes behind the approval gate", async () => {
    const forgetTool = tools().find((t) => t.name === "forget")!
    const id = "11111111-1111-4111-8111-111111111111"
    expect(forgetTool.schema.safeParse({ id: "nope" }).success).toBe(false)

    const isDangerous = forgetTool.dangerous as (args: Record<string, unknown>) => boolean
    expect(isDangerous({ id })).toBe(false)
    expect(isDangerous({ id, hard_delete: true })).toBe(true)

    await expect(forgetTool.execute({ id })).resolves.toEqual({ ok: true, id, action: "withdrawn" })
    expect(withdrawBelief).toHaveBeenCalledWith(id, access, "Retracted by agent")
    expect(forget).not.toHaveBeenCalled()

    await expect(forgetTool.execute({ id, hard_delete: true })).resolves.toEqual({
      ok: true,
      id,
      action: "deleted",
    })
    expect(forget).toHaveBeenCalledWith(id, access)
  })

  it("forget reports not-found when the service denies access", async () => {
    const forgetTool = tools().find((t) => t.name === "forget")!
    withdrawBelief.mockResolvedValueOnce(null as never)
    const out = (await forgetTool.execute({ id: "33333333-3333-4333-8333-333333333333" })) as any
    expect(out.ok).toBe(false)
  })

  it("open_loop update and resolve are scoped to the calling agent", async () => {
    const loopTool = tools().find((t) => t.name === "open_loop")!
    const id = "44444444-4444-4444-8444-444444444444"
    await loopTool.execute({ action: "update", id, status: "blocked" })
    expect(updateOpenLoop).toHaveBeenCalledWith(
      expect.objectContaining({ id, orgId: "o1", agentId: "a1" }),
    )
    await loopTool.execute({ action: "resolve", id, resolution: "done" })
    expect(resolveOpenLoop).toHaveBeenCalledWith(id, "o1", "a1", "done")
  })
})
