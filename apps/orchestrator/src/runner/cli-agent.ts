import { execFile } from "node:child_process"
import { readdirSync } from "node:fs"
import { access, constants, readFile, stat } from "node:fs/promises"
import { homedir, userInfo } from "node:os"
import { delimiter, join } from "node:path"

/**
 * Agents that answer through Claude Code, Codex or Cursor installed on the computer this
 * orchestrator runs on, using the sign-in those apps already saved (Keychain / ~/.claude,
 * ~/.codex/auth.json, Cursor's keychain entry). Nothing to log in to and no API key: the same
 * approach OpenBot uses. We only check that a sign-in exists; the credentials are never read
 * into this process or sent anywhere.
 */

export type CliApp = "claude-code" | "codex" | "cursor"

export interface CliRunnerConfig {
  app: CliApp
  /** Model id passed to the app; null uses the app's own default. */
  model: string | null
}

export const CLI_APPS: readonly CliApp[] = ["claude-code", "codex", "cursor"]
/** Cursor's CLI is `cursor-agent`. Plain `cursor` is the editor and `agent` may be another app. */
const BINARY: Record<CliApp, string> = {
  "claude-code": "claude",
  codex: "codex",
  cursor: "cursor-agent",
}
export const CLI_APP_NAME: Record<CliApp, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
}
const PATH_OVERRIDE: Record<CliApp, string> = {
  "claude-code": "SAYABOT_CLAUDE_PATH",
  codex: "SAYABOT_CODEX_PATH",
  cursor: "SAYABOT_CURSOR_PATH",
}

const MODEL_ID = /^[\w./:@~-]{1,120}$/

/** `params.runner = { where: "server", app, model }` — the agent runs on this server's own CLI. */
export function cliRunnerConfig(
  params: Record<string, unknown> | null | undefined,
): CliRunnerConfig | null {
  const runner = params?.runner as Record<string, unknown> | undefined
  if (!runner || runner.where !== "server") return null
  if (!CLI_APPS.includes(runner.app as CliApp)) return null
  const model =
    typeof runner.model === "string" && MODEL_ID.test(runner.model) ? runner.model : null
  return { app: runner.app as CliApp, model }
}

/** The fast model an app uses for background jobs (moderator, memory); null keeps its default. */
export function cheapCliModel(config: CliRunnerConfig, custom?: string): CliRunnerConfig {
  if (custom && MODEL_ID.test(custom)) return { ...config, model: custom }
  if (config.app === "claude-code") return { ...config, model: "claude-haiku-5-5" }
  return config
}

/**
 * Only when the orchestrator is the person's own computer: on a shared server the CLI would be
 * signed in to someone else's account. On by default outside production; SAYABOT_LOCAL_CLI=1/0
 * forces it either way.
 */
export function cliRunnerAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.SAYABOT_LOCAL_CLI ?? env.SAYABOT_LOCAL_DETECTION
  if (flag === "0") return false
  if (flag === "1") return true
  return env.NODE_ENV !== "production"
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

/** Apps started from the Dock or a service manager get a bare PATH, so also look where CLIs install. */
function searchDirs(env: NodeJS.ProcessEnv): string[] {
  const home = homedir()
  const dirs = [
    ...(env.PATH ?? "").split(delimiter).filter(Boolean),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    join(home, ".local/bin"),
    join(home, ".claude/local"),
    join(home, ".bun/bin"),
    join(home, ".npm-global/bin"),
    join(home, ".volta/bin"),
  ]
  try {
    const base = join(home, ".nvm/versions/node")
    for (const version of readdirSync(base).sort().reverse()) dirs.push(join(base, version, "bin"))
  } catch {
    // no nvm
  }
  return [...new Set(dirs)]
}

export async function findCliBinary(
  app: CliApp,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const override = env[PATH_OVERRIDE[app]]?.trim()
  const candidates = override ? [override] : searchDirs(env).map((dir) => join(dir, BINARY[app]))
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

function keychainAccount(): string {
  try {
    return process.env.USER || userInfo().username || "claude-code-user"
  } catch {
    return "claude-code-user"
  }
}

/** Keychain lookup without -w, so the secret itself is never printed. */
function keychainHas(service: string, account?: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false)
  const args = ["find-generic-password", ...(account ? ["-a", account] : []), "-s", service]
  return new Promise((resolve) => {
    execFile("/usr/bin/security", args, { timeout: 3_000 }, (error) => resolve(!error))
  })
}

/** Whether the app has a saved sign-in, the way the app itself stores it. */
export async function cliSignedIn(
  app: CliApp,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const home = homedir()
  if (app === "codex") {
    return exists(join(env.CODEX_HOME || join(home, ".codex"), "auth.json"))
  }
  if (app === "cursor") {
    if (env.CURSOR_API_KEY) return true
    if (await keychainHas("cursor-access-token")) return true
    const config = await readFile(join(home, ".cursor/cli-config.json"), "utf8").catch(() => "")
    return config.includes('"authInfo"')
  }
  const configDir = env.CLAUDE_CONFIG_DIR || join(home, ".claude")
  if (await exists(join(configDir, ".credentials.json"))) return true
  if (await keychainHas("Claude Code-credentials", keychainAccount())) return true
  const settings = await readFile(
    join(env.CLAUDE_CONFIG_DIR || home, ".claude.json"),
    "utf8",
  ).catch(() => "")
  return settings.includes('"oauthAccount"')
}

/**
 * Variables a Claude Code session sets for the commands it runs. When Sayabot itself was started
 * from inside Claude Code, the child CLI would otherwise think it is a nested session. Also drop
 * API keys so the app uses its own saved sign-in (the person's subscription), not a key that
 * happens to be in the server's environment.
 */
const STRIP_EXACT = new Set([
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_EFFORT",
  "CLAUDE_PID",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
])
const STRIP_PREFIXES = ["CLAUDE_CODE_SESSION_", "CLAUDE_CODE_HOST_", "CLAUDE_BG_"]
/** Server secrets that must never reach a model-driven process. */
const SERVER_SECRETS =
  /^(MESH_KEK|SAYABOT_KEK|DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|ORCHESTRATOR_INTERNAL_SECRET|VAPID_PRIVATE_KEY|E2B_API_KEY|CLOUDFLARE_API_TOKEN|BRAVE_SEARCH_API_KEY|DEV_OPENAI_COMPAT_API_KEY|SAYA_AI_API_KEY|CLOUDFLARE_TUNNEL_TOKEN)$/

export function cliEnvironment(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue
    if (STRIP_EXACT.has(name) || SERVER_SECRETS.test(name)) continue
    if (STRIP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue
    if (name === "AI_AGENT" && value.startsWith("claude-code")) continue
    out[name] = value
  }
  // nvm-installed CLIs are Node scripts that need the `node` next to them.
  const binDir = binary.slice(0, binary.lastIndexOf("/")) || "/usr/bin"
  out.PATH = [binDir, ...searchDirs(env)].join(delimiter)
  out.NO_COLOR = "1"
  return { ...out, ...extra }
}

/** Sayabot's own MCP server, handed to the app for one run with a short-lived room token. */
export interface CliMcp {
  url: string
  /** Name of the env var that holds the bearer token (Codex reads it from there). */
  tokenEnv: string
  /** Claude Code reads its MCP servers from a file (written 0600, deleted after the run). */
  configPath?: string
}

/** Room tools the app must not call during its own turn: its reply is posted for it, and a long poll would stall the room. */
export const MCP_BLOCKED_TOOLS = ["post_message", "wait_for_activity", "use_secret"]

/** Claude Code's built-in tools that are useful to a room agent in print mode. */
const CLAUDE_TOOLS = "Read,Glob,Grep,WebSearch,WebFetch"

export function claudeMcpConfig(url: string, token: string): string {
  return JSON.stringify({
    mcpServers: { sayabot: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } },
  })
}

export interface CliCommand {
  args: string[]
  /** Text written to the app's stdin; null when the prompt goes on the command line. */
  stdin: string | null
}

/**
 * The app's own non-interactive mode. Default (non-bypassed) permissions: in print mode anything
 * that would need approval is refused, Codex keeps its read-only sandbox, and Cursor gets no
 * --force, so nothing outside the agent's folder changes without a person (Golden Rule 4).
 *
 * Claude Code runs lean: Sayabot's system prompt replaces the coding-agent one, only read/search
 * tools, none of the person's own MCP servers, plugins or skills. That cuts ~25k input tokens a
 * turn to ~4k while still using the person's saved sign-in (no --bare, which skips the Keychain).
 */
export function cliCommand(
  config: CliRunnerConfig,
  system: string,
  prompt: string,
  mcp?: CliMcp,
): CliCommand {
  if (config.app === "codex") {
    const mcpArgs = mcp
      ? [
          "-c",
          `mcp_servers.sayabot.url=${JSON.stringify(mcp.url)}`,
          "-c",
          `mcp_servers.sayabot.bearer_token_env_var=${JSON.stringify(mcp.tokenEnv)}`,
          "-c",
          `mcp_servers.sayabot.disabled_tools=${JSON.stringify(MCP_BLOCKED_TOOLS)}`,
          // exec mode has nobody to approve with; only Sayabot's own server is pre-approved, and
          // its high-stakes steps go through request_human_decision in the room instead.
          "-c",
          'mcp_servers.sayabot.default_tools_approval_mode="approve"',
        ]
      : []
    return {
      args: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        ...mcpArgs,
        ...(config.model ? ["--model", config.model] : []),
        "-",
      ],
      stdin: `${system}\n\n${prompt}`,
    }
  }
  if (config.app === "cursor") {
    return {
      args: [
        "-p",
        "--output-format",
        "stream-json",
        ...(config.model ? ["--model", config.model] : []),
        `${system}\n\n${prompt}`.slice(-200_000),
      ],
      stdin: null,
    }
  }
  const mcpArgs = mcp?.configPath
    ? [
        "--mcp-config",
        mcp.configPath,
        "--allowedTools",
        "mcp__sayabot",
        "--disallowedTools",
        MCP_BLOCKED_TOOLS.map((tool) => `mcp__sayabot__${tool}`).join(","),
      ]
    : []
  return {
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "default",
      "--no-session-persistence",
      "--tools",
      CLAUDE_TOOLS,
      "--strict-mcp-config",
      ...mcpArgs,
      "--setting-sources",
      "project,local",
      "--disable-slash-commands",
      "--exclude-dynamic-system-prompt-sections",
      ...(config.model ? ["--model", config.model] : []),
      "--system-prompt",
      system.slice(0, 60_000),
    ],
    stdin: prompt,
  }
}

export type CliEvent =
  | { kind: "delta"; text: string }
  /** A full assistant message; used when the app sends no partial chunks. */
  | { kind: "message"; text: string }
  | {
      kind: "done"
      text: string | null
      error: string | null
      model: string | null
      usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null
    }

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ""
  return content
    .map((part) =>
      part && typeof part === "object" && (part as { type?: unknown }).type === "text"
        ? String((part as { text?: unknown }).text ?? "")
        : "",
    )
    .join("")
}

/** One JSONL line of the app's output, or null when it carries nothing we show. */
export function parseCliLine(app: CliApp, line: string): CliEvent | null {
  let data: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(line)
    if (!parsed || typeof parsed !== "object") return null
    data = parsed as Record<string, unknown>
  } catch {
    return null
  }

  if (app === "codex") {
    const item = data.item as Record<string, unknown> | undefined
    if (
      data.type === "item.completed" &&
      item?.type === "agent_message" &&
      typeof item.text === "string"
    ) {
      return { kind: "message", text: item.text }
    }
    if (data.type === "turn.completed") {
      const usage = data.usage as Record<string, unknown> | undefined
      return {
        kind: "done",
        text: null,
        error: null,
        model: null,
        usage: usage
          ? {
              inputTokens: num(usage.input_tokens),
              outputTokens: num(usage.output_tokens),
              cachedInputTokens: num(usage.cached_input_tokens),
            }
          : null,
      }
    }
    if (data.type === "turn.failed" || data.type === "error") {
      const error = (data.error as { message?: unknown } | undefined)?.message ?? data.message
      // Codex retries on its own and reports each attempt; only the last word counts.
      if (typeof error === "string" && /^Reconnecting\.\.\./.test(error)) return null
      return {
        kind: "done",
        text: null,
        error: String(error ?? "Codex failed"),
        model: null,
        usage: null,
      }
    }
    return null
  }

  // Claude Code and Cursor share the stream-json shape.
  if (data.type === "stream_event") {
    const event = data.event as Record<string, unknown> | undefined
    const delta = event?.delta as Record<string, unknown> | undefined
    if (
      event?.type === "content_block_delta" &&
      delta?.type === "text_delta" &&
      typeof delta.text === "string"
    ) {
      return { kind: "delta", text: delta.text }
    }
    return null
  }
  if (data.type === "assistant") {
    const text = textOf((data.message as { content?: unknown } | undefined)?.content)
    return text ? { kind: "message", text } : null
  }
  if (data.type === "result") {
    const usage = data.usage as Record<string, unknown> | undefined
    const modelUsage = data.modelUsage as Record<string, unknown> | undefined
    const isError =
      data.is_error === true || (typeof data.subtype === "string" && data.subtype !== "success")
    return {
      kind: "done",
      text: typeof data.result === "string" ? data.result : null,
      error: isError ? String(data.result || data.subtype || `${CLI_APP_NAME[app]} failed`) : null,
      model: modelUsage ? (Object.keys(modelUsage)[0] ?? null) : null,
      usage: usage
        ? {
            inputTokens: num(usage.input_tokens) + num(usage.cache_creation_input_tokens),
            outputTokens: num(usage.output_tokens),
            cachedInputTokens: num(usage.cache_read_input_tokens),
          }
        : null,
    }
  }
  return null
}

/** A plain-language reason for a failed run, pointing at the fix. */
export function cliFailureHint(app: CliApp, stderr: string, code: number | null): string {
  if (/log ?in|sign ?in|auth|unauthori|401|invalid_grant|expired/i.test(stderr)) {
    const fix = app === "cursor" ? "cursor-agent login" : BINARY[app]
    return `${CLI_APP_NAME[app]} isn't signed in on this computer. Run \`${fix}\` in a terminal once and sign in.`
  }
  const tail = stderr.trim().split("\n").slice(-3).join(" ").slice(0, 500)
  return tail || `${CLI_APP_NAME[app]} exited with code ${code ?? "unknown"}`
}

/** The agent's own working folder: ~/Sayabot/agents/<handle>. */
export function cliAgentFolder(handle: string): string {
  const safe = handle.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "agent"
  return join(homedir(), "Sayabot", "agents", safe)
}
