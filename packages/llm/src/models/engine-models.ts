import { execFile, spawn } from "node:child_process"
import { readdirSync, readFileSync } from "node:fs"
import { access, constants, readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, join } from "node:path"
import { ENGINE_EFFORT_LEVELS, normalizeEffortLevels, type EffortLevel } from "./effort"
import { providersCacheDir } from "./http"
import {
  modelManifest,
  manifestPrice,
  parseVersionTriple,
  versionAtLeast,
  type ManifestEngine,
  type ModelManifest,
} from "./manifest"
import {
  catalogPrice,
  findCatalogModel,
  modelCatalog,
  modelKey,
  writeJsonAtomic,
  type ListPrice,
} from "./models-dev"

/**
 * The models each subscription engine (Claude Code, Codex, Cursor) offers the signed-in account,
 * the way OpenMausBot reads them:
 *  - Codex: asks the CLI itself (`codex app-server`, JSON-RPC `model/list`), with each model's
 *    effort levels and default; falls back to Codex's own models_cache.json, then the manifest.
 *  - Claude Code: has no list command, so the manifest, minus models the organization blocks
 *    (`modelAccessCache` in ~/.claude.json), with models the installed CLI is too old for marked.
 *  - Cursor: the manifest.
 * A list read from a CLI is kept on disk for 6 hours so the picker opens without starting it.
 */

export interface EngineModel {
  id: string
  label: string
  /** Wired in the person's own config (a custom Codex provider), not an official model. */
  custom?: boolean
  contextWindow?: number
  /** Effort levels this model takes; undefined means the engine's list. */
  effort?: EffortLevel[]
  defaultEffort?: EffortLevel
  /** The organization does not allow this model. */
  orgBlocked?: boolean
  /** The oldest CLI version that can run it, when the installed one is older. */
  needsCliUpdate?: string
  price?: ListPrice
}

export interface EngineCatalog {
  default: string
  options: EngineModel[]
  /** Where the list came from. */
  source: "live" | "cache" | "manifest"
  checkedAt: number
  effortLevels: EffortLevel[]
}

export const ENGINE_CACHE_FRESH_MS = 6 * 60 * 60_000
const CLI_TIMEOUT_MS = 15_000
const ACCOUNT_FILE_MAX_BYTES = 32 * 1024 * 1024

// ── CLI discovery ───────────────────────────────────────────────────────────────────────────

const COMMON_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  join(homedir(), ".local/bin"),
  join(homedir(), ".bun/bin"),
  join(homedir(), ".npm-global/bin"),
  join(homedir(), ".claude/local"),
  join(homedir(), ".volta/bin"),
]

function nvmBins(): string[] {
  try {
    const base = join(homedir(), ".nvm/versions/node")
    return readdirSync(base)
      .sort()
      .reverse()
      .map((v) => join(base, v, "bin"))
  } catch {
    return []
  }
}

const BINARY: Record<ManifestEngine, { name: string; env: string }> = {
  "claude-code": { name: "claude", env: "SAYABOT_CLAUDE_PATH" },
  codex: { name: "codex", env: "SAYABOT_CODEX_PATH" },
  cursor: { name: "cursor-agent", env: "SAYABOT_CURSOR_PATH" },
}

/** Apps started from the Dock or a service manager get a bare PATH, so also look where CLIs install. */
export async function findEngineBinary(
  engine: ManifestEngine,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const override = env[BINARY[engine].env]?.trim()
  const dirs = [
    ...new Set([
      ...(env.PATH ?? "").split(delimiter).filter(Boolean),
      ...COMMON_BIN_DIRS,
      ...nvmBins(),
    ]),
  ]
  const candidates = override ? [override] : dirs.map((dir) => join(dir, BINARY[engine].name))
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

export function engineVersion(binary: string | null): Promise<string | null> {
  if (!binary) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(binary, ["--version"], { timeout: 4_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
      const match = String(stdout ?? "").match(/\d+\.\d+\.\d+/)
      resolve(error || !match ? null : match[0])
    })
  })
}

// ── disk cache ──────────────────────────────────────────────────────────────────────────────

export function engineCachePath(
  engine: ManifestEngine,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return join(providersCacheDir(env), "engine-models", `${engine}.json`)
}

function readEngineCache(engine: ManifestEngine): EngineCatalog | null {
  try {
    const raw = JSON.parse(readFileSync(engineCachePath(engine), "utf8")) as Partial<EngineCatalog>
    if (typeof raw.default !== "string" || !Array.isArray(raw.options) || !raw.options.length)
      return null
    const options = raw.options.filter(
      (o): o is EngineModel =>
        Boolean(o) && typeof o.id === "string" && typeof o.label === "string",
    )
    return {
      default: raw.default,
      options,
      source: "cache",
      checkedAt: typeof raw.checkedAt === "number" ? raw.checkedAt : 0,
      effortLevels: normalizeEffortLevels(raw.effortLevels ?? []),
    }
  } catch {
    return null
  }
}

function writeEngineCache(engine: ManifestEngine, catalog: EngineCatalog): void {
  try {
    writeJsonAtomic(engineCachePath(engine), catalog)
  } catch {
    // a read-only data folder just means the CLI is asked again next time
  }
}

// ── pricing ─────────────────────────────────────────────────────────────────────────────────

/** Manifest price first (maintained here), then models.dev's. */
export function listPriceFor(
  provider: string | null,
  model: string,
  manifest?: ModelManifest,
): ListPrice | null {
  return (
    manifestPrice(model, manifest) ??
    catalogPrice(findCatalogModel(modelCatalog().get(), provider, model))
  )
}

// ── manifest-backed engines ─────────────────────────────────────────────────────────────────

function manifestCatalog(engine: ManifestEngine, version: string | null): EngineCatalog {
  const manifest = modelManifest().current()
  const entry = manifest.engines[engine]
  const provider = engine === "claude-code" ? "anthropic" : engine === "codex" ? "openai" : null
  const installed = parseVersionTriple(version)
  const options: EngineModel[] = (entry?.models ?? [])
    .filter((m) => m.status === "current")
    .map((m) => {
      const floor = m.minCliVersion ? parseVersionTriple(m.minCliVersion) : null
      const catalogModel = provider ? findCatalogModel(modelCatalog().get(), provider, m.id) : null
      const price = listPriceFor(provider, m.id, manifest)
      return {
        id: m.id,
        label: m.name,
        ...(m.contextWindow || catalogModel?.limit?.context
          ? { contextWindow: m.contextWindow ?? catalogModel?.limit?.context }
          : {}),
        ...(catalogModel?.effort ? { effort: catalogModel.effort } : {}),
        ...(installed && floor && m.minCliVersion && !versionAtLeast(installed, floor)
          ? { needsCliUpdate: m.minCliVersion }
          : {}),
        ...(price ? { price } : {}),
      }
    })
  return {
    default: entry?.default ?? options[0]?.id ?? "default",
    options,
    source: "manifest",
    checkedAt: Date.now(),
    effortLevels: [...(ENGINE_EFFORT_LEVELS[engine] ?? [])],
  }
}

/** Fails open: a missing or malformed file hides nothing, and only an explicit `entitled: false` counts. */
export function parseOrgBlockedModels(text: string | null): Set<string> {
  const blocked = new Set<string>()
  if (!text) return blocked
  try {
    const root = JSON.parse(text) as { modelAccessCache?: unknown }
    if (!Array.isArray(root.modelAccessCache)) return blocked
    for (const entry of root.modelAccessCache as Array<{ apiName?: unknown; entitled?: unknown }>) {
      if (typeof entry?.apiName === "string" && entry.entitled === false)
        blocked.add(modelKey(entry.apiName))
    }
  } catch {
    // unreadable: hide nothing
  }
  return blocked
}

/** On these backends the cloud account decides, and a list left by an earlier claude.ai login means nothing. */
const CLAUDE_CLOUD_BACKEND_ENV = [
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_FOUNDRY",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_ANTHROPIC_AWS",
  "CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD",
]

async function claudeOrgBlocks(env: NodeJS.ProcessEnv): Promise<Set<string>> {
  if (CLAUDE_CLOUD_BACKEND_ENV.some((key) => env[key])) return new Set()
  const folder = env.CLAUDE_CONFIG_DIR?.trim()
  const home = homedir()
  for (const path of [
    join(folder || join(home, ".claude"), ".config.json"),
    join(folder || home, ".claude.json"),
  ]) {
    const found = await stat(path).catch(() => null)
    if (!found?.isFile() || found.size === 0) continue
    if (found.size > ACCOUNT_FILE_MAX_BYTES) return new Set()
    return parseOrgBlockedModels(await readFile(path, "utf8").catch(() => null))
  }
  return new Set()
}

/** A blocked or too-new default gives way to the first usable model, so a new agent never starts on one. */
function withUsableDefault(catalog: EngineCatalog): EngineCatalog {
  const usable = (o: EngineModel) => !o.orgBlocked && !o.needsCliUpdate
  if (catalog.options.some((o) => o.id === catalog.default && usable(o))) return catalog
  const fallback = catalog.options.find((o) => usable(o) && !o.custom)
  return fallback ? { ...catalog, default: fallback.id } : catalog
}

export async function claudeModelCatalog(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EngineCatalog> {
  const version = await engineVersion(await findEngineBinary("claude-code", env))
  const catalog = manifestCatalog("claude-code", version)
  const blocked = await claudeOrgBlocks(env)
  return withUsableDefault({
    ...catalog,
    options: catalog.options.map((o) =>
      blocked.has(modelKey(o.id)) ? { ...o, orgBlocked: true } : o,
    ),
  })
}

export async function cursorModelCatalog(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EngineCatalog> {
  const version = await engineVersion(await findEngineBinary("cursor", env))
  return manifestCatalog("cursor", version)
}

// ── Codex: the CLI's own list ───────────────────────────────────────────────────────────────

interface CodexModelRow {
  id?: unknown
  model?: unknown
  displayName?: unknown
  hidden?: unknown
  isDefault?: unknown
  defaultReasoningEffort?: unknown
  supportedReasoningEfforts?: unknown
}

const CODEX_MODEL_ID = /^[\w.:/@+-]{1,160}$/

/** Turns `model/list` rows into picker rows. Official models are bare ids; anything with a `/` is a custom provider's. */
export function codexCatalogFromRows(rows: readonly CodexModelRow[]): EngineCatalog | null {
  const options: EngineModel[] = []
  const seen = new Set<string>()
  let defaultModel: string | null = null
  const manifest = modelManifest().current()
  for (const row of rows) {
    if (
      row.hidden === true ||
      typeof row.id !== "string" ||
      !CODEX_MODEL_ID.test(row.id) ||
      seen.has(row.id)
    )
      continue
    seen.add(row.id)
    const label =
      typeof row.displayName === "string" && row.displayName.trim()
        ? row.displayName.trim()
        : row.id
    const effort = Array.isArray(row.supportedReasoningEfforts)
      ? normalizeEffortLevels(
          row.supportedReasoningEfforts.map((e) =>
            e && typeof e === "object" ? (e as { reasoningEffort?: unknown }).reasoningEffort : e,
          ),
        )
      : []
    const defaultEffort = normalizeEffortLevels([row.defaultReasoningEffort])[0]
    const custom = row.id.includes("/")
    const price = custom ? null : listPriceFor("openai", row.id, manifest)
    const catalogModel = custom ? null : findCatalogModel(modelCatalog().get(), "openai", row.id)
    options.push({
      id: row.id,
      label,
      ...(custom ? { custom: true } : {}),
      ...(effort.length ? { effort } : {}),
      ...(defaultEffort ? { defaultEffort } : {}),
      ...(catalogModel?.limit?.context ? { contextWindow: catalogModel.limit.context } : {}),
      ...(price ? { price } : {}),
    })
    if (row.isDefault === true) defaultModel = row.id
  }
  if (!options.length) return null
  // Official models first, the person's custom providers after, each in Codex's order.
  options.sort((a, b) => Number(Boolean(a.custom)) - Number(Boolean(b.custom)))
  return {
    default: defaultModel && seen.has(defaultModel) ? defaultModel : (options[0]?.id ?? "default"),
    options,
    source: "live",
    checkedAt: Date.now(),
    effortLevels: [...(ENGINE_EFFORT_LEVELS.codex ?? [])],
  }
}

/** Starts `codex app-server` and pages through `model/list`. Resolves null on any failure. */
export function fetchCodexModelRows(
  binary: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CodexModelRow[] | null> {
  return new Promise((resolve) => {
    let settled = false
    let buffer = ""
    let nextId = 1
    const rows: CodexModelRow[] = []
    const cursors = new Set<string>()
    const pending = new Map<number, "initialize" | "models">()
    const child = spawn(binary, ["app-server"], { env, stdio: ["pipe", "pipe", "ignore"] })
    const finish = (value: CodexModelRow[] | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill("SIGTERM")
      resolve(value)
    }
    const request = (method: string, params: unknown, kind: "initialize" | "models") => {
      const id = nextId++
      pending.set(id, kind)
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      } catch {
        finish(null)
      }
    }
    const timer = setTimeout(() => finish(rows.length ? rows : null), CLI_TIMEOUT_MS)
    timer.unref?.()
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (!line.trim()) continue
        let message: {
          id?: number
          error?: unknown
          result?: { data?: unknown; nextCursor?: unknown }
        }
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        const kind = typeof message.id === "number" ? pending.get(message.id) : undefined
        if (!kind || typeof message.id !== "number") continue
        pending.delete(message.id)
        if (message.error) return finish(null)
        if (kind === "initialize") {
          try {
            child.stdin.write(
              `${JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} })}\n`,
            )
          } catch {
            return finish(null)
          }
          request("model/list", { cursor: null, limit: 100 }, "models")
          continue
        }
        if (Array.isArray(message.result?.data))
          rows.push(...(message.result.data as CodexModelRow[]))
        const cursor =
          typeof message.result?.nextCursor === "string" ? message.result.nextCursor : null
        if (cursor && !cursors.has(cursor) && cursors.size < 20) {
          cursors.add(cursor)
          request("model/list", { cursor, limit: 100 }, "models")
          continue
        }
        finish(rows)
      }
    })
    child.on("error", () => finish(null))
    child.on("close", () => finish(rows.length ? rows : null))
    request("initialize", { clientInfo: { name: "sayabot", version: "1" } }, "initialize")
  })
}

/** Codex's own cache of the account's models, refreshed by Codex whenever it runs. */
async function codexModelsCache(env: NodeJS.ProcessEnv): Promise<CodexModelRow[] | null> {
  try {
    const home = env.CODEX_HOME?.trim() || join(homedir(), ".codex")
    const data = JSON.parse(await readFile(join(home, "models_cache.json"), "utf8")) as {
      models?: Array<{ slug?: unknown; display_name?: unknown; visibility?: unknown }>
    }
    return (data.models ?? []).map((m) => ({
      id: m.slug,
      displayName: m.display_name,
      hidden: m.visibility === "hidden",
    }))
  } catch {
    return null
  }
}

export async function codexModelCatalog(
  options: { force?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<EngineCatalog> {
  const env = options.env ?? process.env
  const cached = readEngineCache("codex")
  const age = cached ? Date.now() - cached.checkedAt : Infinity
  if (cached && !options.force && age >= 0 && age < ENGINE_CACHE_FRESH_MS) return cached
  const binary = await findEngineBinary("codex", env)
  const rows = binary ? await fetchCodexModelRows(binary, env) : null
  const live = rows ? codexCatalogFromRows(rows) : null
  if (live) {
    writeEngineCache("codex", live)
    return live
  }
  if (cached) return cached
  const fromCache = await codexModelsCache(env)
  const local = fromCache ? codexCatalogFromRows(fromCache) : null
  return local
    ? { ...local, source: "cache" }
    : manifestCatalog("codex", await engineVersion(binary))
}

export async function engineModelCatalog(
  engine: ManifestEngine,
  options: { force?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<EngineCatalog> {
  if (engine === "codex") return codexModelCatalog(options)
  if (options.force) await modelManifest().refresh({ force: true })
  else await modelManifest().refreshOnDemand()
  return engine === "claude-code"
    ? claudeModelCatalog(options.env)
    : cursorModelCatalog(options.env)
}
