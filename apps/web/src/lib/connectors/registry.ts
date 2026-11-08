import { getOpenAICodexModels } from "./chatgpt-plan"
import { getCopilotModels } from "./copilot"
import { fetchOpenRouterModels, getFallbackOpenRouterModels } from "./openrouter"
import {
  COMMAND_CODE_MODELS,
  CURSOR_MODELS,
  DEEPSEEK_MODELS,
  GROK_MODELS,
  KIMI_MODELS,
  MINIMAX_MODELS,
  OPENCODE_MODELS,
  QWEN_MODELS,
} from "./acp-providers"
import type { ModelOption, SelectedModelConfig, ThinkingEffort } from "./types"

export const DEFAULT_MODEL_CONFIG: SelectedModelConfig = {
  instanceId: "default",
  modelId: "openai/crouton-alpha",
  modelLabel: "OpenAI Crouton Alpha",
  provider: "openai",
  providerGroup: "OpenAI · Codex",
  thinkingEffort: "medium",
}

export const ANTHROPIC_MODELS: ModelOption[] = [
  {
    id: "claude-3-7-sonnet-latest",
    label: "Claude 3.7 Sonnet (Hybrid)",
    provider: "anthropic",
    providerGroup: "Anthropic · Claude",
    route: "Thinking",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 200000,
  },
  {
    id: "claude-3-5-sonnet-latest",
    label: "Claude 3.5 Sonnet",
    provider: "anthropic",
    providerGroup: "Anthropic · Claude",
    route: "Fast",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 200000,
  },
  {
    id: "claude-3-5-haiku-latest",
    label: "Claude 3.5 Haiku",
    provider: "anthropic",
    providerGroup: "Anthropic · Claude",
    supportsTools: true,
    supportsEffort: false,
    contextWindow: 200000,
  },
]

export const GOOGLE_MODELS: ModelOption[] = [
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
    providerGroup: "Google · Gemini",
    route: "1M Context",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 1000000,
  },
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    provider: "google",
    providerGroup: "Google · Gemini",
    route: "Reasoning",
    supportsTools: true,
    supportsEffort: true,
    contextWindow: 2000000,
  },
]

export interface ProviderGroupData {
  id: string
  label: string
  provider: string
  account?: string
  status: "connected" | "needs_setup"
  models: ModelOption[]
  totalCount: number
}

export async function getAllGroupedModels(openRouterKey?: string): Promise<{
  groups: ProviderGroupData[]
  totalModelsCount: number
}> {
  const codexModels = getOpenAICodexModels()
  const copilotModels = getCopilotModels()
  const openRouterModels = openRouterKey
    ? await fetchOpenRouterModels(openRouterKey)
    : getFallbackOpenRouterModels()

  const groups: ProviderGroupData[] = [
    {
      id: "openai-codex",
      label: "OpenAI · Codex",
      provider: "openai",
      account: "ChatGPT Plan",
      status: "connected",
      models: codexModels,
      totalCount: codexModels.length,
    },
    {
      id: "github-copilot",
      label: "GitHub Copilot",
      provider: "copilot",
      account: "Copilot Subscription",
      status: "connected",
      models: copilotModels,
      totalCount: copilotModels.length,
    },
    {
      id: "openrouter",
      label: "OpenRouter · Free & Paid",
      provider: "openrouter",
      account: openRouterKey ? "Active Account" : "Free Tier Available",
      status: "connected",
      models: openRouterModels,
      totalCount: openRouterModels.length,
    },
    {
      id: "opencode",
      label: "OpenCode · Zen & Go",
      provider: "opencode",
      account: "Zen Subscription",
      status: "connected",
      models: OPENCODE_MODELS,
      totalCount: OPENCODE_MODELS.length,
    },
    {
      id: "deepseek",
      label: "DeepSeek · Reasoning & V3",
      provider: "deepseek",
      account: "R1 CoT & V3 MoE",
      status: "connected",
      models: DEEPSEEK_MODELS,
      totalCount: DEEPSEEK_MODELS.length,
    },
    {
      id: "command-code",
      label: "Command Code · Cohere",
      provider: "command-code",
      account: "Autonomous Code Agent",
      status: "connected",
      models: COMMAND_CODE_MODELS,
      totalCount: COMMAND_CODE_MODELS.length,
    },
    {
      id: "minimax",
      label: "MiniMax · Hailuo (1M Context)",
      provider: "minimax",
      account: "Developer Plan",
      status: "connected",
      models: MINIMAX_MODELS,
      totalCount: MINIMAX_MODELS.length,
    },
    {
      id: "grok",
      label: "xAI · Grok Super",
      provider: "grok",
      account: "Grok 3 Reasoning",
      status: "connected",
      models: GROK_MODELS,
      totalCount: GROK_MODELS.length,
    },
    {
      id: "kimi",
      label: "Moonshot AI · Kimi",
      provider: "kimi",
      account: "k1.5 Long Context",
      status: "connected",
      models: KIMI_MODELS,
      totalCount: KIMI_MODELS.length,
    },
    {
      id: "qwen",
      label: "Alibaba · Qwen Code",
      provider: "qwen",
      account: "Qwen 2.5 Coder & Max",
      status: "connected",
      models: QWEN_MODELS,
      totalCount: QWEN_MODELS.length,
    },
    {
      id: "cursor",
      label: "Cursor · Pro Subscription",
      provider: "cursor",
      account: "Pro / Business Agent",
      status: "connected",
      models: CURSOR_MODELS,
      totalCount: CURSOR_MODELS.length,
    },
    {
      id: "anthropic-claude",
      label: "Anthropic · Claude",
      provider: "anthropic",
      status: "connected",
      models: ANTHROPIC_MODELS,
      totalCount: ANTHROPIC_MODELS.length,
    },
    {
      id: "google-gemini",
      label: "Google · Gemini",
      provider: "google",
      status: "connected",
      models: GOOGLE_MODELS,
      totalCount: GOOGLE_MODELS.length,
    },
  ]

  const totalModelsCount = groups.reduce((acc, g) => acc + g.totalCount, 0)

  return { groups, totalModelsCount }
}

const STORAGE_KEY = "saaya:model-selection"

export function getStoredModelSelection(): SelectedModelConfig {
  if (typeof window === "undefined") return DEFAULT_MODEL_CONFIG
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_MODEL_CONFIG
    return JSON.parse(raw) as SelectedModelConfig
  } catch {
    return DEFAULT_MODEL_CONFIG
  }
}

export function saveStoredModelSelection(config: SelectedModelConfig): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    window.dispatchEvent(new CustomEvent("saaya:model-changed", { detail: config }))
  } catch {
    // Non-blocking
  }
}

export function getStoredThinkingEffort(): ThinkingEffort | undefined {
  return getStoredModelSelection().thinkingEffort
}

export function saveStoredThinkingEffort(effort?: ThinkingEffort): void {
  const current = getStoredModelSelection()
  saveStoredModelSelection({
    ...current,
    thinkingEffort: effort,
  })
}
