import { afterEach, describe, expect, it } from "vitest"
import { registerRun, unregisterRun } from "../../src/active-runs"
import { handleMidRunInterrupt } from "../../src/engine/interrupts"

const ROOM = "room-int"

afterEach(() => { unregisterRun("run-v2"); unregisterRun("run-v1"); unregisterRun("run-other") })

describe("handleMidRunInterrupt", () => {
  it("steers a mentioned v2 run instead of aborting it, aborts others", () => {
    registerRun("run-v2", ROOM, { agentId: "agent-1", engine: "v2" })
    registerRun("run-other", ROOM, { agentId: "agent-2", engine: "v2" })
    const res = handleMidRunInterrupt(ROOM, { id: "m1", content: "@agent-1 do X", senderType: "human", mentions: ["agent-1"] })
    expect(res.steered).toBe(true)
    expect(res.steeredRunIds).toEqual(["run-v2"])
    expect(res.abortedCount).toBe(1)
  })

  it("v1 runs are never steered — the room is interrupted instead", () => {
    registerRun("run-v1", ROOM, { agentId: "agent-1", engine: "v1" })
    const res = handleMidRunInterrupt(ROOM, { id: "m1", content: "hi", senderType: "human", mentions: ["agent-1"] })
    expect(res.steered).toBe(false)
    expect(res.abortedCount).toBe(1)
  })

  it("non-human senders never steer", () => {
    registerRun("run-v2", ROOM, { agentId: "agent-1", engine: "v2" })
    const res = handleMidRunInterrupt(ROOM, { id: "m1", content: "x", senderType: "agent", mentions: ["agent-1"] })
    expect(res.steered).toBe(false)
    expect(res.abortedCount).toBe(0)
  })

  it("a human message that mentions nobody aborts the room", () => {
    registerRun("run-v2", ROOM, { agentId: "agent-9", engine: "v2" })
    const res = handleMidRunInterrupt(ROOM, { id: "m1", content: "general chat", senderType: "human" })
    expect(res.steered).toBe(false)
    expect(res.abortedCount).toBe(1)
  })
})
