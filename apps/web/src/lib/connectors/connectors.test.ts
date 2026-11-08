import { describe, expect, it } from "vitest"
import {
  buildOpenRouterOAuthUrl,
  isFreeOpenRouterModel,
  openRouterFailureExplanation,
  OPENROUTER_FAILURES,
  OPENROUTER_FREE_MODELS_PREFERENCE,
} from "./openrouter"
import { buildChatGptPlanAuthUrl, getOpenAICodexModels } from "./chatgpt-plan"
import { getCopilotModels } from "./copilot"
import {
  OPENCODE_MODELS,
  COMMAND_CODE_MODELS,
  DEEPSEEK_MODELS,
  MINIMAX_MODELS,
  GROK_MODELS,
  KIMI_MODELS,
  QWEN_MODELS,
  CURSOR_MODELS,
} from "./acp-providers"
import { getAllGroupedModels } from "./registry"

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

  it("lists Codex / ChatGPT models including OpenAI Crouton Alpha", () => {
    const models = getOpenAICodexModels()
    expect(models.find((m) => m.id === "openai/crouton-alpha")).toBeDefined()
    expect(models.find((m) => m.label === "OpenAI Crouton Alpha")).toBeDefined()
    expect(models.find((m) => m.label === "GPT-6-Astra")).toBeDefined()
    expect(models.find((m) => m.label === "GPT-6.1-Sol")).toBeDefined()
  })
})

describe("GitHub Copilot Subscription", () => {
  it("lists Copilot models with usage multipliers", () => {
    const models = getCopilotModels()
    const autoModel = models.find((m) => m.id === "copilot/auto")
    expect(autoModel).toBeDefined()
    expect(autoModel?.route).toBe("Auto")
    const sonnet = models.find((m) => m.id === "claude-3.5-sonnet")
    expect(sonnet?.multiplier).toBe("1x")
  })
})

describe("ACP Subscriptions & Providers", () => {
  it("defines OpenCode Zen and Go models", () => {
    expect(OPENCODE_MODELS.find((m) => m.id === "opencode/zen-1")).toBeDefined()
    expect(OPENCODE_MODELS.find((m) => m.id === "opencode/go")).toBeDefined()
  })

  it("defines Command Code models", () => {
    expect(COMMAND_CODE_MODELS.find((m) => m.id === "command-a-code")).toBeDefined()
    expect(COMMAND_CODE_MODELS.find((m) => m.id === "command-r-plus")).toBeDefined()
  })

  it("defines DeepSeek reasoning & chat models", () => {
    expect(DEEPSEEK_MODELS.find((m) => m.id === "deepseek-reasoner")).toBeDefined()
    expect(DEEPSEEK_MODELS.find((m) => m.id === "deepseek-chat")).toBeDefined()
  })

  it("defines MiniMax 1M context models", () => {
    expect(MINIMAX_MODELS.find((m) => m.id === "MiniMax-Text-01")).toBeDefined()
    expect(MINIMAX_MODELS.find((m) => m.id === "MiniMax-Text-01")?.contextWindow).toBe(1000000)
  })

  it("defines Grok 3 and Grok 3 Mini models", () => {
    expect(GROK_MODELS.find((m) => m.id === "grok-3-beta")).toBeDefined()
    expect(GROK_MODELS.find((m) => m.id === "grok-3-mini-beta")).toBeDefined()
  })

  it("defines Kimi, Qwen, and Cursor models", () => {
    expect(KIMI_MODELS.find((m) => m.id === "moonshot-v1-128k")).toBeDefined()
    expect(QWEN_MODELS.find((m) => m.id === "qwen-coder-plus")).toBeDefined()
    expect(CURSOR_MODELS.find((m) => m.id === "cursor-small")).toBeDefined()
  })
})

describe("Model Registry & Grouping", () => {
  it("aggregates and groups models across all providers", async () => {
    const { groups, totalModelsCount } = await getAllGroupedModels()
    expect(groups.length).toBeGreaterThanOrEqual(10)
    expect(groups.find((g) => g.id === "openai-codex")).toBeDefined()
    expect(groups.find((g) => g.id === "github-copilot")).toBeDefined()
    expect(groups.find((g) => g.id === "openrouter")).toBeDefined()
    expect(groups.find((g) => g.id === "opencode")).toBeDefined()
    expect(groups.find((g) => g.id === "command-code")).toBeDefined()
    expect(groups.find((g) => g.id === "deepseek")).toBeDefined()
    expect(groups.find((g) => g.id === "minimax")).toBeDefined()
    expect(groups.find((g) => g.id === "grok")).toBeDefined()
    expect(groups.find((g) => g.id === "kimi")).toBeDefined()
    expect(groups.find((g) => g.id === "qwen")).toBeDefined()
    expect(groups.find((g) => g.id === "cursor")).toBeDefined()
    expect(totalModelsCount).toBeGreaterThan(30)
  })
})
