import { beforeEach, describe, expect, it, vi } from "vitest"

// Each db.select(...) chain resolves to the next queued result.
const results: unknown[][] = []
function chain(): unknown {
  const c: Record<string, unknown> = {}
  for (const m of ["from", "where", "orderBy"]) c[m] = () => c
  c.limit = () => Promise.resolve(results.shift() ?? [])
  return c
}
vi.mock("../db", () => ({ getDb: () => ({ select: () => chain() }) }))

const { applyRoomModel, parseRoomModelOverride, withModelOverride } = await import("./room-model")
type Agent = Parameters<typeof withModelOverride>[0]

const HOST = "11111111-1111-1111-1111-111111111111"
const agent = {
  id: "a1",
  orgId: "org-1",
  handle: "bot",
  ownerUserId: "u1",
  providerKeyId: "key-1",
  model: "llama-3.3-70b",
  params: { effort: "low", runner: { where: "server", app: "codex" }, other: 1 },
} as unknown as Agent

const onMac = {
  keyId: `host:${HOST}:claude-code`,
  model: "claude-opus-5-5",
  effort: "high",
  providerKeyId: null,
  agentModel: null,
  runner: { hostId: HOST, app: "claude-code", model: "claude-opus-5-5" },
}

describe("withModelOverride", () => {
  it("swaps key, model, runner and effort and keeps everything else", () => {
    const next = withModelOverride(agent, onMac)
    expect(next.providerKeyId).toBeNull()
    expect(next.model).toBeNull()
    expect(next.params).toEqual({ effort: "high", runner: onMac.runner, other: 1 })
    expect(agent.params).toEqual({
      effort: "low",
      runner: { where: "server", app: "codex" },
      other: 1,
    })
  })

  it("drops the runner and effort for a key choice", () => {
    const next = withModelOverride(agent, {
      ...onMac,
      providerKeyId: "key-2",
      agentModel: "gpt-6",
      runner: null,
      effort: null,
    })
    expect(next.params).toEqual({ other: 1 })
    expect(next.providerKeyId).toBe("key-2")
  })
})

describe("parseRoomModelOverride", () => {
  it("ignores junk", () => {
    expect(parseRoomModelOverride(null)).toBeNull()
    expect(parseRoomModelOverride("x")).toBeNull()
    expect(parseRoomModelOverride({ keyId: 3, runner: [] })?.runner).toBeNull()
  })
})

describe("applyRoomModel", () => {
  beforeEach(() => {
    results.length = 0
  })

  it("keeps the default without an override", async () => {
    results.push([{ modelOverride: null }])
    expect(await applyRoomModel("r1", agent)).toBe(agent)
  })

  it("runs on the owner's Mac when the override says so", async () => {
    results.push([{ modelOverride: onMac }], [{ userId: "u1", revokedAt: null }])
    const next = await applyRoomModel("r1", agent)
    expect((next.params as Record<string, unknown>).runner).toEqual(onMac.runner)
  })

  it("ignores a computer that isn't the bot owner's", async () => {
    results.push([{ modelOverride: onMac }], [{ userId: "someone-else", revokedAt: null }])
    expect(await applyRoomModel("r1", agent)).toBe(agent)
  })

  it("ignores a key from another workspace", async () => {
    results.push(
      [{ modelOverride: { ...onMac, runner: null, providerKeyId: "key-9" } }],
      [{ orgId: "org-2" }],
    )
    expect(await applyRoomModel("r1", agent)).toBe(agent)
  })
})
