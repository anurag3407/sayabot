import { describe, expect, it } from "vitest"
import { mascotProps, readAgentLook } from "./agent-look"

describe("readAgentLook", () => {
  it("ignores a missing or broken look", () => {
    expect(readAgentLook(undefined)).toEqual({ shape: null, tone: null, mood: null })
    expect(readAgentLook({ mascot: { shape: "dragon", tone: "lilac", mood: "nope" } })).toEqual({
      shape: null,
      tone: "lilac",
      mood: null,
    })
  })

  it("reads a saved shape, tone and expression", () => {
    expect(readAgentLook({ mascot: { shape: "hoot", tone: "teal", mood: "thinking" } })).toEqual({
      shape: "hoot",
      tone: "teal",
      mood: "thinking",
    })
  })
})

describe("mascotProps", () => {
  it("leaves the generated look alone until a choice is saved", () => {
    expect(mascotProps("Momo", {})).toEqual({ seed: "Momo" })
  })

  it("passes a saved colour through", () => {
    expect(mascotProps("Momo", { mascot: { shape: "peak", tone: "coral" } }).color).toBe("#ff7a70")
  })
})
