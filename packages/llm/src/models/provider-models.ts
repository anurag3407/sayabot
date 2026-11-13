import { createHash } from "node:crypto"
import { ENGINE_EFFORT_LEVELS, type EffortLevel } from "./effort"
import { errorText, fetchCapped, safeCredentialUrl, type FetchLike } from "./http"
import { manifestPrice } from "./manifest"
import { catalogPrice, findCatalogModel, modelCatalog, type ListPrice } from "./models-dev"

/**
 * The models a saved API key can use, read live from the provider (`GET {base}/models`), each
 * with its list price, context window and effort levels from models.dev. OpenRouter's own list
 * carries its prices, so those win there, and a free-tier OpenRouter key gets its free,
 * tool-capable models first (a paid model answers HTTP 402 on such a key).
 */

export interface ProviderModel {
  id: string
  label: string
  free?: boolean
  contextWindow?: number
  /** Empty: the model does not reason, so the picker offers only Default. */
  effort?: EffortLevel[]
  tools?: boolean
  price?: ListPrice
}

export interface ProviderModelList {
  models: ProviderModel[]
  /** "live" from the provider, "catalog" from models.dev when the provider could not be read. */
  source: "live" | "catalog"
  /** OpenRouter only: the key has never bought credit. */
  freeTier?: boolean
  error?: string
}

const MAX_BYTES = 8 * 1024 * 1024
const MAX_MODELS = 1000
const TIMEOUT_MS = 10_000
const LIST_TTL_MS = 10 * 60_000

export const PROVIDER_BASE_URL: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  groq: "https://api.groq.com/openai/v1",
  cerebras: "https://api.cerebras.ai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  copilot: "https://api.githubcopilot.com",
  opencode: "https://api.opencode.ai/v1",
  deepseek: "https://api.deepseek.com/v1",
  minimax: "https://api.minimaxi.chat/v1",
  grok: "https://api.x.ai/v1",
  kimi: "https://api.moonshot.cn/v1",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
}

/** Free models that call tools well, best first; otherwise the first free tool-capable model wins. */
export const OPENROUTER_FREE_PREFERENCE = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "google/gemma-4-31b-it:free",
  "poolside/laguna-s-2.1:free",
  "nvidia/nemotron-3.5-lightning:free",
]

export function providerModelsUrl(
  provider: string,
  baseUrl: string | null | undefined,
): string | null {
  const base = (baseUrl?.trim() || PROVIDER_BASE_URL[provider] || "").replace(/\/+$/, "")
  if (!base) return null
  if (provider === "anthropic") return base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`
  return `${base}/models`
}

function headersFor(provider: string, key: string): Record<string, string> {
  if (provider === "anthropic")
    return { "x-api-key": key, "anthropic-version": "2023-06-01", accept: "application/json" }
  if (provider === "google") return { "x-goog-api-key": key, accept: "application/json" }
  return { authorization: `Bearer ${key}`, accept: "application/json" }
}

interface RawModel {
  id?: unknown
  name?: unknown
  display_name?: unknown
  displayName?: unknown
  context_length?: unknown
  pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown }
  supported_parameters?: unknown
}

function rawList(body: unknown): RawModel[] {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null
  const list = Array.isArray(body)
    ? body
    : Array.isArray(record?.data)
      ? record.data
      : Array.isArray(record?.models)
        ? record.models
        : []
  return (list as unknown[])
    .filter((x): x is RawModel => Boolean(x) && typeof x === "object")
    .slice(0, MAX_MODELS)
}

const perToken = (value: unknown): number | undefined => {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 1e6) / 1e6 : undefined
}

export function isFreeOpenRouterModel(row: RawModel): boolean {
  const id = typeof row.id === "string" ? row.id : ""
  return id.endsWith(":free") || (row.pricing?.prompt === "0" && row.pricing?.completion === "0")
}

/** One provider row → picker row, filled in from models.dev where the provider says nothing. */
export function toProviderModel(provider: string, row: RawModel): ProviderModel | null {
  const rawId = typeof row.id === "string" ? row.id : typeof row.name === "string" ? row.name : null
  if (!rawId) return null
  const id = provider === "google" ? rawId.replace(/^models\//, "") : rawId
  if (!/^[\w.:/@+-]{1,160}$/.test(id)) return null
  const known = findCatalogModel(modelCatalog().get(), provider, id.replace(/:free$/, ""))
  const name =
    (typeof row.display_name === "string" && row.display_name) ||
    (typeof row.displayName === "string" && row.displayName) ||
    (provider === "openrouter" && typeof row.name === "string" && row.name) ||
    known?.name ||
    id
  const free = provider === "openrouter" ? isFreeOpenRouterModel(row) : false
  const params = Array.isArray(row.supported_parameters)
    ? (row.supported_parameters as unknown[])
    : null
  const reasoning = params
    ? params.includes("reasoning") || params.includes("reasoning_effort")
    : Boolean(known?.reasoning)
  const effort: EffortLevel[] =
    known?.effort ??
    (reasoning ? [...(ENGINE_EFFORT_LEVELS[provider] ?? ["low", "medium", "high"])] : [])
  const orPrice =
    provider === "openrouter" &&
    perToken(row.pricing?.prompt) !== undefined &&
    perToken(row.pricing?.completion) !== undefined
      ? {
          inputPerMillion: perToken(row.pricing?.prompt) ?? 0,
          outputPerMillion: perToken(row.pricing?.completion) ?? 0,
          ...(perToken(row.pricing?.input_cache_read) !== undefined
            ? { cachedInputPerMillion: perToken(row.pricing?.input_cache_read) }
            : {}),
        }
      : null
  const price = orPrice ?? manifestPrice(id) ?? catalogPrice(known)
  const context =
    typeof row.context_length === "number" ? row.context_length : known?.limit?.context
  return {
    id,
    label: free && !/\(free\)\s*$/i.test(name) ? `${name} (free)` : name,
    ...(free ? { free: true } : {}),
    ...(context ? { contextWindow: context } : {}),
    effort,
    ...(params ? { tools: params.includes("tools") } : known?.tool_call ? { tools: true } : {}),
    ...(price ? { price } : {}),
  }
}

/** The provider's models as models.dev lists them, for when the provider itself cannot be read. */
export function catalogProviderModels(provider: string): ProviderModel[] {
  const catalog = modelCatalog().get()
  const ids = Object.keys(catalog.providers[providerCatalogId(provider)]?.models ?? {})
  return ids.flatMap((id) => {
    const row = toProviderModel(provider, { id })
    return row ? [row] : []
  })
}

function providerCatalogId(provider: string): string {
  const map: Record<string, string> = {
    copilot: "github-copilot",
    grok: "xai",
    kimi: "moonshotai",
    qwen: "alibaba",
  }
  return map[provider] ?? provider
}

/** Security: only the key's SHA-256 is remembered, and the key goes nowhere but OpenRouter's /key over TLS. */
const freeTiers = new Map<string, boolean>()

export async function openRouterFreeTier(
  key: string,
  fetchImpl?: FetchLike,
): Promise<boolean | null> {
  const hash = createHash("sha256").update(key).digest("hex")
  const known = freeTiers.get(hash)
  if (known !== undefined) return known
  try {
    const response = await fetchCapped("https://openrouter.ai/api/v1/key", {
      headers: { authorization: `Bearer ${key}`, accept: "application/json" },
      timeoutMs: 5_000,
      maxBytes: 64 * 1024,
      fetch: fetchImpl,
    })
    if (!response.ok) return null
    const body = JSON.parse(response.text) as { data?: { is_free_tier?: unknown } }
    if (typeof body.data?.is_free_tier !== "boolean") return null
    freeTiers.set(hash, body.data.is_free_tier)
    return body.data.is_free_tier
  } catch {
    return null
  }
}

const lists = new Map<string, { at: number; value: Promise<ProviderModelList> }>()

/**
 * Lists a key's models. `cacheKey` identifies the saved key (its row id), so the list is reused
 * for 10 minutes; the key itself is never used as a map key.
 */
export function listProviderModels(input: {
  provider: string
  apiKey: string | null
  baseUrl?: string | null
  cacheKey: string
  force?: boolean
  fetch?: FetchLike
}): Promise<ProviderModelList> {
  const hit = lists.get(input.cacheKey)
  if (hit && !input.force && Date.now() - hit.at < LIST_TTL_MS) return hit.value
  const value = readProviderModels(input).catch((error): ProviderModelList => ({
    models: catalogProviderModels(input.provider),
    source: "catalog",
    error: errorText(error),
  }))
  lists.set(input.cacheKey, { at: Date.now(), value })
  return value
}

async function readProviderModels(input: {
  provider: string
  apiKey: string | null
  baseUrl?: string | null
  fetch?: FetchLike
}): Promise<ProviderModelList> {
  const url = providerModelsUrl(input.provider, input.baseUrl)
  const fallback = (error: string): ProviderModelList => ({
    models: catalogProviderModels(input.provider),
    source: "catalog",
    error,
  })
  if (!url) return fallback("This provider has no model list address")
  const openRouter = input.provider === "openrouter"
  // OpenRouter's list is public; everything else needs the key, which only goes out over HTTPS.
  if (!input.apiKey && !openRouter) return fallback("No key to read the model list with")
  if (input.apiKey && !safeCredentialUrl(url)) {
    return fallback(
      "Sayabot reads a model list only over HTTPS or from this computer, so the key is not sent in the clear",
    )
  }
  const [response, freeTier] = await Promise.all([
    fetchCapped(url, {
      headers: input.apiKey
        ? headersFor(input.provider, input.apiKey)
        : { accept: "application/json" },
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      fetch: input.fetch,
    }),
    openRouter && input.apiKey
      ? openRouterFreeTier(input.apiKey, input.fetch)
      : Promise.resolve(null),
  ])
  if (response.status === 401 || response.status === 403)
    return fallback("The provider refused this key")
  if (!response.ok) return fallback(`The provider answered HTTP ${response.status}`)
  let body: unknown
  try {
    body = JSON.parse(response.text)
  } catch {
    return fallback("The provider sent a model list that is not JSON")
  }
  const rows = rawList(body)
  let models = rows.flatMap((row) => {
    const model = toProviderModel(input.provider, row)
    return model ? [model] : []
  })
  if (!models.length) return fallback("The provider listed no models")
  if (openRouter) {
    // Free tool-capable models first; on a free-tier key in the preferred order.
    const freeTools = models.filter((m) => m.free && m.tools !== false)
    const rank = (m: ProviderModel) => {
      const preferred = OPENROUTER_FREE_PREFERENCE.indexOf(m.id)
      return preferred >= 0 ? preferred : OPENROUTER_FREE_PREFERENCE.length
    }
    freeTools.sort((a, b) => rank(a) - rank(b))
    const byLabel = (a: ProviderModel, b: ProviderModel) => a.label.localeCompare(b.label)
    models = freeTier
      ? [...freeTools, ...models.filter((m) => !freeTools.includes(m)).sort(byLabel)]
      : [...models].sort(byLabel)
  }
  return { models, source: "live", ...(freeTier !== null ? { freeTier } : {}) }
}

export function clearProviderModelCache(): void {
  lists.clear()
}

/**
 * The effort levels a model takes, for clamping a saved level at run time: models.dev's list for
 * the model, else the provider's list for a reasoning model. Undefined when models.dev doesn't
 * know the model, so an unknown model gets the level as saved.
 */
export function modelEffortLevels(
  provider: string,
  model: string,
): readonly EffortLevel[] | undefined {
  const known = findCatalogModel(modelCatalog().get(), provider, model)
  if (!known) return undefined
  if (known.effort) return known.effort
  return known.reasoning ? (ENGINE_EFFORT_LEVELS[provider] ?? ["low", "medium", "high"]) : []
}
