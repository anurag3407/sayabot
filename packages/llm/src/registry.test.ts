import { describe, expect, it } from "vitest"
import {
  MissingModelConfigError,
  createLanguageModel,
  devModelConfig,
  getProviderCapabilities,
  buildProviderOptions,
} from "./registry"

function modelIdOf(model: ReturnType<typeof createLanguageModel>): string {
  return typeof model === "string" ? model : model.modelId
}

describe("createLanguageModel", () => {
  it("creates a model for each native provider", () => {
    for (const provider of ["openai", "anthropic", "google", "groq", "cerebras"] as const) {
      const model = createLanguageModel({ provider, apiKey: "test", model: "test-model" })
      expect(modelIdOf(model)).toBe("test-model")
    }
  })

  it("requires a base URL for openai-compatible endpoints", () => {
    expect(() =>
      createLanguageModel({ provider: "openai-compatible", apiKey: "test", model: "llama3" }),
    ).toThrow(MissingModelConfigError)
  })

  it("creates an openai-compatible model", () => {
    const model = createLanguageModel({
      provider: "openai-compatible",
      apiKey: "test",
      model: "llama3.1",
      baseUrl: "http://localhost:11434/v1",
    })
    expect(modelIdOf(model)).toBe("llama3.1")
  })

  it("creates a cloudflare workers-ai model", () => {
    const model = createLanguageModel({
      provider: "cloudflare",
      apiKey: "test-cf-token",
      model: "@cf/meta/llama-3.3-70b-instruct",
    })
    expect(modelIdOf(model)).toBe("@cf/meta/llama-3.3-70b-instruct")
  })
})

describe("devModelConfig", () => {
  it("returns null unless all three dev model vars are present", () => {
    expect(devModelConfig({})).toBeNull()
    expect(
      devModelConfig({ DEV_OPENAI_COMPAT_BASE_URL: "http://x", DEV_OPENAI_COMPAT_MODEL: "m" }),
    ).toBeNull()
  })

  it("builds the dev fallback config", () => {
    expect(
      devModelConfig({
        DEV_OPENAI_COMPAT_BASE_URL: "http://localhost:11434/v1",
        DEV_OPENAI_COMPAT_API_KEY: "dev",
        DEV_OPENAI_COMPAT_MODEL: "llama3.1",
      }),
    ).toEqual({
      provider: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      apiKey: "dev",
      model: "llama3.1",
    })
  })
})

describe("getProviderCapabilities & buildProviderOptions", () => {
  it("returns correct capabilities for Anthropic", () => {
    const caps = getProviderCapabilities("anthropic")
    expect(caps.supportsPromptCache).toBe(true)
    expect(caps.supportsContextEditing).toBe(true)
    expect(caps.supportsEffort).toBe(true)
    expect(caps.supportsComputerUse).toBe(true)
    expect(caps.defaultContextWindow).toBe(200_000)
  })

  it("returns correct capabilities for OpenAI", () => {
    const caps = getProviderCapabilities("openai")
    expect(caps.supportsPromptCache).toBe(true)
    expect(caps.supportsEffort).toBe(true)
    expect(caps.defaultContextWindow).toBe(128_000)
  })

  it("builds provider options for Anthropic with cacheBreakpoint and effort", () => {
    const opts = buildProviderOptions({
      provider: "anthropic",
      cacheBreakpoint: true,
      effort: "high",
    })
    expect(opts.anthropic).toEqual({
      cacheControl: { type: "ephemeral" },
      thinking: { type: "enabled", budgetTokens: 4096 },
    })
  })

  it("builds provider options for OpenAI reasoning effort", () => {
    const opts = buildProviderOptions({
      provider: "openai",
      effort: "medium",
    })
    expect(opts.openai).toEqual({
      reasoningEffort: "medium",
    })
  })
})
