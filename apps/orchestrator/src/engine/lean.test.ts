import { describe, expect, it } from "vitest"
import { classifyEngineError, scrubProviderIds, userFacingError } from "./recovery"
import { leanLimitTokens, leanParams, leanToolNames, modelLimitKey, nextLeanLimit } from "./lean"

const GROQ =
  "Request too large for model `openai/gpt-oss-120b` in organization `org_01k38e3hw9eass8sd5fqteae7y` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 12931, please reduce your message size and try again."

describe("request too large", () => {
  it("recognizes Groq's per-minute refusal and reads its limit", () => {
    expect(classifyEngineError(new Error(GROQ))).toMatchObject({
      category: "request_too_large",
      limitTokens: 8000,
    })
  })

  it("tells people what to do, without the provider's account id", () => {
    const text = userFacingError(classifyEngineError(new Error(GROQ)), GROQ, "openai/gpt-oss-120b")
    expect(text).toContain("8,000 tokens at a time")
    expect(text).toContain("Switch this bot to a bigger model")
    expect(text).not.toContain("org_01k")
    expect(scrubProviderIds(GROQ)).toContain("[account]")
  })

  it("keeps a no-model message as is so its instructions show", () => {
    const raw = '@bot has no model yet. Pick one with "Switch model".'
    const c = classifyEngineError(new Error(raw))
    expect(c.category).toBe("no_model")
    expect(userFacingError(c, raw)).toBe(raw)
  })
})

describe("lean turns", () => {
  const key = modelLimitKey("groq", "openai/gpt-oss-120b")

  it("reads the learned limit for that model only", () => {
    expect(leanLimitTokens({ requestLimits: { [key]: 8000 } }, key)).toBe(8000)
    expect(leanLimitTokens({ requestLimits: { [key]: 8000 } }, "groq/other")).toBeNull()
    expect(leanLimitTokens({}, key)).toBeNull()
  })

  it("fits input and answer under the limit", () => {
    expect(leanParams({ maxOutputTokens: 900 }, 8000)).toEqual({
      maxOutputTokens: 900,
      contextBudgetTokens: 4800,
    })
    expect(leanParams({}, 8000)).toEqual({ contextBudgetTokens: 4800, maxOutputTokens: 2000 })
    const same = { a: 1 }
    expect(leanParams(same, null)).toBe(same)
  })

  it("offers a few tools plus whatever find_tools turned on", () => {
    const specs = ["fs_read", "remember", "canvas_read", "web_search"].map((name) => ({
      name,
    })) as never
    expect(leanToolNames(() => undefined, specs)()).toEqual(["remember", "canvas_read"])
    expect(
      leanToolNames(() => ["find_tools", "fs_read", "remember", "web_search"], specs)(),
    ).toEqual(["find_tools", "remember", "web_search"])
  })

  it("steps the limit down and stops when it can't shrink", () => {
    expect(nextLeanLimit(8000, null)).toBe(8000)
    expect(nextLeanLimit(undefined, null)).toBe(6000)
    expect(nextLeanLimit(undefined, 8000)).toBe(4800)
    expect(nextLeanLimit(8000, 8000)).toBeNull()
    expect(nextLeanLimit(undefined, 2000)).toBeNull()
  })
})
