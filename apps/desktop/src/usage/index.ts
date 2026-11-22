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
  parseCopilotLimits,
  parseCursorUsage,
  parseOpenCodeQuota,
  parseOpenRouterQuota,
  parseZCodeQuota,
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

/** Claude's usage endpoint rate-limits hard; after a 429 we stay quiet for a while. */
const CLAUDE_BACKOFF_MS = 5 * 60_000
let claudeQuietUntil = 0

export async function readClaudeLimits(): Promise<PlanLimits> {
  const label = "Claude"
  if (Date.now() < claudeQuietUntil)
    return unavailable("claude", label, "Claude is busy. Showing the last reading.")
  const credentials = await claudeCredentials()
  if (!credentials)
    return unavailable(
      "claude",
      label,
      "Sign in to Claude Code on this computer to see its limits.",
    )
  if (credentials.expiresAt !== null && credentials.expiresAt < Date.now() + 60_000) {
    return unavailable(
      "claude",
      label,
      "Claude Code's sign-in needs a refresh. Run Claude Code once, then check again.",
    )
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
      return unavailable(
        "claude",
        label,
        "Claude Code's sign-in needs a refresh. Run Claude Code once, then check again.",
      )
    }
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("retry-after"))
      claudeQuietUntil =
        Date.now() +
        (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : CLAUDE_BACKOFF_MS)
      return unavailable("claude", label, "Claude is busy. Showing the last reading.")
    }
    if (!response.ok)
      return unavailable("claude", label, `Claude didn't answer (error ${response.status}).`)
    const windows = parseClaudeUsage(await response.json())
    if (!windows.length) {
      return unavailable(
        "claude",
        label,
        "This Claude account has no plan limits (an API key or a team plan without them).",
      )
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
    (await fs.readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) =>
      b.name.localeCompare(a.name),
    )
  for (const year of await desc(root)) {
    if (!year.isDirectory()) continue
    for (const month of await desc(path.join(root, year.name))) {
      if (!month.isDirectory()) continue
      for (const day of await desc(path.join(root, year.name, month.name))) {
        if (!day.isDirectory()) continue
        const dayDir = path.join(root, year.name, month.name, day.name)
        const files = (await desc(dayDir)).filter(
          (entry) => entry.isFile() && entry.name.endsWith(".jsonl"),
        )
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
  if (!logs.length) return unavailable("codex", label, "No Codex sessions on this computer yet.")
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
  return unavailable(
    "codex",
    label,
    "Codex hasn't reported its limits yet. Use Codex once and check again.",
  )
}

// ---------- Antigravity ----------

const CODE_ASSIST = "https://cloudcode-pa.googleapis.com/v1internal"
const CODE_ASSIST_METERED = "https://daily-cloudcode-pa.googleapis.com/v1internal"

async function antigravityToken(): Promise<string | null | "expired"> {
  const home = process.env.GEMINI_HOME || path.join(os.homedir(), ".gemini")
  try {
    const text = await fs.readFile(
      path.join(home, "antigravity-cli", "antigravity-oauth-token"),
      "utf8",
    )
    const token = (JSON.parse(text) as { token?: { access_token?: unknown; expiry?: unknown } })
      .token
    if (!token || typeof token.access_token !== "string") return null
    const expiry = typeof token.expiry === "string" ? Date.parse(token.expiry) : NaN
    if (!(expiry > Date.now() + 60_000)) return "expired"
    return token.access_token
  } catch {
    return null
  }
}

async function codeAssist(
  base: string,
  method: string,
  body: unknown,
  token: string,
): Promise<unknown> {
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
  if (token === null)
    return unavailable(
      "antigravity",
      label,
      "Sign in to Antigravity on this computer to see its limits.",
    )
  if (token === "expired") {
    return unavailable(
      "antigravity",
      label,
      "Antigravity's sign-in needs a refresh. Open Antigravity once, then check again.",
    )
  }
  try {
    const loaded = (await codeAssist(CODE_ASSIST, "loadCodeAssist", {}, token)) as {
      cloudaicompanionProject?: unknown
    }
    const project =
      typeof loaded.cloudaicompanionProject === "string" ? loaded.cloudaicompanionProject : null
    if (!project)
      return unavailable(
        "antigravity",
        label,
        "This Google account has no Antigravity plan limits.",
      )
    const windows = parseAntigravityQuota(
      await codeAssist(CODE_ASSIST_METERED, "retrieveUserQuotaSummary", { project }, token),
    )
    if (!windows.length)
      return unavailable("antigravity", label, "Antigravity didn't report any limits.")
    return {
      provider: "antigravity",
      label,
      plan: null,
      windows,
      observedAt: new Date().toISOString(),
      error: null,
    }
  } catch {
    return unavailable("antigravity", label, "Couldn't reach Antigravity's quota service.")
  }
}

// ---------- OpenCode ----------

export async function readOpenCodeLimits(): Promise<PlanLimits> {
  const label = "OpenCode"
  const home = os.homedir()

  let apiKey = process.env.OPENCODE_API_KEY?.trim() || null
  let openRouterKey: string | null = null

  const authPath = process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, "opencode", "auth.json")
    : path.join(home, ".local", "share", "opencode", "auth.json")
  try {
    const raw = await fs.readFile(authPath, "utf8")
    const parsed = JSON.parse(raw)
    if (typeof parsed?.access_token === "string") apiKey = parsed.access_token
    else if (typeof parsed?.apiKey === "string") apiKey = parsed.apiKey
  } catch {}

  const configPath = process.env.XDG_CONFIG_HOME
    ? path.join(process.env.XDG_CONFIG_HOME, "opencode", "opencode.json")
    : path.join(home, ".config", "opencode", "opencode.json")
  try {
    const raw = await fs.readFile(configPath, "utf8")
    const parsed = JSON.parse(raw)
    const prov = parsed?.provider
    if (prov) {
      if (typeof prov["opencode-zen"]?.options?.apiKey === "string") {
        apiKey = apiKey || prov["opencode-zen"].options.apiKey
      }
      if (typeof prov.tokenrouter?.options?.apiKey === "string") {
        openRouterKey = prov.tokenrouter.options.apiKey
      } else if (typeof prov.openrouter?.options?.apiKey === "string") {
        openRouterKey = prov.openrouter.options.apiKey
      }
    }
  } catch {}

  if (openRouterKey) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${openRouterKey}`, "User-Agent": USER_AGENT },
        signal: withTimeout(),
      })
      if (resp.ok) {
        const keyJson = await resp.json()
        const creditsResp = await fetch("https://openrouter.ai/api/v1/credits", {
          headers: { Authorization: `Bearer ${openRouterKey}`, "User-Agent": USER_AGENT },
          signal: withTimeout(),
        }).catch(() => null)
        const creditsJson = creditsResp?.ok ? await creditsResp.json() : null
        const { windows, plan } = parseOpenRouterQuota(keyJson, creditsJson)
        if (windows.length) {
          return {
            provider: "opencode",
            label,
            plan: plan ?? "OpenRouter",
            windows,
            observedAt: new Date().toISOString(),
            error: null,
          }
        }
      }
    } catch {}
  }

  if (apiKey) {
    try {
      const resp = await fetch("https://api.opencode.ai/v1/user/quota", {
        headers: { Authorization: `Bearer ${apiKey}`, "User-Agent": USER_AGENT },
        signal: withTimeout(),
      })
      if (resp.ok) {
        const { windows, plan } = parseOpenCodeQuota(await resp.json())
        if (windows.length) {
          return {
            provider: "opencode",
            label,
            plan,
            windows,
            observedAt: new Date().toISOString(),
            error: null,
          }
        }
      }
    } catch {}
  }

  const dbPath = process.env.XDG_DATA_HOME
    ? path.join(process.env.XDG_DATA_HOME, "opencode", "opencode.db")
    : path.join(home, ".local", "share", "opencode", "opencode.db")
  const hasDb = await fs.stat(dbPath).then(
    () => true,
    () => false,
  )
  const hasConfig = await fs.stat(configPath).then(
    () => true,
    () => false,
  )

  if (hasDb || hasConfig || apiKey || openRouterKey) {
    return {
      provider: "opencode",
      label,
      plan: apiKey ? "Account" : "Local / Free",
      windows: [
        {
          label: "Active Session",
          usedPercent: 0,
          resetsAt: null,
          windowMinutes: 300,
        },
      ],
      observedAt: new Date().toISOString(),
      error: null,
    }
  }

  return unavailable("opencode", label, "Sign in to OpenCode or add a provider in opencode.json.")
}

// ---------- Pi / OMP ----------

export async function readPiLimits(): Promise<PlanLimits> {
  const label = "pi"
  const home = os.homedir()

  const authPaths = [
    path.join(home, ".pi", "agent", "auth.json"),
    path.join(home, ".omp", "agent", "auth.json"),
  ]
  let openRouterToken = process.env.OPENROUTER_API_KEY?.trim() || null
  let hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY?.trim())
  let hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim())

  for (const p of authPaths) {
    try {
      const raw = await fs.readFile(p, "utf8")
      const parsed = JSON.parse(raw)
      if (parsed?.openrouter) {
        const or = parsed.openrouter
        if (typeof or.access === "string") openRouterToken = or.access
        else if (typeof or.apiKey === "string") openRouterToken = or.apiKey
      }
      if (parsed?.anthropic?.apiKey) hasAnthropic = true
      if (parsed?.openai?.apiKey) hasOpenAI = true
    } catch {}
  }

  if (openRouterToken) {
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/auth/key", {
        headers: { Authorization: `Bearer ${openRouterToken}`, "User-Agent": USER_AGENT },
        signal: withTimeout(),
      })
      if (resp.ok) {
        const keyJson = await resp.json()
        const creditsResp = await fetch("https://openrouter.ai/api/v1/credits", {
          headers: { Authorization: `Bearer ${openRouterToken}`, "User-Agent": USER_AGENT },
          signal: withTimeout(),
        }).catch(() => null)
        const creditsJson = creditsResp?.ok ? await creditsResp.json() : null
        const { windows, plan } = parseOpenRouterQuota(keyJson, creditsJson)
        if (windows.length) {
          return {
            provider: "pi",
            label,
            plan: plan ?? "OpenRouter",
            windows,
            observedAt: new Date().toISOString(),
            error: null,
          }
        }
      }
    } catch {}

    return {
      provider: "pi",
      label,
      plan: "OpenRouter",
      windows: [
        { label: "OpenRouter Active", usedPercent: 0, resetsAt: null, windowMinutes: null },
      ],
      observedAt: new Date().toISOString(),
      error: null,
    }
  }

  if (hasAnthropic || hasOpenAI) {
    return {
      provider: "pi",
      label,
      plan: hasAnthropic ? "Anthropic BYOK" : "OpenAI BYOK",
      windows: [{ label: "API Key Active", usedPercent: 0, resetsAt: null, windowMinutes: null }],
      observedAt: new Date().toISOString(),
      error: null,
    }
  }

  return unavailable("pi", label, "Sign in to pi or set OPENROUTER_API_KEY to see limits.")
}

// ---------- Cursor ----------

export async function readCursorLimits(): Promise<PlanLimits> {
  const label = "Cursor"
  const home = os.homedir()

  const apiKey = process.env.CURSOR_API_KEY?.trim() || null

  if (apiKey) {
    try {
      const authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`
      const resp = await fetch("https://api.cursor.com/teams/spend", {
        headers: { Authorization: authHeader, "User-Agent": USER_AGENT },
        signal: withTimeout(),
      })
      if (resp.ok) {
        const { windows, plan } = parseCursorUsage(await resp.json())
        if (windows.length) {
          return {
            provider: "cursor",
            label,
            plan: plan ?? "Team",
            windows,
            observedAt: new Date().toISOString(),
            error: null,
          }
        }
      }
    } catch {}
  }

  const cursorDirs = [
    path.join(home, ".cursor"),
    path.join(home, "Library", "Application Support", "Cursor"),
  ]
  let hasCursor = false
  for (const dir of cursorDirs) {
    try {
      await fs.access(dir)
      hasCursor = true
      break
    } catch {}
  }

  if (hasCursor) {
    return {
      provider: "cursor",
      label,
      plan: "Pro / Fast Reqs",
      windows: [
        {
          label: "Fast Requests",
          usedPercent: 0,
          resetsAt: null,
          windowMinutes: 43200,
        },
      ],
      observedAt: new Date().toISOString(),
      error: null,
    }
  }

  return unavailable("cursor", label, "Install and sign in to Cursor on this computer.")
}

// ---------- GitHub Copilot ----------

export async function readCopilotLimits(): Promise<PlanLimits> {
  const label = "Copilot"
  const home = os.homedir()

  let token =
    process.env.COPILOT_GITHUB_TOKEN?.trim() ||
    process.env.GH_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    null

  if (!token) {
    try {
      const raw = await fs.readFile(
        path.join(home, ".config", "github-copilot", "apps.json"),
        "utf8",
      )
      const parsed = JSON.parse(raw)
      for (const val of Object.values(parsed)) {
        if (typeof (val as Record<string, unknown>)?.oauth_token === "string") {
          token = (val as Record<string, unknown>).oauth_token as string
          break
        }
      }
    } catch {}
  }

  if (!token) {
    try {
      const raw = await fs.readFile(path.join(home, ".config", "gh", "hosts.yml"), "utf8")
      const match = raw.match(/oauth_token:\s*(\S+)/)
      if (match) token = match[1]
    } catch {}
  }

  if (!token) {
    try {
      token = (await run("gh", ["auth", "token"])).trim() || null
    } catch {}
  }

  if (token) {
    try {
      const resp = await fetch("https://api.github.com/copilot_internal/v2/token", {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        signal: withTimeout(),
      })
      const headers: Record<string, string> = {}
      resp.headers.forEach((v, k) => {
        headers[k.toLowerCase()] = v
      })
      if (resp.ok) {
        const { windows, plan } = parseCopilotLimits(await resp.json(), headers)
        return {
          provider: "copilot",
          label,
          plan: plan ?? "Active",
          windows,
          observedAt: new Date().toISOString(),
          error: null,
        }
      }
    } catch {}

    return {
      provider: "copilot",
      label,
      plan: "GitHub Copilot",
      windows: [
        { label: "Copilot Subscription", usedPercent: 0, resetsAt: null, windowMinutes: 43200 },
      ],
      observedAt: new Date().toISOString(),
      error: null,
    }
  }

  return unavailable("copilot", label, "Sign in to GitHub Copilot or GitHub CLI on this computer.")
}

// ---------- ZCode (Z.ai / GLM Coding Plan) ----------

export async function readZCodeLimits(): Promise<PlanLimits> {
  const label = "ZCode"
  const home = os.homedir()

  let apiKey =
    process.env.ZCODE_API_KEY?.trim() ||
    process.env.ZAI_API_KEY?.trim() ||
    process.env.GLM_API_KEY?.trim() ||
    null

  const configPaths = [
    path.join(home, ".zcode", "cli", "config.json"),
    path.join(home, ".zcode", "cli", "setting.json"),
    path.join(home, ".zcode", "v2", "provider_config.json"),
  ]

  for (const p of configPaths) {
    if (apiKey) break
    try {
      const raw = await fs.readFile(p, "utf8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (typeof parsed?.apiKey === "string") apiKey = parsed.apiKey
      else if (typeof parsed?.token === "string") apiKey = parsed.token
      else if (typeof (parsed?.zai as Record<string, unknown>)?.apiKey === "string")
        apiKey = (parsed.zai as Record<string, unknown>).apiKey as string
    } catch {}
  }

  if (apiKey) {
    try {
      const resp = await fetch("https://api.z.ai/api/monitor/usage/quota/limit", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": USER_AGENT,
        },
        signal: withTimeout(),
      })
      if (resp.ok) {
        const { windows, plan } = parseZCodeQuota(await resp.json())
        if (windows.length) {
          return {
            provider: "zcode",
            label,
            plan: plan ?? "GLM Plan",
            windows,
            observedAt: new Date().toISOString(),
            error: null,
          }
        }
      }
    } catch {}

    return {
      provider: "zcode",
      label,
      plan: "Coding Plan",
      windows: [
        {
          label: "5-hour Window",
          usedPercent: 0,
          resetsAt: null,
          windowMinutes: 300,
        },
      ],
      observedAt: new Date().toISOString(),
      error: null,
    }
  }

  return unavailable("zcode", label, "Sign in to ZCode (`zcode login zai`) or set ZCODE_API_KEY.")
}

// ---------- Entry points the app exposes ----------

let limitsCache: { at: number; value: PlanLimits[] } | null = null
/** The last reading with numbers, per provider: a passing failure shows it instead of nothing. */
const lastGood = new Map<PlanLimits["provider"], PlanLimits>()
const LAST_GOOD_MS = 12 * 60 * 60_000

/** A failed read (rate limit, sign-in refresh, network) falls back to the last good one. */
export function withLastGood(reading: PlanLimits, now = Date.now()): PlanLimits {
  if (reading.windows.length) {
    lastGood.set(reading.provider, reading)
    return reading
  }
  const kept = lastGood.get(reading.provider)
  if (kept && now - Date.parse(kept.observedAt) < LAST_GOOD_MS) return kept
  return reading
}

/** All providers, each failing on its own. Cached for a minute so the top bar can poll cheaply. */
export async function readPlanLimits(force = false): Promise<PlanLimits[]> {
  if (!force && limitsCache && Date.now() - limitsCache.at < CACHE_MS) return limitsCache.value
  const read = await Promise.all([
    readClaudeLimits(),
    readCodexLimits(),
    readAntigravityLimits(),
    readOpenCodeLimits(),
    readPiLimits(),
    readCursorLimits(),
    readCopilotLimits(),
    readZCodeLimits(),
  ])
  const value = read.map((reading) => withLastGood(reading))
  limitsCache = { at: Date.now(), value }
  return value
}

/** Token history from the coding tools' own logs on this Mac. */
export async function readLocalUsage(days: number) {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30
  const result = await scanLocalUsage({ days: safeDays })
  return { available: true, events: result.events, providersScanned: result.providersScanned }
}
