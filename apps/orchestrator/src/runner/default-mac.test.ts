import { beforeEach, describe, expect, it, vi } from "vitest"

// Each db.select(...) chain resolves to the next queued result: members first, then hosts.
const results: unknown[][] = []
function chain(): unknown {
  const next = () => results.shift() ?? []
  const c: Record<string, unknown> = {}
  for (const m of ["from", "where", "orderBy"]) c[m] = () => c
  c.limit = () => Promise.resolve(next())
  return c
}
vi.mock("../db", () => ({ getDb: () => ({ select: () => chain() }) }))
vi.mock("../realtime", () => ({ broadcast: vi.fn() }))
vi.mock("../active-runs", () => ({ registerRun: vi.fn(), unregisterRun: vi.fn() }))

const { defaultMacRunner } = await import("./local")

const agent = { orgId: "org-1", providerKeyId: null, params: {} }
const online = new Date()
const host = (settings: Record<string, unknown>, lastSeenAt: Date | null = online) => ({
  id: "11111111-1111-1111-1111-111111111111",
  settings,
  lastSeenAt,
})

describe("defaultMacRunner", () => {
  beforeEach(() => {
    results.length = 0
  })

  it("runs on the owner's Mac in a workspace only they are in", async () => {
    results.push(
      [{ userId: "u1" }],
      [host({ runnerEnabled: true, localDefault: { app: "codex" } })],
    )
    expect(await defaultMacRunner(agent)).toEqual({
      hostId: "11111111-1111-1111-1111-111111111111",
      app: "codex",
    })
  })

  it("never runs other people's messages on someone's Mac (shared workspace)", async () => {
    results.push([{ userId: "u1" }, { userId: "u2" }])
    expect(await defaultMacRunner(agent)).toBeNull()
  })

  it("lets the server answer while the Mac is offline", async () => {
    results.push(
      [{ userId: "u1" }],
      [
        host(
          { runnerEnabled: true, localDefault: { app: "codex" } },
          new Date(Date.now() - 3_600_000),
        ),
      ],
    )
    expect(await defaultMacRunner(agent)).toBeNull()
  })

  it("respects the owner turning it off", async () => {
    results.push([{ userId: "u1" }], [host({ runnerEnabled: true, localDefault: false })])
    expect(await defaultMacRunner(agent)).toBeNull()
    results.push(
      [{ userId: "u1" }],
      [host({ runnerEnabled: false, localDefault: { app: "codex" } })],
    )
    expect(await defaultMacRunner(agent)).toBeNull()
  })

  it("keeps agents that have their own key or computer", async () => {
    expect(await defaultMacRunner({ ...agent, providerKeyId: "key-1" })).toBeNull()
    expect(
      await defaultMacRunner({ ...agent, params: { runner: { where: "server", app: "codex" } } }),
    ).toBeNull()
  })
})
