import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const selects: unknown[][] = []
const executes: Array<{ rows: unknown[] }> = []
const execute = vi.fn(() => Promise.resolve(executes.shift() ?? { rows: [] }))
function chain(): unknown {
  const c: Record<string, unknown> = {}
  for (const m of ["from", "where"]) c[m] = () => c
  c.limit = () => Promise.resolve(selects.shift() ?? [])
  return c
}
vi.mock("./db", () => ({ getDb: () => ({ select: () => chain(), execute }) }))
vi.mock("./realtime", () => ({ broadcast: vi.fn() }))

const { admitServerTurn } = await import("./plans")

describe("admitServerTurn", () => {
  beforeEach(() => {
    selects.length = 0
    executes.length = 0
    execute.mockClear()
  })
  afterEach(() => vi.unstubAllEnvs())

  it("self-hosted servers never count or limit anything", async () => {
    expect(await admitServerTurn("org-1")).toEqual({ allowed: true })
    expect(execute).not.toHaveBeenCalled()
  })

  it("on Sayabot Cloud, counts the reply and lets it through within the plan", async () => {
    vi.stubEnv("SAYABOT_EDITION", "cloud")
    selects.push([{ plan: "pro", status: "active" }])
    executes.push({ rows: [{ allowed: true, used: 12 }] })
    expect(await admitServerTurn("org-1")).toEqual({ allowed: true })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it("when the month is used up, answers with a friendly upgrade note", async () => {
    vi.stubEnv("SAYABOT_EDITION", "cloud")
    vi.stubEnv("SAYABOT_DOMAIN", "sayabot.sayalabs.in")
    selects.push([], [{ slug: "acme" }]) // no plan row = Free
    executes.push({ rows: [{ allowed: false, used: 300 }] })
    const result = await admitServerTurn("org-1")
    expect(result.allowed).toBe(false)
    if (result.allowed) return
    expect(result.plan).toBe("free")
    expect(result.message).toContain("300 server replies")
    expect(result.message).toContain("Agents that run on your Mac keep working")
    expect(result.message).toContain(
      "upgrade to Pro: [Plan & billing](https://sayabot.sayalabs.in/acme/settings/billing)",
    )
  })

  it("a canceled subscription is treated as Free", async () => {
    vi.stubEnv("SAYABOT_EDITION", "cloud")
    selects.push([{ plan: "team", status: "canceled" }], [{ slug: "acme" }])
    executes.push({ rows: [{ allowed: false, used: 300 }] })
    const result = await admitServerTurn("org-1")
    expect(result.allowed === false && result.plan).toBe("free")
  })
})
