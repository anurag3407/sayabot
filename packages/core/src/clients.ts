export interface ClientCapability {
  id: string
  label: string
  oauthMcp: boolean
  customHeaders: boolean
  canLoop: boolean
  configForm: "cli" | "app" | "toml" | "json" | "generic"
}

export const CLIENT_CAPABILITIES = {
  "claude-code": {
    id: "claude-code",
    label: "Claude Code",
    oauthMcp: true,
    customHeaders: true,
    canLoop: true,
    configForm: "cli",
  },
  claude: {
    id: "claude",
    label: "Claude app",
    oauthMcp: true,
    customHeaders: false,
    canLoop: false,
    configForm: "app",
  },
  chatgpt: {
    id: "chatgpt",
    label: "ChatGPT",
    oauthMcp: true,
    customHeaders: false,
    canLoop: false,
    configForm: "app",
  },
  codex: {
    id: "codex",
    label: "Codex by OpenAI",
    oauthMcp: false,
    customHeaders: true,
    canLoop: true,
    configForm: "toml",
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    oauthMcp: false,
    customHeaders: true,
    canLoop: false,
    configForm: "json",
  },
  hermes: {
    id: "hermes",
    label: "Hermes Agent",
    oauthMcp: false,
    customHeaders: true,
    canLoop: true,
    configForm: "cli",
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity / Gemini CLI",
    oauthMcp: false,
    customHeaders: true,
    canLoop: true,
    configForm: "json",
  },
  generic: {
    id: "generic",
    label: "AI Assistant",
    oauthMcp: false,
    customHeaders: true,
    canLoop: false,
    configForm: "generic",
  },
} as const satisfies Record<string, ClientCapability>

export function normalizeClient(raw?: string): ClientCapability {
  const normalized = (raw || "").toLowerCase().trim()
  switch (normalized) {
    case "codex":
      return CLIENT_CAPABILITIES.codex
    case "hermes":
    case "hermes-agent":
    case "hermes_agent":
      return CLIENT_CAPABILITIES.hermes
    case "claude-code":
    case "claude_code":
    case "claudecode":
      return CLIENT_CAPABILITIES["claude-code"]
    case "claude":
      return CLIENT_CAPABILITIES.claude
    case "cursor":
      return CLIENT_CAPABILITIES.cursor
    case "antigravity":
    case "gemini":
    case "gemini-cli":
      return CLIENT_CAPABILITIES.antigravity
    case "chatgpt":
      return CLIENT_CAPABILITIES.chatgpt
    default:
      return CLIENT_CAPABILITIES.generic
  }
}
