import { beforeEach, describe, expect, it, vi } from "vitest"

const updates: unknown[] = []
const deletes: unknown[] = []
vi.mock("../db", () => ({
  getDb: () => ({
    update: () => ({ set: (v: unknown) => ({ where: async () => updates.push(v) }) }),
    delete: () => ({ where: async () => deletes.push(true) }),
  }),
}))
const broadcast = vi.fn(async () => {})
vi.mock("../realtime", () => ({ broadcast }))

const { runFittingTheModel } = await import("./fit-model")
type Args = Parameters<typeof runFittingTheModel>[0]

const args = { room: { id: "r1" }, agent: { id: "a1", params: { other: 1 } } } as unknown as Args
const ok = { messageId: "m2", runId: "r2", content: "hi", error: null, aborted: false }
const tooLarge = {
  messageId: "m1",
  runId: "r1",
  content: "",
  error: "too big",
  aborted: false,
  errorKind: "request_too_large",
  errorLimitTokens: 8000,
  modelKey: "groq/gpt-oss",
  leanLimit: null,
}

describe("runFittingTheModel", () => {
  beforeEach(() => {
    updates.length = 0
    deletes.length = 0
    broadcast.mockClear()
  })

  it("passes a good turn through", async () => {
    const run = vi.fn(async () => ok)
    expect(await runFittingTheModel(args, run)).toBe(ok)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it("learns the limit, removes the failed attempt and retries lean once", async () => {
    const run = vi.fn().mockResolvedValueOnce(tooLarge).mockResolvedValueOnce(ok)
    expect(await runFittingTheModel(args, run)).toBe(ok)
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[1]?.[0].agent.params).toEqual({
      other: 1,
      requestLimits: { "groq/gpt-oss": 8000 },
    })
    expect(updates).toHaveLength(1)
    expect(deletes).toHaveLength(1)
    expect(broadcast).toHaveBeenCalledWith("r1", { type: "message.removed", messageId: "m1" })
  })

  it("doesn't retry when the lean turn was already at that limit", async () => {
    const run = vi.fn(async () => ({ ...tooLarge, leanLimit: 8000 }))
    expect((await runFittingTheModel(args, run)).errorKind).toBe("request_too_large")
    expect(run).toHaveBeenCalledTimes(1)
  })
})
