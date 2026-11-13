import "server-only"
import { execFile } from "node:child_process"
import { readdirSync } from "node:fs"
import { access, constants, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { localAgentStatus, LOCAL_AGENT_APPS, type LocalAgentReport } from "@/lib/local-agents-shared"

/**
 * Finds agent apps installed on this computer (Claude Code, Codex, Gemini CLI…) and whether
 * each is signed in, so they can join a room on their own subscription. Only meaningful when
 * Sayabot's server runs on the person's own machine (self-hosted / desktop). We look for login
 * files and keychain entries; we never read or send the credentials themselves.
 */

const COMMON_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  join(homedir(), ".local/bin"),
  join(homedir(), ".bun/bin"),
  join(homedir(), ".npm-global/bin"),
  join(homedir(), ".cargo/bin"),
  join(homedir(), ".claude/local"),
]

function versionManagerBins(): string[] {
  const out: string[] = [join(homedir(), ".volta/bin")]
  try {
    const base = join(homedir(), ".nvm/versions/node")
    for (const v of readdirSync(base).sort().reverse()) out.push(join(base, v, "bin"))
  } catch {
    // no nvm
  }
  return out
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function findBinary(names: readonly string[]): Promise<string | null> {
  const dirs = [...new Set([...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...COMMON_BIN_DIRS, ...versionManagerBins()])]
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name)
      try {
        await access(candidate, constants.X_OK)
        return candidate
      } catch {
        // keep looking
      }
    }
  }
  return null
}

function run(file: string, args: string[], timeoutMs = 2_500): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, out: String(stdout ?? "") })
    })
  })
}

/** Keychain lookup by service name only (no -w), so the secret itself is never printed. */
async function keychainHas(service: string): Promise<boolean> {
  if (process.platform !== "darwin") return false
  const result = await run("/usr/bin/security", ["find-generic-password", "-s", service], 2_000)
  return result.ok
}

async function fileHasKey(path: string, key: string): Promise<boolean> {
  try {
    const text = await readFile(path, "utf8")
    return text.includes(`"${key}"`)
  } catch {
    return false
  }
}

async function versionOf(binary: string | null): Promise<string | null> {
  if (!binary) return null
  const result = await run(binary, ["--version"])
  const match = result.out.match(/\d+\.\d+(?:\.\d+)?/)
  return match ? match[0] : null
}

/** The models Codex lists for the signed-in account (its own cache, refreshed by Codex). */
async function codexModels(home: string): Promise<Array<{ id: string; label: string }>> {
  try {
    const text = await readFile(join(process.env.CODEX_HOME || join(home, ".codex"), "models_cache.json"), "utf8")
    const data = JSON.parse(text) as { models?: Array<{ slug?: unknown; display_name?: unknown; visibility?: unknown }> }
    return (data.models ?? [])
      .filter((m) => typeof m.slug === "string" && m.visibility !== "hidden")
      .slice(0, 80)
      .map((m) => ({ id: String(m.slug), label: typeof m.display_name === "string" ? m.display_name : String(m.slug) }))
  } catch {
    return []
  }
}

export async function detectLocalAgents(): Promise<LocalAgentReport[]> {
  const home = homedir()
  return Promise.all(
    LOCAL_AGENT_APPS.map(async (app) => {
      const binary = await findBinary(app.binaries)
      const appBundle = app.macApp ? await exists(app.macApp) : false
      let signedIn: boolean | null = null
      switch (app.id) {
        case "claude-code":
          signedIn =
            (await exists(join(home, ".claude/.credentials.json"))) ||
            (await fileHasKey(join(home, ".claude.json"), "oauthAccount")) ||
            (await keychainHas("Claude Code-credentials"))
          break
        case "codex":
          signedIn = await exists(join(home, ".codex/auth.json"))
          break
        case "gemini":
          signedIn = (await exists(join(home, ".gemini/oauth_creds.json"))) || (await exists(join(home, ".gemini/google_accounts.json")))
          break
        case "cursor":
          signedIn =
            Boolean(process.env.CURSOR_API_KEY) ||
            (await keychainHas("cursor-access-token")) ||
            (await fileHasKey(join(home, ".cursor/cli-config.json"), "authInfo"))
          break
        case "opencode":
          signedIn = await exists(join(home, ".local/share/opencode/auth.json"))
          break
        case "hermes":
          signedIn = (await exists(join(home, ".hermes/config.yaml"))) || (await exists(join(home, ".hermes/.env")))
          break
        default:
          signedIn = null
      }
      const version = await versionOf(binary)
      const models = app.id === "codex" ? await codexModels(home) : undefined
      return {
        id: app.id,
        name: app.name,
        icon: app.icon,
        inviteApp: app.inviteApp,
        version,
        status: localAgentStatus({ installed: Boolean(binary) || appBundle, signedIn }),
        cli: Boolean(binary),
        ...(models?.length ? { models } : {}),
      }
    }),
  )
}

/** Detection only makes sense when this server is the person's own computer. */
export function localDetectionAllowed(host: string | null): boolean {
  const flag = process.env.SAYABOT_LOCAL_DETECTION
  if (flag === "0") return false
  if (flag === "1") return true
  const h = (host ?? "").toLowerCase().replace(/:\d+$/, "")
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1"
}
