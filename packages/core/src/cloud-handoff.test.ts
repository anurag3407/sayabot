import { describe, expect, it } from "vitest"
import { applyHandoff, planCloudHandoff } from "./cloud-handoff"

describe("planCloudHandoff", () => {
  it("copies to Cloud once when it is ready, and copies back when the plan ends", () => {
    expect(planCloudHandoff({ cloudReady: true, planActive: true, copied: false })).toBe(
      "copy_to_cloud",
    )
    expect(planCloudHandoff({ cloudReady: true, planActive: true, copied: true })).toBe("none")
    expect(planCloudHandoff({ cloudReady: true, planActive: false, copied: true })).toBe(
      "copy_back",
    )
    expect(planCloudHandoff({ cloudReady: false, planActive: false, copied: false })).toBe("none")
  })

  it("can copy again after the previous copy was restored", () => {
    expect(planCloudHandoff({ cloudReady: true, planActive: true, copied: false })).toBe(
      "copy_to_cloud",
    )
  })
})

describe("applyHandoff", () => {
  it("keeps the destination's row when both sides have the same bot", () => {
    const result = applyHandoff(
      {
        bots: [{ id: "a", name: "cloud" }],
        chats: [],
        routines: [{ id: "r", on: true }],
        keys: [],
      },
      {
        bots: [
          { id: "a", name: "mac" },
          { id: "b", name: "mac-only" },
        ],
        chats: [{ id: "c" }],
        routines: [{ id: "r", on: false }],
        keys: [{ id: "k" }],
      },
    )
    expect(result.bots).toEqual([
      { id: "a", name: "cloud" },
      { id: "b", name: "mac-only" },
    ])
    expect(result.chats).toEqual([{ id: "c" }])
    expect(result.routines).toEqual([{ id: "r", on: true }])
    expect(result.keys).toEqual([{ id: "k" }])
  })
})
