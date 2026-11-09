import { describe, expect, it } from "vitest"
import { getCheapModelName, resolveEffortLevel } from "../../src/runner/llm"

describe("getCheapModelName", () => {
  it("maps known providers to their cheap model", () => {
    expect(getCheapModelName("anthropic")).toBe("claude-haiku-5-5")
    expect(getCheapModelName("openai")).toBe("gpt-4o-mini")
    expect(getCheapModelName("google")).toBe("gemini-2.0-flash")
    expect(getCheapModelName("deepseek")).toBe("deepseek-chat")
    expect(getCheapModelName("openrouter")).toBe("openai/gpt-4o-mini")
    expect(getCheapModelName("groq")).toBe("openai/gpt-oss-20b")
  })

  it("falls back to gpt-4o-mini for unknown providers and honours an explicit override", () => {
    expect(getCheapModelName("cerebras")).toBe("gpt-4o-mini")
    expect(getCheapModelName("anthropic", "custom-cheap")).toBe("custom-cheap")
  })
})

describe("resolveEffortLevel", () => {
  it("passes through explicit levels", () => {
    for (const level of ["low", "medium", "high", "max"] as const) {
      expect(resolveEffortLevel({ configuredEffort: level, hasTask: true, isSubagent: true })).toBe(level)
    }
  })

  it("auto: subagent -> low, task -> high, otherwise low", () => {
    expect(resolveEffortLevel({ hasTask: false, isSubagent: true })).toBe("low")
    expect(resolveEffortLevel({ hasTask: true, isSubagent: false })).toBe("high")
    expect(resolveEffortLevel({ hasTask: false, isSubagent: false })).toBe("low")
    expect(resolveEffortLevel({ configuredEffort: "auto", hasTask: true })).toBe("high")
  })

  it("unknown effort strings resolve to undefined (provider default)", () => {
    expect(resolveEffortLevel({ configuredEffort: "ultra", hasTask: true })).toBeUndefined()
  })
})
