import { createAnthropic } from "@ai-sdk/anthropic"
import { createCerebras } from "@ai-sdk/cerebras"
import { createGoogle } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import type { Provider } from "@sayabot/core"
import { decryptSecret } from "./crypto"

export interface LanguageModelConfig {
  provider: Provider
  apiKey: string
  model: string
  baseUrl?: string | null
}

export class MissingModelConfigError extends Error {}

/**
 * Maps a BYOK provider + key to an AI SDK model. Every adapter stays thin so a
 * provider breaking change is contained to this switch.
 */
export function createLanguageModel(config: LanguageModelConfig): LanguageModel {
  const { provider, apiKey, model } = config
  const baseURL = config.baseUrl || undefined
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(model)
    case "anthropic":
      return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(model)
    case "google":
      return createGoogle({ apiKey, ...(baseURL ? { baseURL } : {}) })(model)
    case "groq":
      return createGroq({ apiKey, ...(baseURL ? { baseURL } : {}) })(model)
    case "cerebras":
      return createCerebras({ apiKey, ...(baseURL ? { baseURL } : {}) })(model)
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: baseURL || "https://openrouter.ai/api/v1",
        apiKey,
        headers: {
          "HTTP-Referer": "https://saaya.ai",
          "X-Title": "Saaya Bot",
        },
      })(model)
    case "copilot":
      return createOpenAICompatible({
        name: "copilot",
        baseURL: baseURL || "https://api.githubcopilot.com",
        apiKey,
      })(model)
    case "opencode":
      return createOpenAICompatible({
        name: "opencode",
        baseURL: baseURL || "https://api.opencode.ai/v1",
        apiKey,
      })(model)
    case "command-code":
      return createOpenAICompatible({
        name: "command-code",
        baseURL: baseURL || "https://api.cohere.com/v2",
        apiKey,
      })(model)
    case "deepseek":
      return createOpenAICompatible({
        name: "deepseek",
        baseURL: baseURL || "https://api.deepseek.com/v1",
        apiKey,
      })(model)
    case "minimax":
      return createOpenAICompatible({
        name: "minimax",
        baseURL: baseURL || "https://api.minimaxi.chat/v1",
        apiKey,
      })(model)
    case "grok":
      return createOpenAICompatible({
        name: "grok",
        baseURL: baseURL || "https://api.x.ai/v1",
        apiKey,
      })(model)
    case "kimi":
      return createOpenAICompatible({
        name: "kimi",
        baseURL: baseURL || "https://api.moonshot.cn/v1",
        apiKey,
      })(model)
    case "qwen":
      return createOpenAICompatible({
        name: "qwen",
        baseURL: baseURL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey,
      })(model)
    case "cursor":
      return createOpenAICompatible({
        name: "cursor",
        baseURL: baseURL || "https://api.cursor.com/v1",
        apiKey,
      })(model)
    case "openai-compatible":
      if (!baseURL) {
        throw new MissingModelConfigError("openai-compatible providers require a base URL")
      }
      return createOpenAICompatible({ name: "sayabot-compatible", baseURL, apiKey })(model)
    default:
      throw new MissingModelConfigError(`unsupported provider: ${String(provider)}`)
  }
}

/** Dev fallback used when an agent has no BYOK key attached. */
export function devModelConfig(env: NodeJS.ProcessEnv = process.env): LanguageModelConfig | null {
  const baseUrl = env.DEV_OPENAI_COMPAT_BASE_URL
  const apiKey = env.DEV_OPENAI_COMPAT_API_KEY
  const model = env.DEV_OPENAI_COMPAT_MODEL
  if (!baseUrl || !apiKey || !model) return null
  return { provider: "openai-compatible", apiKey, baseUrl, model }
}

export interface ProviderKeyRow {
  provider: Provider
  baseUrl: string | null
  ciphertext: string
  iv: string
  tag: string
}

/** Decrypts a provider_keys row. Only call this in trusted server processes. */
export function providerKeyToApiKey(row: ProviderKeyRow, kek: string): string {
  return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, kek)
}

export interface ProviderCapabilities {
  supportsPromptCache: boolean
  supportsServerCompaction: boolean
  supportsContextEditing: boolean
  supportsEffort: boolean
  supportsMidConversationSystem: boolean
  supportsParallelTools: boolean
  supportsComputerUse: boolean
  defaultContextWindow: number
}

export type EffortLevel = "low" | "medium" | "high" | "max"

const PROVIDER_CAPABILITIES: Record<Provider, ProviderCapabilities> = {
  anthropic: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: true,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: true,
    defaultContextWindow: 200_000,
  },
  openai: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
  },
  google: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 1_000_000,
  },
  groq: {
    supportsPromptCache: false,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: false,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 32_000,
  },
  cerebras: {
    supportsPromptCache: false,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: false,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 32_000,
  },
  openrouter: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
  },
  copilot: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
  },
  opencode: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: true,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: true,
    defaultContextWindow: 200_000,
  },
  "command-code": {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: false,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
  },
  deepseek: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
  },
  minimax: {
    supportsPromptCache: false,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: false,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 1_000_000,
  },
  grok: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 131_072,
  },
  kimi: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
  },
  qwen: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
  },
  cursor: {
    supportsPromptCache: true,
    supportsServerCompaction: false,
    supportsContextEditing: true,
    supportsEffort: true,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: true,
    defaultContextWindow: 200_000,
  },
  "openai-compatible": {
    supportsPromptCache: false,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: false,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 32_000,
  },
}

export function getProviderCapabilities(provider: Provider): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider] ?? {
    supportsPromptCache: false,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: false,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 32_000,
  }
}

export interface BuildProviderOptionsArgs {
  provider: Provider
  effort?: EffortLevel
  cacheBreakpoint?: boolean
}

/**
 * Builds provider-specific options for AI SDK calls in a provider-neutral way.
 */
export function buildProviderOptions(args: BuildProviderOptionsArgs): Record<string, Record<string, unknown>> {
  const { provider, effort, cacheBreakpoint } = args
  const options: Record<string, Record<string, unknown>> = {}

  if (provider === "anthropic") {
    const anthropicOpts: Record<string, unknown> = {}
    if (cacheBreakpoint) {
      anthropicOpts.cacheControl = { type: "ephemeral" }
    }
    if (effort) {
      const budgetMap: Record<EffortLevel, number> = {
        low: 1024,
        medium: 2048,
        high: 4096,
        max: 8192,
      }
      anthropicOpts.thinking = { type: "enabled", budgetTokens: budgetMap[effort] }
    }
    if (Object.keys(anthropicOpts).length > 0) {
      options.anthropic = anthropicOpts
    }
  } else if (provider === "openai") {
    const openaiOpts: Record<string, unknown> = {}
    if (effort) {
      openaiOpts.reasoningEffort = effort === "max" ? "high" : effort
    }
    if (Object.keys(openaiOpts).length > 0) {
      options.openai = openaiOpts
    }
  }

  return options
}
