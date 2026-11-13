/**
 * Usage readers for the Mac app. Bundled on its own (esbuild) because it uses @sayabot/core.
 *
 * Everything here runs in the app's main process. Sign-in tokens are read, used for one request
 * to the provider that issued them, and dropped: only percentages, reset times and token counts
 * are handed to the page.
 */
import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  lastCodexRateLimits,
  parseAntigravityQuota,
  parseClaudeUsage,
  parseCodexRateLimits,
  scanLocalUsage,
  type PlanLimits,
} from "@sayabot/core/scanner"

const TIMEOUT_MS = 8_000
const CACHE_MS = 60_000
const USER_AGENT = "sayabot-desktop"

function withTimeout(ms = TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms)
}

function unavailable(provider: PlanLimits["provider"], label: string, error: string): PlanLimits {
  return { provider, label, plan: null, windows: [], observedAt: new Date().toISOString(), error }
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 5_000, maxBuffer: 1 << 20 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

// ---------- Claude Code ----------

interface ClaudeCredentials {
  accessToken: string
  expiresAt: number | null
  subscriptionType: string | null
}

function claudeCredentialsFrom(text: string): ClaudeCredentials | null {
  try {
    const parsed = JSON.parse(text) as { claudeAiOauth?: Record<string, unknown> }
    const oauth = parsed.claudeAiOauth
    if (!oauth || typeof oauth.accessToken !== "string") return null
    return {
      accessToken: oauth.accessToken,
      expiresAt: typeof oauth.expiresAt === "number" ? oauth.expiresAt : null,
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
    }
  } catch {
    return null
  }
}

/** Claude Code keeps its sign-in in the macOS Keychain (or a file on other systems). */
async function claudeCredentials(): Promise<ClaudeCredentials | null> {
  if (process.platform === "darwin") {
    try {
      const text = await run("/usr/bin/security", [
        "find-generic-password",
        "-s",
        "Claude Code-credentials",
        "-w",
      ])
      const found = claudeCredentialsFrom(text.trim())
      if (found) return found
    } catch {
      // Not signed in, or the person declined the Keychain prompt.
    }
  }
  try {
    const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude")
    return claudeCredentialsFrom(await fs.readFile(path.join(dir, ".credentials.json"), "utf8"))
  } catch {
    return null
  }
}

export async function readClaudeLimits(): Promise<PlanLimits> {
  const label = "Claude"
  const credentials = await claudeCredentials()
  if (!credentials) return unavailable("claude", label, "Sign in to Claude Code on this Mac to see its limits.")
  if (credentials.expiresAt !== null && credentials.expiresAt < Date.now() + 60_000) {
    return unavailable("claude", label, "Claude Code's sign-in needs a refresh. Run Claude Code once, then check again.")
  }
  try {
    const response = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": USER_AGENT,
      },
      signal: withTimeout(),
    })
    if (response.status === 401 || response.status === 403) {
      return unavailable("claude", label, "Claude Code's sign-in needs a refresh. Run Claude Code once, then check again.")
    }
    if (!response.ok) return unavailable("claude", label, `Claude didn't answer (error ${response.status}).`)
    const windows = parseClaudeUsage(await response.json())
    if (!windows.length) {
      return unavailable("claude", label, "This Claude account has no plan limits (an API key or a team plan without them).")
    }
    return {
      provider: "claude",
      label,
      plan: credentials.subscriptionType,
      windows,
      observedAt: new Date().toISOString(),
      error: null,
    }
  } catch {
    return unavailable("claude", label, "Couldn't reach Claude. Check your connection.")
  }
}

// ---------- Codex ----------

/** Newest session logs first, without listing every file Codex ever wrote. */
async function newestCodexLogs(limit: number): Promise<string[]> {
  const root = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "sessions")
  const found: string[] = []
  const desc = async (dir: string) =>
    (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => b.name.localeCompare(a.name))
  for (const year of await desc(root)) {
    if (!year.isDirectory()) continue
    for (const month of await desc(path.join(root, year.name))) {
      if (!month.isDirectory()) continue
      for (const day of await desc(path.join(root, year.name, month.name))) {
        if (!day.isDirectory()) continue
        const dayDir = path.join(root, year.name, month.name, day.name)
        const files = (await desc(dayDir)).filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
        const withTimes = await Promise.all(
          files.map(async (entry) => {
            const file = path.join(dayDir, entry.name)
            const stat = await fs.stat(file).catch(() => null)
            return { file, mtime: stat?.mtimeMs ?? 0 }
          }),
        )
        for (const { file } of withTimes.sort((a, b) => b.mtime - a.mtime)) {
          found.push(file)
          if (found.length >= limit) return found
        }
      }
    }
  }
  return found
}

async function tail(file: string, bytes: number): Promise<string> {
  const handle = await fs.open(file, "r")
  try {
    const { size } = await handle.stat()
    const length = Math.min(size, bytes)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    return buffer.toString("utf8")
  } finally {
    await handle.close()
  }
}

/** Codex writes its own limit readings into every session log, so no sign-in is needed. */
export async function readCodexLimits(): Promise<PlanLimits> {
  const label = "Codex"
  const logs = await newestCodexLogs(8)
  if (!logs.length) return unavailable("codex", label, "No Codex sessions on this Mac yet.")
  for (const file of logs) {
    const found = lastCodexRateLimits(await tail(file, 512 * 1024).catch(() => ""))
    if (!found) continue
    const { windows, plan } = parseCodexRateLimits(found.rateLimits)
    if (!windows.length) continue
    return {
      provider: "codex",
      label,
      plan,
      windows,
      observedAt: found.observedAt ?? new Date().toISOString(),
      error: null,
    }
  }
  return unavailable("codex", label, "Codex hasn't reported its limits yet. Use Codex once and check again.")
}

// ---------- Antigravity ----------

const CODE_ASSIST = "https://cloudcode-pa.googleapis.com/v1internal"
const CODE_ASSIST_METERED = "https://daily-cloudcode-pa.googleapis.com/v1internal"

async function antigravityToken(): Promise<string | null | "expired"> {
  const home = process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini")
  try {
    const text = await fs.readFile(path.join(home, "antigravity-cli", "antigravity-oauth-token"), "utf8")
    const token = (JSON.parse(text) as { token?: { access_token?: unknown; expiry?: unknown } }).token
    if (!token || typeof token.access_token !== "string") return null
    const expiry = typeof token.expiry === "string" ? Date.parse(token.expiry) : NaN
    if (!(expiry > Date.now() + 60_000)) return "expired"
    return token.access_token
  } catch {
    return null
  }
}

async function codeAssist(base: string, method: string, body: unknown, token: string): Promise<unknown> {
  const response = await fetch(`${base}:${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify(body),
    signal: withTimeout(),
  })
  if (!response.ok) throw new Error(String(response.status))
  return response.json()
}

export async function readAntigravityLimits(): Promise<PlanLimits> {
  const label = "Antigravity"
  const token = await antigravityToken()
  if (token === null) return unavailable("antigravity", label, "Sign in to Antigravity on this Mac to see its limits.")
  if (token === "expired") {
    return unavailable("antigravity", label, "Antigravity's sign-in needs a refresh. Open Antigravity once, then check again.")
  }
  try {
    const loaded = (await codeAssist(CODE_ASSIST, "loadCodeAssist", {}, token)) as {
      cloudaicompanionProject?: unknown
    }
    const project = typeof loaded.cloudaicompanionProject === "string" ? loaded.cloudaicompanionProject : null
    if (!project) return unavailable("antigravity", label, "This Google account has no Antigravity plan limits.")
    const windows = parseAntigravityQuota(
      await codeAssist(CODE_ASSIST_METERED, "retrieveUserQuotaSummary", { project }, token),
    )
    if (!windows.length) return unavailable("antigravity", label, "Antigravity didn't report any limits.")
    return { provider: "antigravity", label, plan: null, windows, observedAt: new Date().toISOString(), error: null }
  } catch {
    return unavailable("antigravity", label, "Couldn't reach Antigravity's quota service.")
  }
}

// ---------- Entry points the app exposes ----------

let limitsCache: { at: number; value: PlanLimits[] } | null = null

/** All three, each failing on its own. Cached for a minute so the sidebar can poll cheaply. */
export async function readPlanLimits(force = false): Promise<PlanLimits[]> {
  if (!force && limitsCache && Date.now() - limitsCache.at < CACHE_MS) return limitsCache.value
  const value = await Promise.all([readClaudeLimits(), readCodexLimits(), readAntigravityLimits()])
  limitsCache = { at: Date.now(), value }
  return value
}

/** Token history from the coding tools' own logs on this Mac. */
export async function readLocalUsage(days: number) {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30
  const result = await scanLocalUsage({ days: safeDays })
  return { available: true, events: result.events, providersScanned: result.providersScanned }
}
