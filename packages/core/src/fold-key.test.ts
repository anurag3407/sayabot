import { describe, expect, it } from "vitest"
import { computeFoldKey, normalizeQuestion } from "./fold-key"

describe("fold-key", () => {
  it("normalizes question text and strips prefixes and punctuation", () => {
    expect(normalizeQuestion("Hey, can you please approve the budget?")).toBe("approve the budget")
    expect(normalizeQuestion("Question: what database should we use???")).toBe(
      "what database should we use",
    )
    expect(normalizeQuestion("   urgent:   please review PR #123  ")).toBe("review pr 123")
  })

  it("produces identical fold keys for reworded questions with common prefixes", () => {
    const key1 = computeFoldKey("Can you please approve the AWS budget?")
    const key2 = computeFoldKey("Hey, approve the AWS budget!")
    const key3 = computeFoldKey("approve the aws budget")
    expect(key1).toBe(key2)
    expect(key2).toBe(key3)
  })

  it("respects explicit fold key when provided", () => {
    const key = computeFoldKey("Any question here", "custom-fold-key-123")
    expect(key).toBe("custom-fold-key-123")
  })
})
