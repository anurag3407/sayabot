import { describe, expect, it } from "vitest"
import { goalDirective, goalOf, goalOutcome, goalQuestionOf, isSideNote } from "./goal"

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

  it("carries the goal across an answer to a bot's question", () => {
    expect(
      goalOf({
        senderType: "human",
        content: "@bot use the blue palette",
        metadata: { command: "goal", goal: "redesign the settings page" },
      }),
    ).toBe("redesign the settings page")
  })
})

describe("goalQuestionOf", () => {
  it("reads what a blocked goal is waiting on", () => {
    expect(goalQuestionOf("Need one thing.\n\nGOAL BLOCKED: which palette should I use?")).toBe(
      "which palette should I use?",
    )
  })

  it("is null when the reply blocked without a question", () => {
    expect(goalQuestionOf("Cannot reach the API.\nGOAL BLOCKED")).toBeNull()
    expect(goalQuestionOf("all done\nGOAL COMPLETE")).toBeNull()
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

  it("tells the bot to ask with options instead of guessing", () => {
    const text = goalDirective("pick a plan", 1, 20)
    expect(text).toContain("request_human_decision")
    expect(text).toContain("2–6 short options")
    expect(text).toContain("held, not thrown away")
  })
})
