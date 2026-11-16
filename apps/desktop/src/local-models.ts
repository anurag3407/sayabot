import { mkdir, readFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { discoverAcpModels } from "./acp"
import { spawnTool, toolPath } from "./bin-path"

/**
 * What each app on this Mac can run, so Sayabot's model picker can offer it: the models an app
 * lists for the signed-in account, which account that is, and models served locally (Ollama,
 * LM Studio). Only names and ids leave this Mac; sign-in tokens are never read.
 */

export interface ReportedModel {
  id: string
  label: string
  /** Effort levels this model takes, when the app says. */
  effort?: string[]
  defaultEffort?: string
  /** The app's own default model today. */
  isDefault?: boolean
}

const LIST_FRESH_MS = 6 * 60 * 60_000
const CLI_TIMEOUT_MS = 15_000
const MODEL_ID = /^[\w.:/@+[\]-]{1,160}$/
const MAX_MODELS = 200

const text = (value: unknown, max = 120): string | null =>
  typeof value === "string" && value.trim() && value.length <= max ? value.trim() : null

function levels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) =>
      entry && typeof entry === "object"
        ? ((entry as { reasoningEffort?: unknown; effort?: unknown }).reasoningEffort ??
          (entry as { effort?: unknown }).effort)
        : entry,
    )
    .filter((entry): entry is string => typeof entry === "string" && /^[a-z]{1,10}$/.test(entry))
}

// ---------- accounts ----------

/** "you@example.com · Your Org" from Claude Code's settings file (not its credentials). */
export async function claudeAccount(home = homedir()): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(join(home, ".claude.json"), "utf8")) as {
      oauthAccount?: { emailAddress?: unknown; organizationName?: unknown }
    }
    const email = text(parsed.oauthAccount?.emailAddress)
    const org = text(parsed.oauthAccount?.organizationName)
    return [email, org].filter(Boolean).join(" · ") || null
  } catch {
    return null
  }
}

/** The active Google account Gemini CLI uses (its account list, not its tokens). */
export async function geminiAccount(home = homedir()): Promise<string | null> {
  try {
    const parsed = JSON.parse(
      await readFile(join(home, ".gemini/google_accounts.json"), "utf8"),
    ) as {
      active?: unknown
    }
    return text(parsed.active)
  } catch {
    return null
  }
}

// ---------- model lists ----------

/** Claude Code's `initialize` answer → picker rows. Aliases become the model they resolve to. */
export function claudeRowsToModels(rows: unknown[]): ReportedModel[] {
  const out: ReportedModel[] = []
  const seen = new Set<string>()
  let defaultId: string | null = null
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const value = text(row.value, 160)
    const id = text(row.resolvedModel, 160) ?? value
    if (!id || !MODEL_ID.test(id)) continue
    if (value === "default") {
      defaultId = id
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    const effort = row.supportsEffort === true ? levels(row.supportedEffortLevels) : []
    out.push({ id, label: text(row.displayName) ?? id, ...(effort.length ? { effort } : {}) })
  }
  for (const model of out) if (model.id === defaultId) model.isDefault = true
  return out.slice(0, MAX_MODELS)
}

/**
 * Starts `claude` in stream-json mode and sends only the `initialize` request: it answers with the
 * account's models. No prompt is sent, so nothing runs or is spent. Null on any failure.
 */
export function fetchClaudeModels(binary: string): Promise<ReportedModel[] | null> {
  return new Promise((resolve) => {
    let settled = false
    let buffer = ""
    const requestId = `sayabot-models-${Date.now()}`
    const env = { ...process.env, PATH: toolPath(binary) }
    const child = spawnTool(
      binary,
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--setting-sources",
        "user",
        "--strict-mcp-config",
        "--mcp-config",
        JSON.stringify({ mcpServers: {} }),
      ],
      { env, cwd: tmpdir(), stdio: ["pipe", "pipe", "ignore"] },
    )
    const finish = (value: ReportedModel[] | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.stdin?.end()
      } catch {
        // already closed
      }
      child.kill("SIGTERM")
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), CLI_TIMEOUT_MS)
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      buffer += chunk
      if (buffer.length > 4 * 1024 * 1024) return finish(null)
      let newline: number
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line.trim()) continue
        let message: {
          type?: unknown
          response?: { subtype?: unknown; request_id?: unknown; response?: { models?: unknown } }
        }
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.type !== "control_response" || message.response?.request_id !== requestId)
          continue
        const models = message.response?.response?.models
        return finish(
          message.response?.subtype === "success" && Array.isArray(models)
            ? claudeRowsToModels(models)
            : null,
        )
      }
    })
    child.on("error", () => finish(null))
    child.on("close", () => finish(null))
    try {
      child.stdin?.write(
        `${JSON.stringify({ type: "control_request", request_id: requestId, request: { subtype: "initialize" } })}\n`,
      )
    } catch {
      finish(null)
    }
  })
}

/** Codex keeps the account's model list in ~/.codex/models_cache.json whenever it runs. */
export async function codexModels(home = homedir()): Promise<ReportedModel[] | null> {
  try {
    const dir = process.env.CODEX_HOME?.trim() || join(home, ".codex")
    const data = JSON.parse(await readFile(join(dir, "models_cache.json"), "utf8")) as {
      models?: Array<Record<string, unknown>>
    }
    const out: ReportedModel[] = []
    for (const m of data.models ?? []) {
      const id = text(m.slug, 160)
      if (!id || !MODEL_ID.test(id) || m.visibility === "hidden") continue
      const effort = levels(m.supported_reasoning_levels ?? m.supported_reasoning_efforts)
      const defaultEffort = text(m.default_reasoning_level ?? m.default_reasoning_effort, 10)
      out.push({
        id,
        label: text(m.display_name) ?? id,
        ...(effort.length ? { effort } : {}),
        ...(defaultEffort ? { defaultEffort } : {}),
      })
    }
    return out.length ? out.slice(0, MAX_MODELS) : null
  } catch {
    return null
  }
}

/** `pi --list-models`: a table of provider and model for the providers pi has keys for. */
export function piRowsToModels(output: string): ReportedModel[] {
  const out: ReportedModel[] = []
  for (const line of output.split("\n").slice(1)) {
    const [provider, model] = line.trim().split(/\s+/)
    const id = provider && model ? `${provider}/${model}` : ""
    if (!id || !MODEL_ID.test(id) || out.some((row) => row.id === id)) continue
    out.push({ id, label: `${model.split("/").pop() ?? model} · ${provider}` })
    if (out.length >= MAX_MODELS) break
  }
  return out
}

async function piModels(binary: string): Promise<ReportedModel[] | null> {
  const models = piRowsToModels(await cliText(binary, ["--list-models"]))
  return models.length ? models : null
}

/** `cursor-agent models` prints `slug - Label` lines (it has no JSON output yet). */
export function cursorRowsToModels(output: string): ReportedModel[] {
  const out: ReportedModel[] = []
  for (const line of output.split("\n")) {
    const match = /^\s*([\w.:/@+-]+)\s+-\s+(.+?)\s*(\((?:current|default)[^)]*\))?\s*$/i.exec(line)
    const id = match?.[1]
    if (!match || !id || !MODEL_ID.test(id) || out.some((row) => row.id === id)) continue
    out.push({ id, label: match[2]?.trim() || id, ...(match[3] ? { isDefault: true } : {}) })
    if (out.length >= MAX_MODELS) break
  }
  return out
}

function cliText(binary: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const env = { ...process.env, PATH: toolPath(binary), NO_COLOR: "1" }
    const child = spawnTool(binary, args, {
      env,
      cwd: tmpdir(),
      stdio: ["ignore", "pipe", "ignore"],
    })
    let output = ""
    const timer = setTimeout(() => child.kill("SIGTERM"), CLI_TIMEOUT_MS)
    child.stdout?.on("data", (chunk: Buffer) => {
      if (output.length < 2 * 1024 * 1024) output += chunk.toString("utf8")
    })
    child.on("error", () => resolve(""))
    child.on("close", () => {
      clearTimeout(timer)
      resolve(output)
    })
  })
}

const listCache = new Map<
  string,
  { at: number; version: string | null; models: ReportedModel[] | null }
>()

/** An app's models, read at most every 6 hours, and again when its version changes. */
export async function appModels(
  app: { id: string; run: { kind: string; args?: readonly string[] } },
  binary: string | null,
  version: string | null,
  now = Date.now(),
  fresh = false,
): Promise<ReportedModel[] | null> {
  if (!binary) return null
  const id = app.id
  const cached = listCache.get(id)
  if (
    !fresh &&
    cached &&
    cached.version === version &&
    now - cached.at < LIST_FRESH_MS &&
    cached.models
  ) {
    return cached.models
  }
  let models: ReportedModel[] | null = null
  if (id === "claude-code") models = await fetchClaudeModels(binary)
  else if (id === "codex") models = await codexModels()
  else if (id === "pi") models = await piModels(binary)
  else if (app.run.kind === "acp") {
    const folder = join(tmpdir(), "sayabot-models")
    await mkdir(folder, { recursive: true }).catch(() => undefined)
    const env = { ...process.env, PATH: toolPath(binary), NO_COLOR: "1" }
    models = await discoverAcpModels(binary, app.run.args ?? [], { cwd: folder, env })
    // Cursor's own list when its ACP session doesn't offer one (OpenMausBot does the same).
    if (!models && id === "cursor") {
      const listed = cursorRowsToModels(await cliText(binary, ["models"]))
      models = listed.length ? listed : null
    }
  }
  // Keep the last good list when a read fails; the server falls back to its own list otherwise.
  if (!models && cached?.version === version) models = cached.models
  listCache.set(id, { at: now, version, models })
  return models
}

// ---------- local model servers ----------

export interface LocalModelServer {
  id: "ollama" | "lmstudio"
  name: string
  baseUrl: string
  models: ReportedModel[]
}

const LOCAL_SERVERS: Array<{
  id: LocalModelServer["id"]
  name: string
  baseUrl: string
  list: string
}> = [
  { id: "ollama", name: "Ollama", baseUrl: "http://127.0.0.1:11434", list: "/api/tags" },
  { id: "lmstudio", name: "LM Studio", baseUrl: "http://127.0.0.1:1234", list: "/v1/models" },
]

/** Ollama's `/api/tags` or an OpenAI-style `/v1/models` answer → picker rows. */
export function localServerModels(body: unknown): ReportedModel[] {
  if (!body || typeof body !== "object") return []
  const record = body as { models?: unknown; data?: unknown }
  const rows = Array.isArray(record.models)
    ? record.models
    : Array.isArray(record.data)
      ? record.data
      : []
  const out: ReportedModel[] = []
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue
    const row = raw as Record<string, unknown>
    const id = text(row.model, 160) ?? text(row.name, 160) ?? text(row.id, 160)
    if (!id || !MODEL_ID.test(id) || out.some((m) => m.id === id)) continue
    // Embedding models can't answer a chat.
    if (/embed/i.test(id)) continue
    out.push({ id, label: text(row.name) ?? id })
  }
  return out.slice(0, MAX_MODELS)
}

/** Ollama / LM Studio running on this Mac right now, with the models they have downloaded. */
export async function detectLocalModelServers(
  fetchImpl: typeof fetch = fetch,
): Promise<LocalModelServer[]> {
  const found = await Promise.all(
    LOCAL_SERVERS.map(async (server) => {
      try {
        const res = await fetchImpl(`${server.baseUrl}${server.list}`, {
          signal: AbortSignal.timeout(1_500),
        })
        if (!res.ok) return null
        return {
          id: server.id,
          name: server.name,
          baseUrl: server.baseUrl,
          models: localServerModels(await res.json()),
        }
      } catch {
        return null
      }
    }),
  )
  return found.filter((server): server is LocalModelServer => server !== null)
}

/** Where a local model server listens, for the runner. */
export function localServerUrl(id: string): string | null {
  return LOCAL_SERVERS.find((server) => server.id === id)?.baseUrl ?? null
}
