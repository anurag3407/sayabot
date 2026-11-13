import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { normalizeEffortLevels, type EffortLevel } from "./effort"
import { errorText, fetchCapped, providersCacheDir, safeEtag, type FetchLike } from "./http"
import bundledSnapshot from "./models-dev.snapshot.json"

/**
 * The models.dev catalog (https://models.dev, MIT): every provider's models with their context
 * window, list price per million tokens, tool support and reasoning-effort levels. Same design as
 * OpenCode / OpenMausBot: refreshed at most once a day with an ETag, kept on disk, and when the
 * network is down the newest of our cache, OpenCode's own cache and the snapshot bundled here wins.
 *
 * Maintenance: `pnpm --filter @sayabot/llm catalog:snapshot` rewrites the bundled snapshot.
 */

export const MODELS_DEV_URL = "https://models.dev/api.json"
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const CATALOG_FETCH_TIMEOUT_MS = 10_000
export const CATALOG_MAX_BYTES = 20 * 1024 * 1024
export const CATALOG_DISABLE_ENV = "SAYABOT_DISABLE_MODEL_CATALOG_FETCH"
export const CATALOG_SCHEMA = "sayabot.models-dev.v1"

/** One model, trimmed to the fields Sayabot uses. Keeps models.dev's names, so trimming twice is a no-op. */
export interface CatalogModel {
  id: string
  name: string
  reasoning?: true
  tool_call?: true
  /** Effort levels models.dev lists for this model (`reasoning_options` of type effort). */
  effort?: EffortLevel[]
  limit?: { context?: number; output?: number }
  /** US dollars per million tokens. */
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
}

export interface CatalogProvider {
  id: string
  name: string
  env?: string[]
  api?: string
  doc?: string
  models: Record<string, CatalogModel>
}

export type CatalogProviders = Record<string, CatalogProvider>

export interface ModelCatalog {
  origin: "cache" | "opencode" | "snapshot" | "empty"
  updatedAt: string
  providers: CatalogProviders
}

interface CatalogDocument {
  schema: string
  updatedAt: string
  source?: { name: string; url: string; license: string; etag?: string }
  providers: CatalogProviders
}

/** Sayabot provider id → models.dev provider id. */
export const MODELS_DEV_PROVIDER: Record<string, string> = {
  anthropic: "anthropic",
  "claude-code": "anthropic",
  openai: "openai",
  codex: "openai",
  google: "google",
  groq: "groq",
  cerebras: "cerebras",
  openrouter: "openrouter",
  copilot: "github-copilot",
  deepseek: "deepseek",
  minimax: "minimax",
  grok: "xai",
  kimi: "moonshotai",
  qwen: "alibaba",
  opencode: "opencode",
  cloudflare: "cloudflare-workers-ai",
  "command-code": "cohere",
}

const ID = /^[\w.:/@+-]{1,160}$/
const BRACE = /[{}]/

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value)

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined

const text = (value: unknown, max = 200): string | undefined =>
  typeof value === "string" && value.trim() && value.length <= max && !BRACE.test(value)
    ? value.trim()
    : undefined

function trimModel(key: string, raw: unknown): CatalogModel | null {
  if (!isRecord(raw) || !ID.test(key)) return null
  const id = typeof raw.id === "string" && ID.test(raw.id) ? raw.id : key
  const model: CatalogModel = { id, name: text(raw.name) ?? id }
  if (raw.reasoning === true) model.reasoning = true
  if (raw.tool_call === true) model.tool_call = true
  const effortValues = Array.isArray(raw.effort)
    ? raw.effort
    : Array.isArray(raw.reasoning_options)
      ? raw.reasoning_options.flatMap((option) =>
          isRecord(option) && option.type === "effort" && Array.isArray(option.values)
            ? option.values
            : [],
        )
      : []
  const effort = normalizeEffortLevels(effortValues)
  if (effort.length) model.effort = effort
  if (isRecord(raw.limit)) {
    const limit: NonNullable<CatalogModel["limit"]> = {}
    const context = finite(raw.limit.context)
    const output = finite(raw.limit.output)
    if (context) limit.context = context
    if (output) limit.output = output
    if (Object.keys(limit).length) model.limit = limit
  }
  if (isRecord(raw.cost)) {
    const cost: NonNullable<CatalogModel["cost"]> = {}
    for (const field of ["input", "output", "cache_read", "cache_write"] as const) {
      const price = finite(raw.cost[field])
      if (price !== undefined) cost[field] = price
    }
    if (Object.keys(cost).length) model.cost = cost
  }
  return model
}

/** Keeps only well-formed providers and models; drops anything with `{` or `}` in its text. */
export function trimModelsDevCatalog(
  raw: unknown,
  options: { onDrop?: () => void; only?: ReadonlySet<string> } = {},
): CatalogProviders {
  const out: CatalogProviders = {}
  if (!isRecord(raw)) return out
  for (const [key, value] of Object.entries(raw)) {
    if (options.only && !options.only.has(key)) continue
    if (!isRecord(value) || !ID.test(key) || !isRecord(value.models)) {
      options.onDrop?.()
      continue
    }
    const models: Record<string, CatalogModel> = {}
    for (const [modelKey, modelValue] of Object.entries(value.models)) {
      const model = trimModel(modelKey, modelValue)
      if (model) models[model.id] = model
      else options.onDrop?.()
    }
    if (!Object.keys(models).length) continue
    const provider: CatalogProvider = { id: key, name: text(value.name) ?? key, models }
    const env = Array.isArray(value.env)
      ? value.env.filter((e): e is string => typeof e === "string" && /^[A-Z0-9_]{1,80}$/.test(e))
      : []
    if (env.length) provider.env = env
    const api = text(value.api, 500)
    if (api) provider.api = api
    const doc = text(value.doc, 500)
    if (doc) provider.doc = doc
    out[key] = provider
  }
  return out
}

export function catalogStats(providers: CatalogProviders): { providers: number; models: number } {
  const list = Object.values(providers)
  return {
    providers: list.length,
    models: list.reduce((sum, p) => sum + Object.keys(p.models).length, 0),
  }
}

export function modelCatalogCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(providersCacheDir(env), "model-providers", "models-dev.json")
}

/** Where OpenCode keeps models.dev (xdg cache dir, on every OS). */
export function openCodeCatalogCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "opencode", "models.json")
}

const time = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? undefined : parsed
}

interface Candidate {
  origin: ModelCatalog["origin"]
  updatedAt: number
  providers: () => unknown
}

export interface ModelCatalogStoreOptions {
  env?: NodeJS.ProcessEnv
  fetch?: FetchLike
  now?: () => number
  log?: (line: string) => void
  /** null turns the OpenCode cache off (tests). */
  openCodeCachePath?: string | null
  snapshot?: unknown
  timeoutMs?: number
  maxBytes?: number
}

export type RefreshResult = "disabled" | "fresh" | "not-modified" | "updated" | "failed"

export class ModelCatalogStore {
  private memo: ModelCatalog | undefined
  private inflight: Promise<RefreshResult> | undefined
  readonly cachePath: string

  constructor(private readonly options: ModelCatalogStoreOptions = {}) {
    this.cachePath = modelCatalogCachePath(options.env)
  }

  private get now(): number {
    return (this.options.now ?? Date.now)()
  }

  private get env(): NodeJS.ProcessEnv {
    return this.options.env ?? process.env
  }

  private log(line: string): void {
    ;(this.options.log ?? ((l: string) => console.warn(l)))(`[model-catalog] ${line}`)
  }

  get fetchDisabled(): boolean {
    return this.env[CATALOG_DISABLE_ENV] === "1"
  }

  /** The newest usable catalog. Never throws and never waits on the network. */
  get(): ModelCatalog {
    if (this.memo) return this.memo
    const candidates = [this.ownCache(), this.openCodeCache(), this.snapshot()].filter(
      (candidate): candidate is Candidate => candidate !== undefined,
    )
    // Stable sort: on equal times the listed order (cache, OpenCode, snapshot) wins.
    candidates.sort((a, b) => b.updatedAt - a.updatedAt)
    for (const candidate of candidates) {
      const providers = trimModelsDevCatalog(candidate.providers())
      if (!Object.keys(providers).length) continue
      this.memo = {
        origin: candidate.origin,
        updatedAt: new Date(candidate.updatedAt).toISOString(),
        providers,
      }
      return this.memo
    }
    this.memo = { origin: "empty", updatedAt: new Date(0).toISOString(), providers: {} }
    return this.memo
  }

  /** Skipped while the cache is under a day old, unless `force`. Concurrent calls share one request. Never throws. */
  refresh(options: { force?: boolean } = {}): Promise<RefreshResult> {
    if (this.fetchDisabled) return Promise.resolve("disabled")
    this.inflight ??= this.fetchAndStore(Boolean(options.force)).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  private readDocument(): { doc: CatalogDocument; updatedAt: number } | undefined {
    if (!existsSync(this.cachePath)) return undefined
    try {
      if (statSync(this.cachePath).size > (this.options.maxBytes ?? CATALOG_MAX_BYTES))
        throw new Error("too large")
      const doc = JSON.parse(readFileSync(this.cachePath, "utf8")) as CatalogDocument
      const updatedAt = time(doc?.updatedAt)
      if (doc?.schema !== CATALOG_SCHEMA || updatedAt === undefined || !doc.providers) {
        throw new Error("unrecognised format")
      }
      return { doc, updatedAt }
    } catch (error) {
      this.log(`removed an unreadable catalog cache (${errorText(error)})`)
      try {
        rmSync(this.cachePath, { force: true })
      } catch {
        // already gone
      }
      return undefined
    }
  }

  private ownCache(): Candidate | undefined {
    const cached = this.readDocument()
    return (
      cached && {
        origin: "cache",
        updatedAt: cached.updatedAt,
        providers: () => cached.doc.providers,
      }
    )
  }

  private openCodeCache(): Candidate | undefined {
    const path =
      this.options.openCodeCachePath === undefined
        ? openCodeCatalogCachePath(this.env)
        : this.options.openCodeCachePath
    if (!path) return undefined
    try {
      const stat = statSync(path)
      if (!stat.isFile() || stat.size > (this.options.maxBytes ?? CATALOG_MAX_BYTES))
        return undefined
      return {
        origin: "opencode",
        updatedAt: stat.mtimeMs,
        providers: () => {
          try {
            return JSON.parse(readFileSync(path, "utf8"))
          } catch {
            return undefined
          }
        },
      }
    } catch {
      return undefined
    }
  }

  private snapshot(): Candidate | undefined {
    const doc = (this.options.snapshot ?? bundledSnapshot) as Partial<CatalogDocument> | undefined
    const updatedAt = time(doc?.updatedAt)
    if (!doc || doc.schema !== CATALOG_SCHEMA || updatedAt === undefined) return undefined
    return { origin: "snapshot", updatedAt, providers: () => doc.providers }
  }

  private async fetchAndStore(force: boolean): Promise<RefreshResult> {
    const cached = this.readDocument()
    const age = cached ? this.now - cached.updatedAt : Infinity
    if (!force && age >= 0 && age < CATALOG_MAX_AGE_MS) return "fresh"
    try {
      const etag = cached ? safeEtag(cached.doc.source?.etag) : undefined
      const response = await fetchCapped(MODELS_DEV_URL, {
        headers: { accept: "application/json", ...(etag ? { "if-none-match": etag } : {}) },
        timeoutMs: this.options.timeoutMs ?? CATALOG_FETCH_TIMEOUT_MS,
        maxBytes: this.options.maxBytes ?? CATALOG_MAX_BYTES,
        fetch: this.options.fetch,
      })
      if (response.status === 304) {
        if (!cached) throw new Error("models.dev answered 304 without a cached copy")
        this.write({ ...cached.doc, updatedAt: new Date(this.now).toISOString() })
        this.memo = undefined
        return "not-modified"
      }
      if (response.status !== 200) throw new Error(`models.dev returned HTTP ${response.status}`)
      let raw: unknown
      try {
        raw = JSON.parse(response.text)
      } catch {
        throw new Error("models.dev returned invalid JSON")
      }
      let drops = 0
      const providers = trimModelsDevCatalog(raw, { onDrop: () => (drops += 1) })
      if (!Object.keys(providers).length) throw new Error("models.dev returned no usable providers")
      this.write({
        schema: CATALOG_SCHEMA,
        updatedAt: new Date(this.now).toISOString(),
        source: {
          name: "models.dev",
          url: MODELS_DEV_URL,
          license: "MIT",
          ...(response.etag ? { etag: response.etag } : {}),
        },
        providers,
      })
      this.memo = undefined
      const stats = catalogStats(providers)
      this.log(
        `updated from models.dev: ${stats.providers} providers, ${stats.models} models` +
          (drops ? `; left out ${drops} malformed entries` : ""),
      )
      return "updated"
    } catch (error) {
      this.log(
        `could not refresh from models.dev (${errorText(error)}); keeping the current catalog`,
      )
      return "failed"
    }
  }

  private write(doc: CatalogDocument): void {
    writeJsonAtomic(this.cachePath, doc)
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(tmp, JSON.stringify(value))
  renameSync(tmp, path)
}

let store: ModelCatalogStore | undefined

/** The process-wide catalog store. */
export function modelCatalog(): ModelCatalogStore {
  return (store ??= new ModelCatalogStore())
}

/** Strips a release date (`-20251001`) and a `[1m]` suffix, the way Claude Code matches names. */
export function modelKey(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/(?:\[1m\])+$/, "")
    .replace(/-\d{8}$/, "")
}

/**
 * The catalog entry for a model: first under the provider's own models.dev id, then (for ids like
 * `anthropic/claude-sonnet-5` or a gateway serving a vendor's model) under any provider by the
 * same name. Returns null when models.dev doesn't know it.
 */
export function findCatalogModel(
  catalog: ModelCatalog,
  provider: string | null | undefined,
  modelId: string,
): CatalogModel | null {
  const id = modelId.trim()
  if (!id) return null
  const key = modelKey(id)
  const byKey = (p: CatalogProvider | undefined): CatalogModel | null => {
    if (!p) return null
    if (p.models[id]) return p.models[id]
    for (const model of Object.values(p.models)) if (modelKey(model.id) === key) return model
    return null
  }
  const own = provider ? catalog.providers[MODELS_DEV_PROVIDER[provider] ?? provider] : undefined
  const direct = byKey(own)
  if (direct) return direct
  const slash = id.lastIndexOf("/")
  const vendor = slash > 0 ? id.slice(0, slash).split("/").at(-1) : undefined
  const bare = slash > 0 ? id.slice(slash + 1) : undefined
  if (vendor && bare) {
    const viaVendor = byKey(catalog.providers[vendor])
    if (viaVendor && modelKey(viaVendor.id) === modelKey(bare)) return viaVendor
    const vendorModel = catalog.providers[vendor]?.models[bare]
    if (vendorModel) return vendorModel
  }
  // A first-party vendor entry beats a reseller's copy.
  for (const vendorId of [
    "anthropic",
    "openai",
    "google",
    "xai",
    "deepseek",
    "moonshotai",
    "alibaba",
  ]) {
    const found = catalog.providers[vendorId]?.models[bare ?? id]
    if (found) return found
  }
  return null
}

export interface ListPrice {
  inputPerMillion: number
  outputPerMillion: number
  cachedInputPerMillion?: number
  cacheWritePerMillion?: number
}

export function catalogPrice(model: CatalogModel | null | undefined): ListPrice | null {
  const cost = model?.cost
  if (!cost || cost.input === undefined || cost.output === undefined) return null
  return {
    inputPerMillion: cost.input,
    outputPerMillion: cost.output,
    ...(cost.cache_read !== undefined ? { cachedInputPerMillion: cost.cache_read } : {}),
    ...(cost.cache_write !== undefined ? { cacheWritePerMillion: cost.cache_write } : {}),
  }
}
