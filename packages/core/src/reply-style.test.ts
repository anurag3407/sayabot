import { describe, expect, it } from "vitest"
import { replyStyleFromParams, replyStyleInstruction } from "./reply-style"

describe("replyStyleFromParams", () => {
  it("treats anything except conversational as the default", () => {
    expect(replyStyleFromParams(undefined)).toBe("default")
    expect(replyStyleFromParams({ replyStyle: "chatty" })).toBe("default")
    expect(replyStyleFromParams({ replyStyle: "conversational" })).toBe("conversational")
  })
})

describe("replyStyleInstruction", () => {
  it("stays quiet unless the bot is conversational", () => {
    expect(replyStyleInstruction("default")).toBeNull()
    expect(replyStyleInstruction("conversational")).toContain("follow-up question")
  })
})
