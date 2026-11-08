export type ConnectorProvider =
  | "openrouter"
  | "openai"
  | "copilot"
  | "anthropic"
  | "google"
  | "groq"
  | "cerebras"
  | "opencode"
  | "command-code"
  | "deepseek"
  | "minimax"
  | "grok"
  | "kimi"
  | "qwen"
  | "cursor"
  | "custom"

export type SubscriptionTier =
  | "free"
  | "chatgpt_plus"
  | "chatgpt_pro"
  | "copilot_individual"
  | "copilot_business"
  | "openrouter_free"
  | "openrouter_paid"
  | "opencode_zen"
  | "opencode_go"
  | "command_code"
  | "deepseek_pro"
  | "minimax_pro"
  | "grok_super"
  | "kimi_unlimited"
  | "qwen_max"
  | "cursor_pro"
  | "byok"

export interface ConnectorAccount {
  id: string
  provider: ConnectorProvider
  label: string
  email?: string
  status: "connected" | "needs_setup" | "expired" | "rate_limited"
  subscription?: {
    tier: SubscriptionTier
    badge: string // e.g. "ChatGPT Pro Plan", "Copilot Individual", "OpenRouter (Free Tier)", "OpenRouter ($12.50)"
    isFreeTier?: boolean
    balanceUsd?: number
    multiplier?: string
  }
  modelsCount: number
  lastUsedAt?: string
  last4?: string
  baseUrl?: string | null
}

export interface ModelOption {
  id: string
  label: string
  provider: ConnectorProvider
  providerGroup: string // e.g. "OpenAI · Codex", "GitHub Copilot", "OpenRouter · Free Tier", "Anthropic · Claude"
  route?: string // e.g. "Auto", "Free", "0.33x", "MausBot's model", "Default"
  isFree?: boolean
  supportsTools?: boolean
  supportsEffort?: boolean
  contextWindow?: number
  multiplier?: string
  description?: string
  custom?: boolean
  blocked?: boolean
}

export type ThinkingEffort = "low" | "medium" | "high" | "x-high" | "max"

export interface SelectedModelConfig {
  instanceId: string // Account ID or "system"
  modelId: string
  modelLabel: string
  provider: ConnectorProvider
  providerGroup: string
  thinkingEffort?: ThinkingEffort
}

export interface DeviceCodeFlow {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}
