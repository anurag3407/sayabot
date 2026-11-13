import { describe, expect, it } from "vitest"
import { ACCOUNT_PROVIDERS, providerForBaseUrl, storedProvider } from "./ai-accounts"
import { effectiveProvider } from "./format"

describe("AI accounts", () => {
  it("stores providers the database knows as themselves and the rest as OpenAI-compatible", () => {
    expect(storedProvider("anthropic")).toEqual({ provider: "anthropic", baseUrl: null })
    expect(storedProvider("deepseek")).toEqual({
      provider: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
    })
    expect(storedProvider("openai-compatible", "http://localhost:11434/v1")).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
    })
    expect(storedProvider("openai-compatible")).toBeNull()
    expect(storedProvider("codex")).toBeNull()
  })

  it("maps every stored address back to its provider", () => {
    for (const spec of ACCOUNT_PROVIDERS) {
      const stored = storedProvider(
        spec.id,
        spec.kind === "custom" ? "https://example.com/v1" : null,
      )
      if (!stored || spec.kind === "custom") continue
      expect(effectiveProvider(stored.provider, stored.baseUrl)).toBe(spec.id)
    }
    expect(providerForBaseUrl("https://api.individual.githubcopilot.com")).toBe("copilot")
    expect(providerForBaseUrl("not a url")).toBeNull()
    expect(effectiveProvider("openai-compatible", "http://localhost:11434/v1")).toBe(
      "openai-compatible",
    )
  })
})
