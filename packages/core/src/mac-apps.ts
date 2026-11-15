/**
 * Agent apps Sayabot for Mac can run bots with, signed in on the person's own computer. One list
 * for the web (model picker, Providers page) and the orchestrator (which apps a Mac may run); the
 * Mac app keeps its own copy with how to detect and start each one (apps/desktop local-agents.ts),
 * and a test there keeps the two in step.
 *
 * `access` answers "do I need an API key?":
 * - account: the app's own sign-in is enough (run `signIn` once in a terminal);
 * - account_or_key: the app's sign-in, or an API key in `keyEnv` (or saved in the app);
 * - key: no sign-in exists; the app needs a key it keeps itself or in `keyEnv`;
 * - own_config: the app picks its provider and keys in its own setup; Sayabot uses whatever it has.
 */

export type MacAppAccess = "account" | "account_or_key" | "key" | "own_config"

export interface MacAppInfo {
  id: string
  /** Its command-line tool. */
  bin: string
  name: string
  /** Provider key for icons and the picker's group. */
  provider: string
  /** Short name in the model picker. */
  label: string
  access: MacAppAccess
  /** The terminal command that signs it in or sets it up. */
  signIn: string | null
  /** Environment variables the app accepts instead of a sign-in. */
  keyEnv: readonly string[]
  install: string
}

export const MAC_CLI_APPS: readonly MacAppInfo[] = [
  {
    id: "claude-code",
    bin: "claude",
    name: "Claude Code",
    provider: "anthropic",
    label: "Claude",
    access: "account_or_key",
    signIn: "claude",
    keyEnv: ["ANTHROPIC_API_KEY"],
    install: "npm install -g @anthropic-ai/claude-code",
  },
  {
    id: "codex",
    bin: "codex",
    name: "Codex",
    provider: "openai",
    label: "Codex",
    access: "account_or_key",
    signIn: "codex login",
    keyEnv: ["OPENAI_API_KEY"],
    install: "npm install -g @openai/codex",
  },
  {
    id: "copilot",
    bin: "copilot",
    name: "GitHub Copilot",
    provider: "copilot",
    label: "Copilot",
    access: "account_or_key",
    signIn: "copilot login",
    keyEnv: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
    install: "npm install -g @github/copilot",
  },
  {
    id: "command-code",
    bin: "command-code",
    name: "Command Code",
    provider: "command-code",
    label: "Command Code",
    access: "account_or_key",
    signIn: "command-code login",
    keyEnv: ["COMMAND_CODE_API_KEY"],
    install: "npm install -g command-code",
  },
  {
    id: "cursor",
    bin: "cursor-agent",
    name: "Cursor",
    provider: "cursor",
    label: "Cursor",
    access: "account_or_key",
    signIn: "cursor-agent login",
    keyEnv: ["CURSOR_API_KEY"],
    install: "curl https://cursor.com/install -fsS | bash",
  },
  {
    id: "gemini",
    bin: "gemini",
    name: "Gemini CLI",
    provider: "google",
    label: "Gemini",
    access: "account_or_key",
    signIn: "gemini",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    install: "npm install -g @google/gemini-cli",
  },
  {
    id: "opencode",
    bin: "opencode",
    name: "OpenCode",
    provider: "opencode",
    label: "OpenCode",
    access: "account_or_key",
    signIn: "opencode auth login",
    keyEnv: ["OPENCODE_API_KEY"],
    install: "npm install -g opencode-ai",
  },
  {
    id: "mistral-vibe",
    bin: "vibe-acp",
    name: "Mistral (Vibe)",
    provider: "mistral",
    label: "Mistral",
    access: "account_or_key",
    signIn: "vibe",
    keyEnv: ["MISTRAL_API_KEY"],
    install: "curl -LsSf https://mistral.ai/vibe/install.sh | bash",
  },
  {
    id: "grok",
    bin: "grok",
    name: "Grok",
    provider: "grok",
    label: "Grok",
    access: "account",
    signIn: "grok login",
    keyEnv: [],
    install: "curl -fsSL https://x.ai/cli/install.sh | bash",
  },
  {
    id: "kimi",
    bin: "kimi",
    name: "Kimi Code",
    provider: "kimi",
    label: "Kimi",
    access: "account",
    signIn: "kimi login",
    keyEnv: [],
    install: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
  },
  {
    id: "kiro",
    bin: "kiro-cli",
    name: "Kiro",
    provider: "kiro",
    label: "Kiro",
    access: "account_or_key",
    signIn: "kiro-cli login",
    keyEnv: ["KIRO_API_KEY"],
    install: "curl -fsSL https://cli.kiro.dev/install | bash",
  },
  {
    id: "droid",
    bin: "droid",
    name: "Droid (Factory)",
    provider: "droid",
    label: "Droid",
    access: "account_or_key",
    signIn: "droid",
    keyEnv: ["FACTORY_API_KEY"],
    install: "curl -fsSL https://app.factory.ai/cli | sh",
  },
  {
    id: "devin",
    bin: "devin",
    name: "Devin",
    provider: "devin",
    label: "Devin",
    access: "account_or_key",
    signIn: "devin auth login",
    keyEnv: ["WINDSURF_API_KEY"],
    install: "curl -fsSL https://cli.devin.ai/install.sh | bash",
  },
  {
    id: "cline",
    bin: "cline",
    name: "Cline",
    provider: "cline",
    label: "Cline",
    access: "account_or_key",
    signIn: "cline auth",
    keyEnv: ["CLINE_API_KEY"],
    install: "npm install -g cline",
  },
  {
    id: "qwen",
    bin: "qwen",
    name: "Qwen Code",
    provider: "qwen",
    label: "Qwen",
    access: "own_config",
    signIn: "qwen",
    keyEnv: [],
    install: "npm install -g @qwen-code/qwen-code",
  },
  {
    id: "hermes",
    bin: "hermes",
    name: "Hermes",
    provider: "hermes",
    label: "Hermes",
    access: "own_config",
    signIn: "hermes setup",
    keyEnv: [],
    install: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash",
  },
  {
    id: "omp",
    bin: "omp",
    name: "OMP (Oh My Pi)",
    provider: "omp",
    label: "OMP",
    access: "own_config",
    signIn: "omp",
    keyEnv: [],
    install: "npm install -g @oh-my-pi/pi-coding-agent",
  },
  {
    id: "pi",
    bin: "pi",
    name: "pi",
    provider: "pi",
    label: "pi",
    access: "key",
    signIn: "pi",
    keyEnv: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"],
    install: "npm install -g @earendil-works/pi-coding-agent",
  },
  {
    id: "deepseek",
    bin: "dsh",
    name: "DeepSeek Harness",
    provider: "deepseek",
    label: "DeepSeek",
    access: "key",
    signIn: null,
    keyEnv: ["DEEPSEEK_API_KEY"],
    install: "npm install -g @deepseek-ai/dsh",
  },
]

export const MAC_CLI_APP_IDS: readonly string[] = MAC_CLI_APPS.map((app) => app.id)

export function macAppInfo(id: string | null | undefined): MacAppInfo | undefined {
  return MAC_CLI_APPS.find((app) => app.id === id)
}

export function isMacCliApp(id: string | null | undefined): boolean {
  return Boolean(macAppInfo(id))
}

/** "Do I need an API key?" in a few words, for the Providers page and the picker. */
export const MAC_ACCESS_LABEL: Record<MacAppAccess, string> = {
  account: "Uses its own sign-in, no API key",
  account_or_key: "Its own sign-in or an API key",
  key: "Needs an API key",
  own_config: "Uses the providers set up in the app",
}

/** What to do when an app is installed but can't run yet. */
export function macAppSetupHint(app: MacAppInfo): string {
  const keys = app.keyEnv.length ? app.keyEnv.join(" or ") : null
  switch (app.access) {
    case "account":
      return `Run \`${app.signIn}\` once in a terminal and sign in.`
    case "account_or_key":
      return `Run \`${app.signIn}\` once in a terminal and sign in${keys ? `, or set ${keys}` : ""}.`
    case "key":
      return app.signIn
        ? `Add a provider key in ${app.name} (run \`${app.signIn}\`)${keys ? ` or set ${keys}` : ""}.`
        : `Set ${keys ?? "an API key"} for ${app.name}.`
    case "own_config":
      return `Run \`${app.signIn}\` once in a terminal and pick a provider.`
  }
}
