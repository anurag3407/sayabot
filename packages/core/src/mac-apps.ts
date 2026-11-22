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

/**
 * How the Mac app runs it: `tools` (Claude Code / Codex stream modes), `acp` (Agent Client
 * Protocol over stdio) or `plain` (print mode, text only). Every transport but `plain` takes
 * Sayabot's room tools; the desktop's run modes must match (a test there checks).
 */
export type MacAppTransport = "tools" | "acp" | "plain"

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
  transport: MacAppTransport
  /** What the provider's terms allow its sign-in to be used for (see MacAppUsePolicy). */
  usePolicy?: MacAppUsePolicy
  /** Shown next to the app in the picker and on the Providers page. */
  policyNote?: string
}

/**
 * A provider rule on who and what may use the app's sign-in, which Sayabot enforces before a run:
 * - `interactive`: personal, interactive use only (Antigravity, Kimi Code). Only the Mac owner's
 *   own messages; no routines, meetings, webhooks, connected chats, other people or other bots.
 * - `owner`: the account is for its owner alone (Qoder, Command Code, Devin). The owner's messages
 *   and routines; no other people's messages or connected chats from outside.
 * Apps with a policy are never picked as a Mac's default app.
 */
export interface MacAppUsePolicy {
  kind: "interactive" | "owner"
  /** The rule, in a few words, for the refusal ("Google allows its sign-in for…"). */
  rule: string
  /** What to use instead for runs the rule refuses. */
  instead: string
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
    transport: "tools",
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
    transport: "tools",
  },
  {
    id: "antigravity",
    bin: "agy",
    name: "Antigravity",
    provider: "antigravity",
    label: "Antigravity",
    // Google's personal sign-in lives here now (Gemini CLI takes keys only).
    access: "account",
    signIn: "agy",
    keyEnv: [],
    install: "Install Antigravity from antigravity.google, then run `agy install`",
    transport: "acp",
    usePolicy: {
      kind: "interactive",
      rule: "Google allows its personal sign-in for single-user, interactive use",
      instead: "Use Gemini CLI with a GEMINI_API_KEY for routines, webhooks and shared chats.",
    },
    policyNote:
      "Google allows Antigravity's own sign-in for you only, interactively. Sayabot runs it for your own messages, not routines, webhooks, other people or other bots. For those, use Gemini CLI with a GEMINI_API_KEY.",
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
    transport: "acp",
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
    transport: "acp",
    usePolicy: {
      kind: "owner",
      rule: "its licence is personal and may not be used for the benefit of third parties",
      instead:
        "Each person can run their own Command Code, or pick another model for shared chats.",
    },
    policyNote:
      "Command Code's licence is personal: Sayabot runs it for you and your own routines, not for other people's messages or connected chats.",
  },
  {
    id: "qoder",
    bin: "qodercli",
    name: "Qoder",
    provider: "qoder",
    label: "Qoder",
    access: "account_or_key",
    signIn: "qodercli",
    keyEnv: ["QODER_PERSONAL_ACCESS_TOKEN"],
    install: "npm install -g @qoder-ai/qodercli",
    transport: "acp",
    usePolicy: {
      kind: "owner",
      rule: "a Qoder account is for its owner's own use and others may not use it",
      instead: "Each person can run their own Qoder, or pick another model for shared chats.",
    },
    policyNote:
      "Qoder accounts are for your own use: Sayabot runs it for you and your own routines, not for other people's messages or connected chats.",
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
    transport: "acp",
  },
  {
    id: "gemini",
    bin: "gemini",
    name: "Gemini CLI",
    provider: "google",
    label: "Gemini",
    // Google ended personal Gemini CLI logins (moved to Antigravity): an API key or Vertex only.
    access: "key",
    signIn: "gemini",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    install: "npm install -g @google/gemini-cli",
    transport: "acp",
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
    transport: "acp",
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
    transport: "acp",
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
    transport: "acp",
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
    transport: "acp",
    usePolicy: {
      kind: "interactive",
      rule: "Kimi Code subscriptions are for personal, interactive use only",
      instead: "Use an app with a Moonshot API key (OpenCode, pi) for routines and shared chats.",
    },
    policyNote:
      "Kimi's rules: a Kimi Code subscription is for your own interactive use, with no automation or account sharing. Sayabot runs it for your own messages only, not routines, webhooks, other people or bots.",
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
    transport: "acp",
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
    transport: "acp",
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
    transport: "acp",
    usePolicy: {
      kind: "owner",
      rule: "Devin's terms limit its use to you and your authorized users",
      instead: "Each person can run their own Devin, or pick another model for shared chats.",
    },
    policyNote:
      "Devin's terms limit use to you and your authorized users: Sayabot runs it for you and your own routines, not for other people's messages or connected chats.",
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
    transport: "acp",
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
    transport: "acp",
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
    transport: "acp",
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
    transport: "acp",
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
    transport: "plain",
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
    transport: "acp",
  },
  {
    id: "zcode",
    bin: "zcode",
    name: "ZCode",
    provider: "zcode",
    label: "ZCode",
    access: "account_or_key",
    signIn: "zcode login zai",
    keyEnv: ["ZCODE_API_KEY", "ZAI_API_KEY", "GLM_API_KEY"],
    install: "curl -fsSL https://z.ai/install.sh | bash",
    transport: "acp",
  },
]

export const MAC_CLI_APP_IDS: readonly string[] = MAC_CLI_APPS.map((app) => app.id)

export function macAppInfo(id: string | null | undefined): MacAppInfo | undefined {
  return MAC_CLI_APPS.find((app) => app.id === id)
}

export function isMacCliApp(id: string | null | undefined): boolean {
  return Boolean(macAppInfo(id))
}

/** The first Mac app version that hands room tools and a separate system prompt to ACP apps. */
export const MAC_ACP_ROOM_TOOLS_SINCE = "1.0.32"

function versionAtLeast(version: string, min: string): boolean {
  const parts = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number)
  const [a, b] = [parts(version), parts(min)]
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff) return diff > 0
  }
  return true
}

/** The message that starts a Mac run, as far as the personal-use rule cares. */
export interface MacRunTrigger {
  senderType: "human" | "agent" | "system"
  senderId: string | null
  metadata?: Record<string, unknown> | null
}

/**
 * Why `app` may not answer `trigger` on a Mac owned by `ownerUserId`, or null when it may, from
 * the app's `usePolicy`. `interactive`: only a person's own message (not routines or meetings —
 * system or `automated` — connector and chat-gateway messages with no sender, other members, or
 * other bots). `owner`: anything but a message from another person (another member, or someone
 * outside writing in through a connector or chat gateway).
 */
export function macRunRefusal(
  app: string | null | undefined,
  trigger: MacRunTrigger,
  ownerUserId: string | null | undefined,
): string | null {
  const info = macAppInfo(app)
  const policy = info?.usePolicy
  if (!info || !policy) return null
  const fromOwner =
    trigger.senderType === "human" && Boolean(trigger.senderId) && trigger.senderId === ownerUserId
  if (policy.kind === "interactive") {
    if (fromOwner && trigger.metadata?.automated !== true) return null
    return `${info.name} only answers its owner's own messages: ${policy.rule}. ${policy.instead}`
  }
  if (trigger.senderType !== "human" || fromOwner) return null
  return `${info.name} only answers its owner and the owner's routines: ${policy.rule}. ${policy.instead}`
}

/**
 * Whether a Mac app at `appVersion` takes the run's system prompt apart from the prompt and hands
 * it to the ACP session (ACP `systemPrompt`, or Antigravity's `_meta` extension).
 */
export function macAppSplitsSystemPrompt(
  app: string | null | undefined,
  appVersion: string | null | undefined,
): boolean {
  return (
    macAppInfo(app)?.transport === "acp" &&
    Boolean(appVersion && versionAtLeast(appVersion, MAC_ACP_ROOM_TOOLS_SINCE))
  )
}

/**
 * Whether a run of `app` on a Mac running `appVersion` can use Sayabot's room tools: Claude Code
 * and Codex always; ACP apps once that Mac app passes them on; plain print-mode apps never.
 */
export function macAppTakesRoomTools(
  app: string | null | undefined,
  appVersion: string | null | undefined,
): boolean {
  const info = macAppInfo(app)
  if (!info || info.transport === "plain") return false
  if (info.transport === "tools") return true
  return Boolean(appVersion && versionAtLeast(appVersion, MAC_ACP_ROOM_TOOLS_SINCE))
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
