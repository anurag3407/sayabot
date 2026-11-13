import { describe, expect, it } from "vitest"
import { autoMaxRunning, idleComputers, Mutex, pickEvictionVictim } from "../../src/capacity"

const GB = 1024 ** 3

describe("autoMaxRunning", () => {
  it("sizes from Docker host memory", () => {
    expect(autoMaxRunning(4 * GB, 1024, 0.6)).toBe(2) // small VPS
    expect(autoMaxRunning(16 * GB, 1024, 0.6)).toBe(9) // laptop VM / team server
    expect(autoMaxRunning(16 * GB, 512, 0.5)).toBe(16)
  })

  it("never drops below one and falls back when memory is unknown", () => {
    expect(autoMaxRunning(512 * 1024 ** 2, 1024, 0.6)).toBe(1)
    expect(autoMaxRunning(0, 1024, 0.6)).toBe(4)
    expect(autoMaxRunning(Number.NaN, 1024, 0.6)).toBe(4)
  })
})

describe("eviction", () => {
  const now = 1_000_000
  const usage = [
    { agentId: "busy-old", lastUsedAt: now - 900_000, inflight: 1 },
    { agentId: "idle-old", lastUsedAt: now - 600_000, inflight: 0 },
    { agentId: "idle-new", lastUsedAt: now - 120_000, inflight: 0 },
    { agentId: "just-used", lastUsedAt: now - 5_000, inflight: 0 },
  ]

  it("picks the least recently used computer with nothing in flight", () => {
    expect(pickEvictionVictim(usage, now, 60_000)?.agentId).toBe("idle-old")
  })

  it("protects computers used within the grace window (mid-turn)", () => {
    const recent = usage.filter((u) => u.agentId === "just-used" || u.agentId === "busy-old")
    expect(pickEvictionVictim(recent, now, 60_000)).toBeNull()
  })

  it("idle sweep only selects computers past the idle threshold", () => {
    expect(idleComputers(usage, now, 300_000).map((u) => u.agentId)).toEqual(["idle-old"])
  })
})

describe("Mutex", () => {
  it("serializes critical sections", async () => {
    const m = new Mutex()
    const order: string[] = []
    const task = async (name: string, ms: number) => {
      const release = await m.lock()
      order.push(`${name}:in`)
      await new Promise((r) => setTimeout(r, ms))
      order.push(`${name}:out`)
      release()
    }
    await Promise.all([task("a", 20), task("b", 0)])
    expect(order).toEqual(["a:in", "a:out", "b:in", "b:out"])
  })
})
