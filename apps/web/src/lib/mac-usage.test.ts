import { describe, expect, it } from "vitest"
import { macUsageModel, readTokenUsage, tokensForMacJob } from "./mac-usage"

describe("Mac usage counts", () => {
  it("reads Copilot and Claude token reports", () => {
    expect(readTokenUsage({ usage: { input_tokens: 12, output_tokens: 4 } })).toEqual({
      inputTokens: 12,
      outputTokens: 4,
      cachedInputTokens: 0,
    })
    expect(readTokenUsage({ inputTokens: 0, outputTokens: 0 })).toBeNull()
  })

  it("estimates the reply when the app reports nothing", () => {
    const counted = tokensForMacJob(null, "hello world!!")
    expect(counted?.inputTokens).toBe(0)
    expect(counted?.outputTokens).toBeGreaterThan(0)
    expect(tokensForMacJob(null, "   ")).toBeNull()
  })

  it("keeps the requested model when the app does not name one", () => {
    expect(macUsageModel(undefined, "auto")).toBe("auto")
    expect(macUsageModel("gpt-5.4", "auto")).toBe("gpt-5.4")
    expect(macUsageModel("not a model", "auto")).toBe("auto")
  })
})
