import { describe, expect, it } from "vitest"
import {
  detectRepetition,
  isPoliteAgreement,
  levenshteinSimilarity,
  tokenCosine,
} from "./repetition"

describe("similarity", () => {
  it("scores identical text as 1", () => {
    expect(levenshteinSimilarity("Ship it Friday.", "ship it friday")).toBe(1)
    expect(tokenCosine("same words here", "same words here")).toBeCloseTo(1, 10)
  })

  it("scores unrelated text low", () => {
    expect(levenshteinSimilarity("alpha beta", "completely different")).toBeLessThan(0.5)
  })
})

describe("isPoliteAgreement", () => {
  it("detects short content-free agreement", () => {
    expect(isPoliteAgreement("I agree with Alice.")).toBe(true)
    expect(isPoliteAgreement("Great point, Bob!")).toBe(true)
    expect(isPoliteAgreement("Thanks")).toBe(true)
  })

  it("does not flag substantive replies", () => {
    expect(isPoliteAgreement("I agree, but the migration needs a rollback plan")).toBe(false)
  })
})

describe("detectRepetition", () => {
  it("flags near-duplicate replies", () => {
    const a =
      "We should stage the rollout behind a feature flag, start with internal users, and only then widen access to ten percent."
    const b =
      "We should stage the rollout behind a feature flag, start with internal users, and then widen access to ten percent."
    expect(detectRepetition(b, [a]).repeating).toBe(true)
  })

  it("flags a three-message agreement loop", () => {
    const result = detectRepetition("Sounds good, thank you!", [
      "I agree with Alice.",
      "Thank you, great point!",
    ])
    expect(result.repeating).toBe(true)
    expect(result.reason).toContain("agreement")
  })

  it("allows distinct replies", () => {
    expect(
      detectRepetition("The database needs a composite index on room_id and created_at.", [
        "Feature flags reduce rollout risk.",
        "We should measure token cost before launch.",
      ]).repeating,
    ).toBe(false)
  })
})
