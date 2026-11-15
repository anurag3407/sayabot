import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { findBinary, toolPath } from "./bin-path"
import {
  appModels,
  claudeAccount,
  detectLocalModelServers,
  geminiAccount,
  type ReportedModel,
} from "./local-models"

/**
 * Agent apps signed in on this computer. The desktop reports these to Sayabot (so the web
 * can show them even when Sayabot is hosted elsewhere) and the local runner uses them.
 * We check for login files/keychain entries; credentials are never read or sent.
 *
 * The list matches MAC_CLI_APPS in @sayabot/core (a test keeps them in step). Each app says how it
 * signs in: its own login, an API key it accepts instead (`keyEnv`), or the providers set up in it.
 */

export interface LocalAgent {
  id: string
  name: string
  binary: string | null
  status: "ready" | "signed_out" | "not_installed"
  version: string | null
  /** Who it's signed in as ("you@example.com · Org"), when the app keeps that outside its tokens. */
  account?: string | null
  /** Models it can run for that account; omitted when the app doesn't list them. */
  models?: ReportedModel[]
}

/**
 * How the runner starts each app: Claude Code and Codex with Sayabot's room tools, a few in their
 * plain print mode, and the rest over the Agent Client Protocol (see acp.ts).
 */
export type RunMode = { kind: "tools" } | { kind: "plain" } | { kind: "acp"; args: readonly string[] }

export interface AgentSpec {
  id: string
  name: string
  bin: string
  run: RunMode
  /** API keys the app takes instead of a sign-in (read from this app's environment only). */
  keyEnv: readonly string[]
  signedIn: (home: string) => Promise<boolean>
}

const hasEnv = (names: readonly string[]) => names.some((name) => Boolean(process.env[name]?.trim()))
const fileHas = (file: string, pattern: RegExp) =>
  readFile(file, "utf8").then(
    (text) => pattern.test(text),
    () => false,
  )
const dirHas = (dir: string, pattern: RegExp) =>
  readdir(dir).then(
    (names) => names.some((name) => pattern.test(name)),
    () => false,
  )
const xdgData = (home: string) => process.env.XDG_DATA_HOME?.trim() || join(home, ".local/share")
const xdgConfig = (home: string) => process.env.XDG_CONFIG_HOME?.trim() || join(home, ".config")
const someTrue = async (checks: Array<() => Promise<boolean>>) => {
  for (const check of checks) if (await check()) return true
  return false
}

export const AGENT_SPECS: readonly AgentSpec[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    bin: "claude",
    run: { kind: "tools" },
    keyEnv: ["ANTHROPIC_API_KEY"],
    signedIn: (home) =>
      someTrue([
        () => exists(join(home, ".claude/.credentials.json")),
        () => fileHas(join(home, ".claude.json"), /"oauthAccount"/),
        () => keychainHas("Claude Code-credentials"),
      ]),
  },
  {
    id: "codex",
    name: "Codex",
    bin: "codex",
    run: { kind: "tools" },
    keyEnv: ["OPENAI_API_KEY"],
    signedIn: (home) => exists(join(process.env.CODEX_HOME?.trim() || join(home, ".codex"), "auth.json")),
  },
  {
    id: "copilot",
    name: "GitHub Copilot",
    bin: "copilot",
    run: { kind: "acp", args: ["--acp", "--stdio"] },
    keyEnv: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"],
    signedIn: (home) =>
      someTrue([
        () =>
          fileHas(
            join(process.env.COPILOT_HOME?.trim() || join(home, ".copilot"), "config.json"),
            /"loggedInUsers"\s*:\s*\[\s*\{|"lastLoggedInUser"\s*:\s*\{/,
          ),
        () => keychainHas("copilot-cli"),
      ]),
  },
  {
    id: "command-code",
    name: "Command Code",
    bin: "command-code",
    run: { kind: "acp", args: ["acp"] },
    keyEnv: ["COMMAND_CODE_API_KEY"],
    signedIn: (home) => fileHas(join(home, ".commandcode/auth.json"), /"apiKey"\s*:\s*"[^"]+"/),
  },
  {
    id: "cursor",
    name: "Cursor",
    bin: "cursor-agent",
    run: { kind: "acp", args: ["acp"] },
    keyEnv: ["CURSOR_API_KEY", "CURSOR_AUTH_TOKEN"],
    signedIn: (home) =>
      someTrue([
        () => keychainHas("cursor-access-token"),
        () => fileHas(join(home, ".cursor/cli-config.json"), /"authInfo"/),
      ]),
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    bin: "gemini",
    run: { kind: "acp", args: ["--acp"] },
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    // Google ended personal Gemini CLI logins (it answers "migrate to Antigravity"), so only a key
    // or a Vertex setup counts; the env keys are checked before this.
    signedIn: (home) =>
      someTrue([
        () => fileHas(join(home, ".gemini/.env"), /^(?:export )?(?:GEMINI|GOOGLE)_API_KEY\s*=\s*\S/m),
        () => fileHas(join(home, ".gemini/settings.json"), /"selectedType"\s*:\s*"(?:gemini-api-key|vertex-ai)"/),
      ]),
  },
  {
    id: "opencode",
    name: "OpenCode",
    bin: "opencode",
    run: { kind: "acp", args: ["acp"] },
    keyEnv: ["OPENCODE_API_KEY"],
    // OpenCode also runs on its own free models and on providers set up in opencode.json.
    signedIn: (home) =>
      someTrue([
        () => exists(join(xdgData(home), "opencode/auth.json")),
        () => exists(join(xdgConfig(home), "opencode/opencode.json")),
        () => exists(join(xdgData(home), "opencode/opencode.db")),
      ]),
  },
  {
    id: "mistral-vibe",
    name: "Mistral (Vibe)",
    bin: "vibe-acp",
    run: { kind: "acp", args: [] },
    keyEnv: ["MISTRAL_API_KEY"],
    signedIn: (home) => {
      const vibe = process.env.VIBE_HOME?.trim() || join(home, ".vibe")
      return someTrue([
        () => fileHas(join(vibe, "whoami_cache.json"), /customer_id|api_base/),
        () => fileHas(join(vibe, ".env"), /^(?:export )?MISTRAL_API_KEY=\S/m),
        () => keychainHas("ai.mistral.vibe"),
      ])
    },
  },
  {
    id: "grok",
    name: "Grok",
    bin: "grok",
    run: { kind: "acp", args: ["agent", "stdio"] },
    keyEnv: [],
    signedIn: (home) => exists(join(process.env.GROK_HOME?.trim() || join(home, ".grok"), "auth.json")),
  },
  {
    id: "kimi",
    name: "Kimi Code",
    bin: "kimi",
    run: { kind: "acp", args: ["acp"] },
    keyEnv: [],
    signedIn: (home) =>
      dirHas(join(process.env.KIMI_CODE_HOME?.trim() || join(home, ".kimi-code"), "credentials"), /^kimi-code.*\.json$/),
  },
  {
    id: "kiro",
    name: "Kiro",
    bin: "kiro-cli",
    run: { kind: "acp", args: ["acp", "--agent-engine=v3", "--auth-method=cli"] },
    keyEnv: ["KIRO_API_KEY"],
    // The login lives in Kiro's own database; its presence is the best sign without opening it.
    signedIn: (home) =>
      exists(
        process.platform === "darwin"
          ? join(home, "Library/Application Support/kiro-cli/data.sqlite3")
          : join(xdgData(home), "kiro-cli/data.sqlite3"),
      ),
  },
  {
    id: "droid",
    name: "Droid (Factory)",
    bin: "droid",
    run: { kind: "acp", args: ["exec", "-o", "acp"] },
    keyEnv: ["FACTORY_API_KEY"],
    signedIn: (home) => dirHas(join(home, ".factory"), /^auth(?:\.v2\.[\w-]+|\.json)$/),
  },
  {
    id: "devin",
    name: "Devin",
    bin: "devin",
    run: { kind: "acp", args: ["acp"] },
    keyEnv: ["WINDSURF_API_KEY"],
    signedIn: (home) => exists(join(xdgConfig(home), "devin/credentials.toml")),
  },
  {
    id: "cline",
    name: "Cline",
    bin: "cline",
    run: { kind: "acp", args: ["--acp", "--auto-approve", "false"] },
    keyEnv: ["CLINE_API_KEY"],
    signedIn: (home) =>
      fileHas(
        join(process.env.CLINE_DIR?.trim() || join(home, ".cline"), "data/settings/providers.json"),
        /"(?:apiKey|accessToken)"\s*:\s*"[^"]+"/,
      ),
  },
  {
    id: "qwen",
    name: "Qwen Code",
    bin: "qwen",
    run: { kind: "acp", args: ["--acp"] },
    keyEnv: [],
    signedIn: (home) =>
      someTrue([() => exists(join(home, ".qwen/oauth_creds.json")), () => exists(join(home, ".qwen/settings.json"))]),
  },
  {
    id: "hermes",
    name: "Hermes",
    bin: "hermes",
    run: { kind: "acp", args: ["acp"] },
    keyEnv: [],
    signedIn: (home) =>
      someTrue([() => exists(join(home, ".hermes/config.yaml")), () => exists(join(home, ".hermes/auth.json"))]),
  },
  {
    id: "omp",
    name: "OMP (Oh My Pi)",
    bin: "omp",
    run: { kind: "acp", args: ["acp"] },
    keyEnv: [],
    signedIn: (home) => exists(join(home, ".omp/agent")),
  },
  {
    id: "pi",
    name: "pi",
    bin: "pi",
    run: { kind: "plain" },
    keyEnv: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"],
    signedIn: (home) => fileHas(join(home, ".pi/agent/auth.json"), /"\w[^"]*"\s*:\s*\{/),
  },
  {
    id: "deepseek",
    name: "DeepSeek Harness",
    bin: "dsh",
    run: { kind: "acp", args: ["--profile", "acp"] },
    keyEnv: ["DEEPSEEK_API_KEY"],
    signedIn: (home) => {
      const dsh = process.env.DSH_HOME?.trim() || join(home, ".dsh")
      return someTrue([
        () => fileHas(join(dsh, ".credentials.yaml"), /DEEPSEEK_API_KEY\s*:\s*\S/),
        () => fileHas(join(dsh, ".env"), /^(?:export )?DEEPSEEK_API_KEY\s*=\s*\S/m),
      ])
    },
  },
]

export function agentSpec(id: string): AgentSpec | undefined {
  return AGENT_SPECS.find((spec) => spec.id === id)
}

const exists = (p: string) => stat(p).then(() => true, () => false)

export { findBinary } from "./bin-path"

function run(file: string, args: string[], timeoutMs = 2_500): Promise<string> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: toolPath(file) }
    execFile(file, args, { timeout: timeoutMs, env }, (error, stdout) => resolve(error ? "" : String(stdout)))
  })
}

async function keychainHas(service: string): Promise<boolean> {
  if (process.platform !== "darwin") return false
  return new Promise((resolve) => execFile("/usr/bin/security", ["find-generic-password", "-s", service], (err) => resolve(!err)))
}

/** `fresh` re-reads every model list now instead of using the six-hour cache (the picker's refresh). */
export async function detectLocalAgents(opts: { fresh?: boolean } = {}): Promise<LocalAgent[]> {
  const home = homedir()
  const accounts: Partial<Record<string, () => Promise<string | null>>> = {
    "claude-code": () => claudeAccount(home),
    gemini: () => geminiAccount(home),
  }
  const [apps, servers] = await Promise.all([
    Promise.all(
      AGENT_SPECS.map(async (spec) => {
        const binary = await findBinary(spec.bin)
        const signedIn = binary ? hasEnv(spec.keyEnv) || (await spec.signedIn(home).catch(() => false)) : false
        const version = binary ? ((await run(binary, ["--version"])).match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null) : null
        const status: LocalAgent["status"] = !binary ? "not_installed" : signedIn ? "ready" : "signed_out"
        const [account, models] =
          status === "ready"
            ? await Promise.all([
                accounts[spec.id]?.().catch(() => null) ?? Promise.resolve(null),
                appModels(spec, binary, version, Date.now(), opts.fresh === true).catch(() => null),
              ])
            : [null, null]
        return {
          id: spec.id,
          name: spec.name,
          binary,
          status,
          version,
          ...(account ? { account } : {}),
          ...(models?.length ? { models } : {}),
        } satisfies LocalAgent
      }),
    ),
    detectLocalModelServers().catch(() => []),
  ])
  // Ollama / LM Studio: no sign-in, ready whenever they're running with a model downloaded.
  const local: LocalAgent[] = servers.map((server) => ({
    id: server.id,
    name: server.name,
    binary: null,
    status: server.models.length ? "ready" : "signed_out",
    version: null,
    models: server.models,
  }))
  return [...apps, ...local]
}
