import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { FetchLike } from "./http"

/**
 * Which subscription each signed-in CLI is on (Claude Pro/Max/Team, ChatGPT Plus/Pro…) and how
 * much of its rolling limits is used, the way OpenMausBot reads it: the token the CLI already
 * saved on this computer goes, in a header only, to the vendor's own usage endpoint. The token
 * never enters the result, a log line or the database.
 *
 * These endpoints are what Claude Code's `/usage` and Codex's `/status` call. They are not
 * public APIs, so every failure degrades to a row that says what went wrong; nothing throws.
 *
 * Only meaningful when this server is the person's own computer (same gate as the CLI runners).
 */

export const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage"
const PROVIDER_TIMEOUT_MS = 8_000
const PLAN_USAGE_CACHE_MS = 45_000
const CREDENTIAL_READ_MAX_BYTES = 1_000_000
const KEYCHAIN_TIMEOUT_MS = 5_000
const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials"
const CLAUDE_MODEL_FAMILIES = ["opus", "sonnet", "haiku", "fable"]

export type PlanEngine = "claude-code" | "codex"

export interface UsageWindow {
  label: string
  usedPercent: number
  resetsAt: string | null
}

export interface PlanUsage {
  engine: PlanEngine
  ok: boolean
  /** "max", "pro", "plus"… as the vendor names it; null when unknown. */
  plan: string | null
  /** 5-hour, weekly, per-model and extra-usage windows. */
  windows: UsageWindow[]
  /** Set when ok is false: "Sign in again in Claude Code", "Could not reach Codex"… */
  error?: string
  checkedAt: string
}

const PRODUCT: Record<PlanEngine, string> = { "claude-code": "Claude Code", codex: "Codex" }

// ── parsing ─────────────────────────────────────────────────────────────────────────────────

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

function timeMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value))
    return Math.abs(value) >= 1e12 ? value : value * 1000
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 80) return null
  if (/^\d+(\.\d+)?$/.test(trimmed)) return timeMs(Number(trimmed))
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function isoOrNull(value: unknown): string | null {
  const ms = timeMs(value)
  return ms === null ? null : new Date(ms).toISOString()
}

/** A plan name as sent, unless it is empty, long, multi-line or looks like a credential. */
export function planLabel(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 80 || /[\r\n]/.test(trimmed)) return null
  if (/bearer\s|access_token|refresh_token|sk-ant-|eyJ[a-zA-Z0-9_-]{8,}/i.test(trimmed)) return null
  return trimmed
}

const titleWords = (key: string) =>
  key
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")

function claudeWindow(label: string, value: unknown): UsageWindow | null {
  const record = asRecord(value)
  const utilization = finite(record?.utilization)
  if (!record || utilization === null) return null
  return {
    label,
    usedPercent: clampPercent(utilization),
    resetsAt: isoOrNull(record.resets_at ?? record.resetsAt),
  }
}

export function parseClaudeUsage(body: unknown): { plan: string | null; windows: UsageWindow[] } {
  let root = asRecord(body)
  if (root && !("five_hour" in root) && !("seven_day" in root)) {
    const nested = asRecord(root.usage) ?? asRecord(root.windows)
    if (nested && ("five_hour" in nested || "seven_day" in nested)) root = nested
  }
  const windows: UsageWindow[] = []
  if (!root) return { plan: null, windows }
  const five = claudeWindow("5-hour", root.five_hour)
  const week = claudeWindow("Weekly", root.seven_day)
  if (five) windows.push(five)
  if (week) windows.push(week)
  for (const [key, value] of Object.entries(root)) {
    if (!/^(five_hour|seven_day)_[a-z0-9_]{1,40}$/i.test(key)) continue
    const weekly = key.startsWith("seven_day_")
    const suffix = key.slice(weekly ? "seven_day_".length : "five_hour_".length)
    // Per-model windows (seven_day_opus); other named windows (seven_day_oauth_apps) are left out.
    if (!CLAUDE_MODEL_FAMILIES.some((name) => suffix.toLowerCase().startsWith(name))) continue
    const window = claudeWindow(`${titleWords(suffix)} · ${weekly ? "weekly" : "5-hour"}`, value)
    if (window) windows.push(window)
  }
  const extra = asRecord(root.extra_usage)
  if (extra?.is_enabled === true) {
    const used = finite(extra.used_credits)
    const limit = finite(extra.monthly_limit)
    const utilization = finite(extra.utilization)
    const percent = used !== null && limit && limit > 0 ? (used / limit) * 100 : utilization
    if (percent !== null)
      windows.push({ label: "Extra usage", usedPercent: clampPercent(percent), resetsAt: null })
  }
  return { plan: planLabel(root.subscription_type ?? root.plan ?? root.plan_type), windows }
}

function durationLabel(seconds: number): string {
  if (seconds >= 3 * 3600 && seconds <= 8 * 3600) return "5-hour"
  if (seconds >= 5 * 86400 && seconds <= 9 * 86400) return "Weekly"
  if (seconds >= 27 * 86400 && seconds <= 32 * 86400) return "Monthly"
  if (seconds < 86400) return `${Math.round(seconds / 3600)}-hour`
  return `${Math.round(seconds / 86400)}-day`
}

function codexWindows(node: unknown, prefix = ""): UsageWindow[] {
  const record = asRecord(node)
  if (!record) return []
  const source = asRecord(record.rate_limit) ?? record
  const out: UsageWindow[] = []
  const read = (value: unknown) => {
    const w = asRecord(value)
    const used = finite(w?.used_percent)
    let seconds = finite(w?.limit_window_seconds)
    const minutes = finite(w?.window_minutes)
    if (seconds === null && minutes !== null) seconds = minutes * 60
    if (!w || used === null || seconds === null || seconds <= 0) return
    out.push({
      label: `${prefix}${durationLabel(seconds)}`,
      usedPercent: clampPercent(used),
      resetsAt: isoOrNull(w.reset_at ?? w.resetAt),
    })
  }
  read(source.primary_window)
  read(source.secondary_window)
  if (!out.length) read(source)
  return out
}

export function parseCodexUsage(body: unknown): { plan: string | null; windows: UsageWindow[] } {
  const root = asRecord(body)
  if (!root) return { plan: null, windows: [] }
  const windows = codexWindows(root.rate_limit)
  if (root.code_review_rate_limit)
    windows.push(...codexWindows(root.code_review_rate_limit, "Code review · "))
  const additional = root.additional_rate_limits
  const named: Array<[string | null, unknown]> = Array.isArray(additional)
    ? additional.map((item) => {
        const r = asRecord(item)
        return [
          planLabel(r?.limit_name) ?? planLabel(r?.metered_feature) ?? planLabel(r?.name),
          item,
        ]
      })
    : Object.entries(asRecord(additional) ?? {}).map(([k, v]) => [planLabel(k), v])
  for (const [name, node] of named)
    if (name) windows.push(...codexWindows(node, `${titleWords(name)} · `))
  return { plan: planLabel(root.plan_type ?? root.plan), windows }
}

// ── credentials (read only, never returned) ─────────────────────────────────────────────────

interface Credential {
  token: string | null
  accountId: string | null
  expired: boolean
  /** The plan the CLI saved beside the login (Claude Code's `subscriptionType`); not a secret. */
  plan?: string | null
}

const missing = (): Credential => ({ token: null, accountId: null, expired: false })
const expired = (): Credential => ({ token: null, accountId: null, expired: true })

function secretString(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed && trimmed.length <= 16_000 && !/[\r\n]/.test(trimmed) ? trimmed : null
}

function readText(path: string): string | null {
  try {
    const stat = statSync(path)
    if (!stat.isFile() || stat.size > CREDENTIAL_READ_MAX_BYTES) return null
    return readFileSync(path, "utf8")
  } catch {
    return null
  }
}

function parseJson(text: string | null): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function claudeCredentialFromText(text: string | null, now: number): Credential {
  const root = asRecord(parseJson(text))
  const oauth = asRecord(root?.claudeAiOauth) ?? root
  const token = secretString(oauth?.accessToken) ?? secretString(oauth?.access_token)
  if (!token) return missing()
  const expiry = timeMs(oauth?.expiresAt ?? oauth?.expires_at)
  if (expiry !== null && expiry <= now) return expired()
  return {
    token,
    accountId: null,
    expired: false,
    plan: planLabel(oauth?.subscriptionType ?? oauth?.subscription_type),
  }
}

/** macOS may print the JSON secret as hex. */
function decodeKeychainSecret(raw: string | null): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (!trimmed.startsWith("{") && trimmed.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex").toString("utf8")
  }
  return trimmed
}

function readDarwinKeychain(service: string): Promise<string | null> {
  if (process.platform !== "darwin") return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      "/usr/bin/security",
      ["find-generic-password", "-s", service, "-w"],
      { timeout: KEYCHAIN_TIMEOUT_MS, maxBuffer: CREDENTIAL_READ_MAX_BYTES, encoding: "utf8" },
      (error, stdout) => resolve(error || !stdout ? null : stdout),
    )
  })
}

/** Claude Code names its Keychain entry after the config folder when CLAUDE_CONFIG_DIR moves it. */
function claudeKeychainService(env: NodeJS.ProcessEnv): string {
  const dir = env.CLAUDE_CONFIG_DIR?.trim()
  if (!dir || dir === join(homedir(), ".claude")) return CLAUDE_KEYCHAIN_SERVICE
  return `${CLAUDE_KEYCHAIN_SERVICE}-${createHash("sha256").update(dir).digest("hex").slice(0, 8)}`
}

async function readClaudeCredential(env: NodeJS.ProcessEnv, now: number): Promise<Credential> {
  const dir = env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude")
  const file = claudeCredentialFromText(readText(join(dir, ".credentials.json")), now)
  if (file.token) return file
  const keychain = claudeCredentialFromText(
    decodeKeychainSecret(await readDarwinKeychain(claudeKeychainService(env))),
    now,
  )
  if (keychain.token) return keychain
  return file.expired || keychain.expired ? expired() : missing()
}

function readCodexCredential(env: NodeJS.ProcessEnv, now: number): Credential {
  const home = env.CODEX_HOME?.trim() || join(homedir(), ".codex")
  const root = asRecord(parseJson(readText(join(home, "auth.json"))))
  if (!root) return missing()
  const tokens = asRecord(root.tokens)
  const token = secretString(tokens?.access_token) ?? secretString(root.access_token)
  if (!token) return missing()
  const expiry = timeMs(
    tokens?.expires_at ?? tokens?.expiresAt ?? root.expires_at ?? root.expiresAt,
  )
  if (expiry !== null && expiry <= now) return expired()
  return {
    token,
    accountId: secretString(tokens?.account_id) ?? secretString(root.account_id),
    expired: false,
  }
}

// ── fetching ────────────────────────────────────────────────────────────────────────────────

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; ok: boolean; body: unknown }> {
  try {
    const response = await fetchImpl(url, {
      headers: { "user-agent": "Sayabot", ...headers },
      redirect: "error",
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
    const text = await response.text().catch(() => "")
    return { status: response.status, ok: response.ok, body: parseJson(text.slice(0, 1_000_000)) }
  } catch {
    return { status: 0, ok: false, body: null }
  }
}

function errorRow(engine: PlanEngine, error: string): PlanUsage {
  return { engine, ok: false, plan: null, windows: [], error, checkedAt: new Date().toISOString() }
}

export interface PlanUsageDeps {
  fetch?: FetchLike
  env?: NodeJS.ProcessEnv
  now?: () => number
  /** Tests: replaces reading the local login. */
  readCredential?: (engine: PlanEngine) => Promise<Credential>
}

export async function fetchEnginePlanUsage(
  engine: PlanEngine,
  deps: PlanUsageDeps = {},
): Promise<PlanUsage> {
  const env = deps.env ?? process.env
  const fetchImpl = deps.fetch ?? ((url, init) => globalThis.fetch(url, init))
  const now = (deps.now ?? Date.now)()
  let credential: Credential
  try {
    credential = deps.readCredential
      ? await deps.readCredential(engine)
      : engine === "claude-code"
        ? await readClaudeCredential(env, now)
        : readCodexCredential(env, now)
  } catch {
    credential = missing()
  }
  if (!credential.token) {
    return errorRow(
      engine,
      credential.expired
        ? `Sign in again in ${PRODUCT[engine]}`
        : `${PRODUCT[engine]} is not signed in`,
    )
  }
  const result =
    engine === "claude-code"
      ? await fetchJson(fetchImpl, CLAUDE_USAGE_URL, {
          Authorization: `Bearer ${credential.token}`,
          Accept: "application/json",
          "anthropic-beta": "oauth-2025-04-20",
        })
      : await fetchJson(fetchImpl, CODEX_USAGE_URL, {
          Authorization: `Bearer ${credential.token}`,
          Accept: "application/json",
          ...(credential.accountId ? { "ChatGPT-Account-Id": credential.accountId } : {}),
        })
  if (result.status === 401 || result.status === 403)
    return errorRow(engine, `Sign in again in ${PRODUCT[engine]}`)
  if (!result.ok || !asRecord(result.body)) {
    return errorRow(
      engine,
      result.status === 0 || result.status >= 500
        ? `Could not reach ${PRODUCT[engine]}`
        : `${PRODUCT[engine]} returned an unexpected usage response`,
    )
  }
  const parsed =
    engine === "claude-code" ? parseClaudeUsage(result.body) : parseCodexUsage(result.body)
  // Anthropic's usage answer leaves the plan out; Claude Code saved it beside the login.
  return {
    engine,
    ok: true,
    ...parsed,
    plan: parsed.plan ?? credential.plan ?? null,
    checkedAt: new Date(now).toISOString(),
  }
}

const cache = new Map<PlanEngine, { at: number; value: Promise<PlanUsage> }>()

/** Cached for 45 seconds per engine, so opening the picker repeatedly makes one request. */
export function loadEnginePlanUsage(
  engine: PlanEngine,
  options: { force?: boolean } = {},
): Promise<PlanUsage> {
  const hit = cache.get(engine)
  if (hit && !options.force && Date.now() - hit.at < PLAN_USAGE_CACHE_MS) return hit.value
  const value = fetchEnginePlanUsage(engine)
  cache.set(engine, { at: Date.now(), value })
  return value
}

export function clearPlanUsageCache(): void {
  cache.clear()
}
