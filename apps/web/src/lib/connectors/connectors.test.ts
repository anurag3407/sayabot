import { describe, expect, it } from "vitest"
import {
  buildOpenRouterOAuthUrl,
  isFreeOpenRouterModel,
  openRouterFailureExplanation,
  OPENROUTER_FAILURES,
  OPENROUTER_FREE_MODELS_PREFERENCE,
} from "./openrouter"
import { buildChatGptPlanAuthUrl } from "./chatgpt-plan"

describe("OpenRouter Connector", () => {
  it("detects free models correctly", () => {
    expect(isFreeOpenRouterModel("meta-llama/llama-3.3-70b-instruct:free")).toBe(true)
    expect(isFreeOpenRouterModel("nvidia/nemotron-3-super-120b-a12b:free")).toBe(true)
    expect(isFreeOpenRouterModel("custom-model", { prompt: "0", completion: "0" })).toBe(true)
    expect(isFreeOpenRouterModel("anthropic/claude-3.7-sonnet")).toBe(false)
  })

  it("builds valid PKCE OAuth URL with S256 challenge", async () => {
    const { authUrl, codeVerifier } = await buildOpenRouterOAuthUrl("http://localhost:3000/callback")
    expect(codeVerifier.length).toBeGreaterThan(32)
    expect(authUrl).toContain("https://openrouter.ai/auth")
    expect(authUrl).toContain("code_challenge_method=S256")
    expect(authUrl).toContain("callback_url=http%3A%2F%2Flocalhost%3A3000%2Fcallback")
  })

  it("provides helpful failure explanations for common errors", () => {
    expect(openRouterFailureExplanation("Error 402: Payment required", "openai/gpt-4o")).toBe(
      OPENROUTER_FAILURES.credits,
    )
    expect(
      openRouterFailureExplanation(
        "No endpoints found matching your data policy for free models",
        "google/gemma-4-31b-it:free",
      ),
    ).toBe(OPENROUTER_FAILURES.privacy)
    expect(
      openRouterFailureExplanation("Rate limit exceeded 429", "deepseek/deepseek-r1:free"),
    ).toBe(OPENROUTER_FAILURES.freeLimit)
  })

  it("has tool-capable models in priority order", () => {
    expect(OPENROUTER_FREE_MODELS_PREFERENCE[0]).toBe("nvidia/nemotron-3-super-120b-a12b:free")
    expect(OPENROUTER_FREE_MODELS_PREFERENCE).toContain("google/gemma-4-31b-it:free")
  })
})

describe("OpenAI & ChatGPT Plan Subscription", () => {
  it("builds ChatGPT direct token OAuth authorization URL", async () => {
    const { authUrl, codeVerifier, state } = await buildChatGptPlanAuthUrl(
      "http://localhost:3000/auth/callback",
    )
    expect(authUrl).toContain("https://auth.openai.com/api/accounts/authorize")
    expect(authUrl).toContain("chatgpt.tokens.use.direct")
    expect(authUrl).toContain("code_challenge_method=S256")
    expect(codeVerifier.length).toBe(64)
    expect(state.length).toBe(32)
  })
})
