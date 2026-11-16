import { beforeEach, describe, expect, it, vi } from "vitest"

const results: unknown[][] = []
function chain(): unknown {
  const c: Record<string, unknown> = {}
  for (const m of ["from", "where", "orderBy"]) c[m] = () => c
  c.limit = () => Promise.resolve(results.shift() ?? [])
  return c
}
vi.mock("../db", () => ({ getDb: () => ({ select: () => chain() }) }))
vi.mock("../realtime", () => ({ broadcast: vi.fn() }))
vi.mock("../active-runs", () => ({ registerRun: vi.fn(), unregisterRun: vi.fn() }))
const serverCanAnswer = vi.fn(async () => true)
vi.mock("./llm", () => ({
  serverCanAnswer,
  withoutRunner: (p: Record<string, unknown>) => {
    const { runner: _runner, ...rest } = p ?? {}
    return rest
  },
}))

const { macClaimWait, macPlan, whenMacOff } = await import("./local")
type Agent = Parameters<typeof macPlan>[0]

const config = { hostId: "11111111-1111-1111-1111-111111111111", app: "claude-code" as const }
const agent = (params: Record<string, unknown> = {}) =>
  ({ ownerUserId: "u1", params: { runner: config, ...params } }) as unknown as Agent
const host = (lastSeenAt: Date | null, extra: Record<string, unknown> = {}) => [
  { userId: "u1", revokedAt: null, settings: { runnerEnabled: true }, lastSeenAt, ...extra },
]

describe("macPlan: a bot pinned to a Mac", () => {
  beforeEach(() => {
    results.length = 0
    serverCanAnswer.mockResolvedValue(true)
  })

  it("runs on the Mac while it's online", async () => {
    results.push(host(new Date()))
    expect(await macPlan(agent(), config)).toBe("local")
  })

  it("answers from the server when the Mac is off and the server can", async () => {
    results.push(host(null))
    expect(await macPlan(agent(), config)).toBe("server")
  })

  it("waits for the Mac when the server has nothing to answer with", async () => {
    serverCanAnswer.mockResolvedValue(false)
    results.push(host(null))
    expect(await macPlan(agent(), config)).toBe("wait")
  })

  it("follows the bot's own choice", async () => {
    results.push(host(null))
    expect(await macPlan(agent({ whenMacOff: "wait" }), config)).toBe("wait")
    results.push(host(null))
    expect(await macPlan(agent({ whenMacOff: "fail" }), config)).toBe("local")
  })

  it("never waits for a Mac that's switched off for bots", async () => {
    serverCanAnswer.mockResolvedValue(false)
    results.push(host(new Date(), { settings: { runnerEnabled: false } }))
    expect(await macPlan(agent(), config)).toBe("local")
  })

  it("reads the setting with a safe default", () => {
    expect(whenMacOff({ whenMacOff: "server" })).toBe("server")
    expect(whenMacOff({ whenMacOff: "nope" })).toBe("auto")
    expect(whenMacOff(null)).toBe("auto")
  })
})

describe("macClaimWait", () => {
  it("gives an online Mac the first minute, then keeps the job while heartbeats continue", () => {
    expect(macClaimWait({ elapsedMs: 30_000, waiting: false, online: true })).toBe("wait")
    expect(macClaimWait({ elapsedMs: 90_000, waiting: false, online: true })).toBe("wait")
    expect(macClaimWait({ elapsedMs: 15 * 60_000 + 1, waiting: false, online: true })).toBe(
      "unclaimed",
    )
  })

  it("stops once a Mac that looked open goes quiet", () => {
    expect(macClaimWait({ elapsedMs: 90_000, waiting: false, online: false })).toBe("unclaimed")
  })

  it("waits out the full quarter hour for a Mac that was already offline", () => {
    expect(macClaimWait({ elapsedMs: 90_000, waiting: true, online: false })).toBe("wait")
    expect(macClaimWait({ elapsedMs: 15 * 60_000 + 1, waiting: true, online: false })).toBe(
      "offline",
    )
  })
})
