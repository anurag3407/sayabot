import type { EffortLevel } from "./models/effort"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createCerebras } from "@ai-sdk/cerebras"
import { createGoogle } from "@ai-sdk/google"
import { createGroq } from "@ai-sdk/groq"
import { createOpenAI } from "@ai-sdk/openai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import type { LanguageModel } from "ai"
import { readSayaAiConfig, resolveSayaFastModel, resolveSayaModel, type Provider } from "@sayabot/core"
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
    case "cloudflare": {
      const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
      const gatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID
      const defaultBaseUrl = accountId && gatewayId
        ? `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/workers-ai`
        : accountId
          ? `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`
          : "https://api.cloudflare.com/client/v4/ai/v1"
      return createOpenAICompatible({
        name: "cloudflare",
        baseURL: baseURL || defaultBaseUrl,
        apiKey,
      })(model)
    }
    case "openai-compatible":
      if (!baseURL) {
        throw new MissingModelConfigError("openai-compatible providers require a base URL")
      }
      return createOpenAICompatible({ name: "sayabot-compatible", baseURL, apiKey })(model)
    default:
      throw new MissingModelConfigError(`unsupported provider: ${String(provider)}`)
  }
}

/**
 * The operator's Saya AI model for a stored agent value (`saya/<alias>`, or null for the default).
 * Read from the environment on every call, so an edit to SAYA_AI_* reaches every agent on the next
 * turn after the server restarts with the new values. See @sayabot/core saya-ai.ts.
 */
export function sayaModelConfig(
  stored: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  which: "chosen" | "fast" = "chosen",
): (LanguageModelConfig & { alias: string; label: string }) | null {
  const config = readSayaAiConfig(env)
  if (!config || !config.apiKey) return null
  const model = which === "fast" ? resolveSayaFastModel(config) : resolveSayaModel(config, stored)
  const provider: Provider = config.protocol
  return { provider, apiKey: config.apiKey, baseUrl: config.baseUrl, model: model.id, alias: model.alias, label: model.label }
}

/** The server's shared model for agents with no key of their own: Saya AI's current default. */
export function devModelConfig(env: NodeJS.ProcessEnv = process.env): LanguageModelConfig | null {
  const saya = sayaModelConfig(null, env)
  if (!saya) return null
  return { provider: saya.provider, apiKey: saya.apiKey, baseUrl: saya.baseUrl, model: saya.model }
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

export type { EffortLevel }

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
  cloudflare: {
    supportsPromptCache: false,
    supportsServerCompaction: false,
    supportsContextEditing: false,
    supportsEffort: false,
    supportsMidConversationSystem: true,
    supportsParallelTools: true,
    supportsComputerUse: false,
    defaultContextWindow: 128_000,
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
    // "none" turns thinking off; the caller clamps the budget to the model's output limit.
    if (effort && effort !== "none") {
      const budgetMap: Record<Exclude<EffortLevel, "none">, number> = {
        low: 1024,
        medium: 2048,
        high: 4096,
        xhigh: 6144,
        max: 8192,
      }
      anthropicOpts.thinking = { type: "enabled", budgetTokens: budgetMap[effort] }
    }
    if (Object.keys(anthropicOpts).length > 0) {
      options.anthropic = anthropicOpts
    }
  } else if (provider === "openai") {
    const openaiOpts: Record<string, unknown> = {}
    // The picker only offers levels the model lists (models.dev / Codex), so pass it through.
    if (effort) {
      openaiOpts.reasoningEffort = effort
    }
    if (Object.keys(openaiOpts).length > 0) {
      options.openai = openaiOpts
    }
  }

  return options
}
