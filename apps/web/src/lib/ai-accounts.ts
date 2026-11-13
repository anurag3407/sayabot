/**
 * The AI accounts a workspace can connect, shared by the Manage AI accounts dialog and the server
 * code that saves them. Client-safe: names, addresses and hints only, never a secret.
 *
 * The database's provider type knows six values, so providers outside it are saved as
 * `openai-compatible` rows with the provider's own address; `effectiveProvider` maps the address
 * back to the provider for model lists and the runtime.
 */

/** Values the `provider` column accepts. */
export const DB_PROVIDERS = [
  "openai",
  "anthropic",
  "google",
  "groq",
  "cerebras",
  "openai-compatible",
] as const
export type DbProvider = (typeof DB_PROVIDERS)[number]

export type AccountKind =
  /** Paste an API key. */
  | "key"
  /** Sign in with OpenRouter (or paste a key). */
  | "openrouter"
  /** GitHub device sign-in. */
  | "copilot"
  /** Any OpenAI-compatible server: an address, and a key when it needs one. */
  | "custom"
  /** A subscription used through its app signed in on the server (Codex, Claude Code, Cursor). */
  | "app"

export interface AccountProvider {
  id: string
  name: string
  kind: AccountKind
  /** Where its API lives; null for the SDK's own default. */
  baseUrl: string | null
  /** For the key field's placeholder. */
  keyHint?: string
  /** Where to get a key. */
  keyUrl?: string
  /** For `app`: the app id in the model list (`cli:<id>`) and how to sign it in. */
  app?: { id: string; command: string; plan: string }
  blurb: string
}

export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    keyHint: "sk-or-v1-…",
    keyUrl: "https://openrouter.ai/keys",
    blurb: "Hundreds of models with one account, including free ones.",
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    kind: "copilot",
    baseUrl: "https://api.githubcopilot.com",
    blurb: "Use the models in your Copilot plan.",
  },
  {
    id: "codex",
    name: "ChatGPT plan",
    kind: "app",
    baseUrl: null,
    app: { id: "codex", command: "codex login", plan: "ChatGPT Plus, Pro or Team" },
    blurb: "Your ChatGPT plan, through Codex signed in on the computer running Sayabot.",
  },
  {
    id: "claude-code",
    name: "Claude plan",
    kind: "app",
    baseUrl: null,
    app: { id: "claude-code", command: "claude", plan: "Claude Pro or Max" },
    blurb: "Your Claude plan, through Claude Code signed in on the computer running Sayabot.",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    kind: "key",
    baseUrl: null,
    keyHint: "sk-ant-…",
    keyUrl: "https://platform.claude.com/settings/keys",
    blurb: "Claude models with an API key.",
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "key",
    baseUrl: null,
    keyHint: "sk-…",
    keyUrl: "https://platform.openai.com/api-keys",
    blurb: "GPT models with an API key.",
  },
  {
    id: "google",
    name: "Google Gemini",
    kind: "key",
    baseUrl: null,
    keyHint: "AIza…",
    keyUrl: "https://aistudio.google.com/apikey",
    blurb: "Gemini models with an API key.",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    kind: "key",
    baseUrl: "https://api.deepseek.com/v1",
    keyHint: "sk-…",
    keyUrl: "https://platform.deepseek.com/api_keys",
    blurb: "DeepSeek's reasoning and chat models.",
  },
  {
    id: "grok",
    name: "xAI Grok",
    kind: "key",
    baseUrl: "https://api.x.ai/v1",
    keyHint: "xai-…",
    keyUrl: "https://console.x.ai",
    blurb: "Grok models from xAI.",
  },
  {
    id: "kimi",
    name: "Moonshot Kimi",
    kind: "key",
    baseUrl: "https://api.moonshot.cn/v1",
    keyHint: "sk-…",
    keyUrl: "https://platform.moonshot.cn/console/api-keys",
    blurb: "Kimi long-context models.",
  },
  {
    id: "qwen",
    name: "Alibaba Qwen",
    kind: "key",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    keyHint: "sk-…",
    keyUrl: "https://dashscope.console.aliyun.com/apiKey",
    blurb: "Qwen models through DashScope.",
  },
  {
    id: "minimax",
    name: "MiniMax",
    kind: "key",
    baseUrl: "https://api.minimaxi.chat/v1",
    keyUrl: "https://www.minimaxi.com/user-center/basic-information/interface-key",
    blurb: "MiniMax models with a 1M-token context.",
  },
  {
    id: "groq",
    name: "Groq",
    kind: "key",
    baseUrl: null,
    keyHint: "gsk_…",
    keyUrl: "https://console.groq.com/keys",
    blurb: "Open models on very fast hardware.",
  },
  {
    id: "cerebras",
    name: "Cerebras",
    kind: "key",
    baseUrl: null,
    keyHint: "csk-…",
    keyUrl: "https://cloud.cerebras.ai",
    blurb: "Open models on Cerebras hardware.",
  },
  {
    id: "cursor",
    name: "Cursor plan",
    kind: "app",
    baseUrl: null,
    app: { id: "cursor", command: "cursor-agent login", plan: "Cursor Pro or Business" },
    blurb: "Your Cursor plan, through the Cursor CLI signed in on the computer running Sayabot.",
  },
  {
    id: "cloudflare",
    name: "Cloudflare",
    kind: "custom",
    baseUrl: null,
    keyUrl: "https://dash.cloudflare.com/profile/api-tokens",
    blurb: "Workers AI and AI Gateway, with your account's address.",
  },
  {
    id: "openai-compatible",
    name: "Custom server",
    kind: "custom",
    baseUrl: null,
    blurb: "Ollama, LM Studio, vLLM or any OpenAI-compatible address.",
  },
]

export function accountProvider(id: string): AccountProvider | undefined {
  return ACCOUNT_PROVIDERS.find((provider) => provider.id === id)
}

/** The row the database stores for a provider: its own value, or an OpenAI-compatible address. */
export function storedProvider(
  id: string,
  customBaseUrl?: string | null,
): { provider: DbProvider; baseUrl: string | null } | null {
  const spec = accountProvider(id)
  if (!spec || spec.kind === "app") return null
  if (spec.kind === "custom") {
    return customBaseUrl ? { provider: "openai-compatible", baseUrl: customBaseUrl } : null
  }
  if ((DB_PROVIDERS as readonly string[]).includes(spec.id)) {
    return { provider: spec.id as DbProvider, baseUrl: customBaseUrl || spec.baseUrl }
  }
  return spec.baseUrl ? { provider: "openai-compatible", baseUrl: spec.baseUrl } : null
}

/** The provider an `openai-compatible` row's address belongs to, if it is a known one. */
export function providerForBaseUrl(baseUrl: string): string | null {
  let host: string
  try {
    host = new URL(baseUrl).hostname
  } catch {
    return null
  }
  if (host.endsWith("cloudflare.com")) return "cloudflare"
  if (host.endsWith("githubcopilot.com")) return "copilot"
  for (const spec of ACCOUNT_PROVIDERS) {
    if (!spec.baseUrl || (DB_PROVIDERS as readonly string[]).includes(spec.id)) continue
    try {
      if (new URL(spec.baseUrl).hostname === host) return spec.id
    } catch {
      // a malformed entry here would be a bug in this file
    }
  }
  return null
}

/** What the OpenRouter sign-in window tells the dialog. It carries no key: the server kept it. */
export interface OpenRouterAuthMessage {
  type: "OPENROUTER_AUTH_SUCCESS"
  label: string
  freeTier: boolean
}
