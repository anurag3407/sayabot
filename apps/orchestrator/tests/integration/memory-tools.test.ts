import { beforeEach, describe, expect, it, vi } from "vitest"

const write = vi.fn(async (input: any) => ({ id: "mem-1", title: input.title, scope: input.scope }))
const recall = vi.fn(async () => [{ id: "m1", scope: "agent", title: "T", body: "B", kind: "fact" }])
const forget = vi.fn(async () => true)
vi.mock("../../src/memory/service", () => ({ getMemoryService: () => ({ write, recall, forget }) }))

import { memoryTools } from "../../src/memory/tools"

const tools = () => memoryTools({ orgId: "o1", agentId: "a1", roomId: "r1" })

describe("memoryTools (service stubbed)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("exposes remember/recall/forget with unique names", () => {
    expect(tools().map((t) => t.name)).toEqual(["remember", "recall", "forget"])
  })

  it("remember forces agentId/roomId from scope", async () => {
    const remember = tools().find((t) => t.name === "remember")!
    const out = (await remember.execute({ title: "T", body: "B", scope: "room", kind: "fact" })) as any
    expect(out).toMatchObject({ ok: true, id: "mem-1" })
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ orgId: "o1", roomId: "r1", agentId: null, createdByAgentId: "a1" }))
  })

  it("remember schema rejects empty title/body and unknown scope/kind", () => {
    const remember = tools().find((t) => t.name === "remember")!
    expect(remember.schema.safeParse({ title: "", body: "b" }).success).toBe(false)
    expect(remember.schema.safeParse({ title: "t", body: "b", scope: "global" }).success).toBe(false)
    expect(remember.schema.safeParse({ title: "t", body: "b", kind: "rumor" }).success).toBe(false)
    expect(remember.schema.safeParse({ title: "t", body: "b" }).success).toBe(true)
  })

  it("recall maps results to the model-facing shape and caps limit at 20 via schema", async () => {
    const recallTool = tools().find((t) => t.name === "recall")!
    const out = (await recallTool.execute({ query: "deploy", limit: 3 })) as any
    expect(out).toMatchObject({ query: "deploy", count: 1 })
    expect(out.memories[0]).toEqual({ id: "m1", scope: "agent", title: "T", body: "B", kind: "fact" })
    expect(recallTool.schema.safeParse({ query: "q", limit: 21 }).success).toBe(false)
  })

  it("forget requires a uuid and reports the service verdict", async () => {
    const forgetTool = tools().find((t) => t.name === "forget")!
    expect(forgetTool.schema.safeParse({ id: "nope" }).success).toBe(false)
    await expect(forgetTool.execute({ id: "11111111-1111-4111-8111-111111111111" })).resolves.toEqual({ ok: true, id: "11111111-1111-4111-8111-111111111111" })
    expect(forget).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "o1")
  })
})
