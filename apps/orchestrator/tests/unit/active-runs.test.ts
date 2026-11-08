import { describe, expect, it } from "vitest"
import { abortRoomRuns, abortRun, activeRunIds, addRunInterrupt, consumeRunInterrupts, findActiveRunForAgent, registerRun, unregisterRun } from "../../src/active-runs"

describe("active-runs registry", () => {
  it("registers, finds and unregisters runs", () => {
    const c = registerRun("r1", "room1", { agentId: "a1", engine: "v2" })
    expect(c.signal.aborted).toBe(false)
    expect(activeRunIds()).toContain("r1")
    expect(findActiveRunForAgent("room1", "a1")?.runId).toBe("r1")
    expect(findActiveRunForAgent("room1", "a2")).toBeUndefined()
    unregisterRun("r1")
    expect(activeRunIds()).not.toContain("r1")
  })

  it("abortRun aborts only the named run and reports existence", () => {
    const c = registerRun("r2", "room1")
    expect(abortRun("r2")).toBe(true)
    expect(c.signal.aborted).toBe(true)
    expect(abortRun("missing")).toBe(false)
    unregisterRun("r2")
  })

  it("abortRoomRuns aborts the whole room except an excluded run", () => {
    registerRun("ra", "roomX"); registerRun("rb", "roomX"); registerRun("rc", "roomY")
    expect(abortRoomRuns("roomX", "ra")).toBe(1)
    expect(abortRoomRuns("roomX")).toBe(2)
    expect(abortRoomRuns("roomY")).toBe(1)
    unregisterRun("ra"); unregisterRun("rb"); unregisterRun("rc")
  })

  it("queues and drains interrupts FIFO, exactly once", () => {
    registerRun("r3", "room1")
    expect(addRunInterrupt("r3", { messageId: "m1", content: "a" })).toBe(true)
    expect(addRunInterrupt("r3", { messageId: "m2", content: "b" })).toBe(true)
    expect(addRunInterrupt("nope", { messageId: "m3", content: "c" })).toBe(false)
    expect(consumeRunInterrupts("r3").map((i) => i.messageId)).toEqual(["m1", "m2"])
    expect(consumeRunInterrupts("r3")).toEqual([])
    unregisterRun("r3")
  })
})
