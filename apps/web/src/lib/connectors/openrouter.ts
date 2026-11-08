import { generateCodeChallenge, generateCodeVerifier } from "./pkce"
import type { ModelOption } from "./types"

export const OPENROUTER_AUTH_URL = "https://openrouter.ai/auth"
export const OPENROUTER_TOKEN_URL = "https://openrouter.ai/api/v1/auth/keys"
export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1"

/** Top free models capable of tool calling in priority order */
export const OPENROUTER_FREE_MODELS_PREFERENCE: readonly string[] = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen-2.5-72b-instruct:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "deepseek/deepseek-r1:free",
  "mistralai/mistral-small-24b-instruct-2501:free",
]

export const OPENROUTER_FAILURES = {
  credits:
    "This model needs OpenRouter credit (HTTP 402). Pick a model marked (free), or add credit at openrouter.ai/credits.",
  privacy:
    "OpenRouter's privacy settings block this free model (HTTP 404). Allow free model endpoints at openrouter.ai/settings/privacy, or pick another model.",
  tools:
    "This model can't use tools, which agents need (HTTP 404). Pick another model, such as one marked (free).",
  freeLimit:
    "OpenRouter's limit for free models is used up for now (HTTP 429). Free models allow a set number of requests each day: wait for it to reset, or add credit at openrouter.ai/credits to raise it.",
} as const

export interface OpenRouterKeyDetails {
  label: string
  usage: number
  limit: number | null
  isFreeTier: boolean
  rateLimit?: {
    requests: number
    interval: string
  }
  creditsRemaining?: number
}

export interface OpenRouterRawModel {
  id: string
  name: string
  description?: string
  pricing?: {
    prompt: string
    completion: string
  }
  context_length?: number
  architecture?: {
    modality: string
    tokenizer: string
    instruct_type?: string
  }
  top_provider?: {
    max_completion_tokens?: number
    is_moderated?: boolean
  }
  supported_parameters?: string[]
}

export function isFreeOpenRouterModel(modelId: string, pricing?: { prompt?: string; completion?: string }): boolean {
  if (modelId.endsWith(":free")) return true
  if (pricing && pricing.prompt === "0" && pricing.completion === "0") return true
  return false
}

export async function buildOpenRouterOAuthUrl(callbackUrl: string): Promise<{
  authUrl: string
  codeVerifier: string
}> {
  const codeVerifier = generateCodeVerifier(64)
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  const url = new URL(OPENROUTER_AUTH_URL)
  url.searchParams.set("callback_url", callbackUrl)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")

  return {
    authUrl: url.toString(),
    codeVerifier,
  }
}

export async function exchangeOpenRouterCode(code: string, codeVerifier: string): Promise<{ apiKey: string }> {
  const response = await fetch(OPENROUTER_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      code_verifier: codeVerifier,
      code_challenge_method: "S256",
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`OpenRouter token exchange failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as { key?: string }
  if (!data.key) {
    throw new Error("OpenRouter did not return an API key.")
  }

  return { apiKey: data.key }
}

export async function getOpenRouterKeyDetails(apiKey: string): Promise<OpenRouterKeyDetails> {
  const [keyRes, creditsRes] = await Promise.all([
    fetch(`${OPENROUTER_API_BASE}/auth/key`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }),
    fetch(`${OPENROUTER_API_BASE}/credits`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    }).catch(() => null),
  ])

  if (!keyRes.ok) {
    throw new Error(`Invalid OpenRouter API key (HTTP ${keyRes.status})`)
  }

  const keyJson = (await keyRes.json()) as {
    data: {
      label?: string
      usage?: number
      limit?: number | null
      is_free_tier?: boolean
      rate_limit?: { requests: number; interval: string }
    }
  }

  let creditsRemaining: number | undefined = undefined
  if (creditsRes && creditsRes.ok) {
    const creditsJson = (await creditsRes.json()) as {
      data?: { total_credits?: number; total_usage?: number }
    }
    if (creditsJson.data && typeof creditsJson.data.total_credits === "number") {
      creditsRemaining = Math.max(0, creditsJson.data.total_credits - (creditsJson.data.total_usage ?? 0))
    }
  }

  return {
    label: keyJson.data.label || "OpenRouter Key",
    usage: keyJson.data.usage ?? 0,
    limit: keyJson.data.limit ?? null,
    isFreeTier: Boolean(keyJson.data.is_free_tier),
    rateLimit: keyJson.data.rate_limit,
    creditsRemaining,
  }
}

/** In-memory cache for models to avoid hitting OpenRouter on every render */
let cachedModels: ModelOption[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 15 * 60 * 1000 // 15 mins

export async function fetchOpenRouterModels(apiKey?: string): Promise<ModelOption[]> {
  const now = Date.now()
  if (cachedModels && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedModels
  }

  try {
    const headers: Record<string, string> = {}
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`

    const res = await fetch(`${OPENROUTER_API_BASE}/models`, {
      headers,
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const data = (await res.json()) as { data: OpenRouterRawModel[] }
    if (!Array.isArray(data.data)) throw new Error("Invalid models list")

    const models: ModelOption[] = data.data.map((m) => {
      const free = isFreeOpenRouterModel(m.id, m.pricing)
      const supportsTools = Array.isArray(m.supported_parameters) && m.supported_parameters.includes("tools")
      const supportsEffort = m.id.includes("o1") || m.id.includes("o3") || m.id.includes("claude-3-7") || m.id.includes("gemini-2.5")

      return {
        id: m.id,
        label: m.name ? (free && !m.name.includes("free") ? `${m.name} (free)` : m.name) : m.id,
        provider: "openrouter",
        providerGroup: free ? "OpenRouter · Free Tier" : "OpenRouter",
        route: free ? "Free" : undefined,
        isFree: free,
        supportsTools,
        supportsEffort,
        contextWindow: m.context_length ?? 128000,
        description: m.description,
      }
    })

    // Sort: free tool models first, then popularity
    models.sort((a, b) => {
      if (a.isFree && !b.isFree) return -1
      if (!a.isFree && b.isFree) return 1
      return a.label.localeCompare(b.label)
    })

    cachedModels = models
    cacheTimestamp = now
    return models
  } catch {
    // If network fails, return high-value fallback models
    return getFallbackOpenRouterModels()
  }
}

export function getFallbackOpenRouterModels(): ModelOption[] {
  return [
    {
      id: "nvidia/nemotron-3-super-120b-a12b:free",
      label: "NVIDIA: Nemotron-3 Super 120B (free)",
      provider: "openrouter",
      providerGroup: "OpenRouter · Free Tier",
      route: "Free",
      isFree: true,
      supportsTools: true,
      supportsEffort: false,
      contextWindow: 131072,
    },
    {
      id: "google/gemma-4-31b-it:free",
      label: "Google: Gemma 4 31B Instruct (free)",
      provider: "openrouter",
      providerGroup: "OpenRouter · Free Tier",
      route: "Free",
      isFree: true,
      supportsTools: true,
      supportsEffort: false,
      contextWindow: 128000,
    },
    {
      id: "qwen/qwen-2.5-72b-instruct:free",
      label: "Qwen 2.5 72B Instruct (free)",
      provider: "openrouter",
      providerGroup: "OpenRouter · Free Tier",
      route: "Free",
      isFree: true,
      supportsTools: true,
      supportsEffort: false,
      contextWindow: 131072,
    },
    {
      id: "meta-llama/llama-3.3-70b-instruct:free",
      label: "Meta: Llama 3.3 70B Instruct (free)",
      provider: "openrouter",
      providerGroup: "OpenRouter · Free Tier",
      route: "Free",
      isFree: true,
      supportsTools: true,
      supportsEffort: false,
      contextWindow: 131072,
    },
    {
      id: "deepseek/deepseek-r1:free",
      label: "DeepSeek: R1 Reasoning (free)",
      provider: "openrouter",
      providerGroup: "OpenRouter · Free Tier",
      route: "Free",
      isFree: true,
      supportsTools: true,
      supportsEffort: true,
      contextWindow: 65536,
    },
    {
      id: "anthropic/claude-3.7-sonnet",
      label: "Anthropic: Claude 3.7 Sonnet",
      provider: "openrouter",
      providerGroup: "OpenRouter",
      isFree: false,
      supportsTools: true,
      supportsEffort: true,
      contextWindow: 200000,
    },
    {
      id: "openai/gpt-4o",
      label: "OpenAI: GPT-4o",
      provider: "openrouter",
      providerGroup: "OpenRouter",
      isFree: false,
      supportsTools: true,
      supportsEffort: false,
      contextWindow: 128000,
    },
    {
      id: "openai/o3-mini",
      label: "OpenAI: o3-mini Reasoning",
      provider: "openrouter",
      providerGroup: "OpenRouter",
      isFree: false,
      supportsTools: true,
      supportsEffort: true,
      contextWindow: 200000,
    },
  ]
}

export function openRouterFailureExplanation(errorMessage: string, modelId: string): string | null {
  const free = modelId.endsWith(":free")
  if (/\b402\b|insufficient credits|requires more credits/i.test(errorMessage)) {
    return OPENROUTER_FAILURES.credits
  }
  if (/\bno endpoints found matching your data policy\b/i.test(errorMessage) && (free || /free model/i.test(errorMessage))) {
    return OPENROUTER_FAILURES.privacy
  }
  if (/\b429\b|rate limit|limit exceeded/i.test(errorMessage) && free) {
    return OPENROUTER_FAILURES.freeLimit
  }
  return null
}
