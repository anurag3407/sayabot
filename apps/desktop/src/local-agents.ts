import { execFile } from "node:child_process"
import { readdirSync } from "node:fs"
import { access, constants, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"

/**
 * Agent apps signed in on this computer. The desktop reports these to Sayabot (so the web
 * can show them even when Sayabot is hosted elsewhere) and the local runner uses them.
 * We check for login files/keychain entries; credentials are never read or sent.
 */

export interface LocalAgent {
  id: "claude-code" | "codex" | "gemini" | "opencode" | "hermes" | "cursor"
  name: string
  binary: string | null
  status: "ready" | "signed_out" | "not_installed"
  version: string | null
}

const BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  join(homedir(), ".local/bin"),
  join(homedir(), ".bun/bin"),
  join(homedir(), ".npm-global/bin"),
  join(homedir(), ".claude/local"),
]

/** Apps launched from the Dock get a bare PATH, so also look where nvm/volta/fnm install CLIs. */
function versionManagerBins(): string[] {
  const out: string[] = [join(homedir(), ".volta/bin"), join(homedir(), ".fnm/aliases/default/bin")]
  try {
    const base = join(homedir(), ".nvm/versions/node")
    for (const v of readdirSync(base).sort().reverse()) out.push(join(base, v, "bin"))
  } catch {
    // no nvm
  }
  return out
}

const exists = (p: string) => stat(p).then(() => true, () => false)

export async function findBinary(name: string): Promise<string | null> {
  const dirs = [...new Set([...(process.env.PATH ?? "").split(delimiter).filter(Boolean), ...BIN_DIRS, ...versionManagerBins()])]
  for (const dir of dirs) {
    const candidate = join(dir, name)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // keep looking
    }
  }
  return null
}

function run(file: string, args: string[], timeoutMs = 2_500): Promise<string> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: [dirname(file), process.env.PATH ?? ""].join(delimiter) }
    execFile(file, args, { timeout: timeoutMs, env }, (error, stdout) => resolve(error ? "" : String(stdout)))
  })
}

async function keychainHas(service: string): Promise<boolean> {
  if (process.platform !== "darwin") return false
  return new Promise((resolve) => execFile("/usr/bin/security", ["find-generic-password", "-s", service], (err) => resolve(!err)))
}

export async function detectLocalAgents(): Promise<LocalAgent[]> {
  const home = homedir()
  const specs: Array<{ id: LocalAgent["id"]; name: string; bin: string; signedIn: () => Promise<boolean> }> = [
    {
      id: "claude-code",
      name: "Claude Code",
      bin: "claude",
      signedIn: async () =>
        (await exists(join(home, ".claude/.credentials.json"))) ||
        (await readFile(join(home, ".claude.json"), "utf8").then((t) => t.includes('"oauthAccount"'), () => false)) ||
        (await keychainHas("Claude Code-credentials")),
    },
    { id: "codex", name: "Codex", bin: "codex", signedIn: () => exists(join(home, ".codex/auth.json")) },
    { id: "gemini", name: "Gemini CLI", bin: "gemini", signedIn: () => exists(join(home, ".gemini/oauth_creds.json")) },
    { id: "opencode", name: "OpenCode", bin: "opencode", signedIn: () => exists(join(home, ".local/share/opencode/auth.json")) },
    { id: "hermes", name: "Hermes", bin: "hermes", signedIn: () => exists(join(home, ".hermes")) },
    {
      id: "cursor",
      name: "Cursor",
      bin: "cursor-agent",
      signedIn: async () =>
        Boolean(process.env.CURSOR_API_KEY) ||
        (await keychainHas("cursor-access-token")) ||
        (await readFile(join(home, ".cursor/cli-config.json"), "utf8").then((t) => t.includes('"authInfo"'), () => false)),
    },
  ]
  return Promise.all(
    specs.map(async (spec) => {
      const binary = await findBinary(spec.bin)
      const signedIn = await spec.signedIn()
      const version = binary ? ((await run(binary, ["--version"])).match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null) : null
      return {
        id: spec.id,
        name: spec.name,
        binary,
        status: !binary ? "not_installed" : signedIn ? "ready" : "signed_out",
        version,
      } satisfies LocalAgent
    }),
  )
}
