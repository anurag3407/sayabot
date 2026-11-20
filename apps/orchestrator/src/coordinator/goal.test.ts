import { describe, expect, it } from "vitest"
import { goalDirective, goalOf, goalOutcome, isSideNote } from "./goal"

describe("goalOutcome", () => {
  it("keeps going until the reply says it's done", () => {
    expect(goalOutcome("Fixed the parser. Next: run the tests.")).toBe("continue")
    expect(goalOutcome("All tests pass.\n\nGOAL COMPLETE")).toBe("complete")
  })

  it("stops when the agent needs a human", () => {
    expect(goalOutcome("I need the API key.\nGOAL BLOCKED: need STRIPE_KEY")).toBe("blocked")
  })

  it("only reads the end of the reply, so quoting the instructions doesn't end the goal", () => {
    const quoted = `I'll finish with GOAL COMPLETE once done. ${"Working. ".repeat(80)}`
    expect(goalOutcome(quoted)).toBe("continue")
  })
})

describe("goalOf / isSideNote", () => {
  it("reads the command from a human message's metadata", () => {
    expect(goalOf({ senderType: "human", content: "ship it", metadata: { command: "goal" } })).toBe(
      "ship it",
    )
    expect(
      goalOf({ senderType: "agent", content: "ship it", metadata: { command: "goal" } }),
    ).toBeNull()
    expect(goalOf({ senderType: "human", content: "ship it", metadata: {} })).toBeNull()
    expect(isSideNote({ senderType: "human", metadata: { command: "btw" } })).toBe(true)
    expect(isSideNote({ senderType: "human", metadata: null })).toBe(false)
  })
})

describe("goalDirective", () => {
  it("names the round and the finish lines", () => {
    const text = goalDirective("make the build green", 3, 20)
    expect(text).toContain("round 3 of up to 20")
    expect(text).toContain("make the build green")
    expect(text).toContain("GOAL COMPLETE")
    expect(text).toContain("GOAL BLOCKED")
  })
})
