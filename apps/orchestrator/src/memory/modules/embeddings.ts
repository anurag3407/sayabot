import { and, eq, sql } from "drizzle-orm"
import { redactSecrets } from "@sayabot/core"
import { vectorProviders, type Db } from "@sayabot/db"
import { decryptSecret } from "@sayabot/llm"
import { getEnv } from "../../env"

/**
 * Embedding providers for semantic memory recall, configured per org in
 * Settings -> Vector (`vector_providers`, kind = 'embedding'). Keys are sealed with the
 * KEK and only decrypted here, in-process; they are never logged or returned.
 */

export type EmbedPurpose = "document" | "query"

export interface Embedder {
  provider: string
  model: string
  /** `${provider}:${model}`, stored on each row so a provider switch never mixes vectors. */
  modelKey: string
  /** Cosine similarity at or below which the model's vectors carry no topical signal. */
  simFloor: number
  embed(texts: string[], purpose: EmbedPurpose): Promise<number[][]>
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

interface ProviderDefaults {
  model: string
  simFloor: number
}

const DEFAULTS: Record<string, ProviderDefaults> = {
  openai: { model: "text-embedding-3-small", simFloor: 0.2 },
  voyage: { model: "voyage-3", simFloor: 0.3 },
  google_gemini: { model: "text-embedding-004", simFloor: 0.45 },
}

export const SUPPORTED_EMBEDDING_PROVIDERS = Object.keys(DEFAULTS)

const MAX_INPUT_CHARS = 2000
const BATCH_SIZE = 32
const TIMEOUT_MS = 10_000

export function embeddingText(title: string, body: string): string {
  return `${title}\n${body}`.slice(0, MAX_INPUT_CHARS)
}

export function createEmbedder(
  config: {
    provider: string
    apiKey: string
    endpointUrl?: string | null
    model?: string | null
    simFloor?: number | null
  },
  fetchImpl: FetchLike = fetch,
): Embedder | null {
  const defaults = DEFAULTS[config.provider]
  if (!defaults) return null
  const model = config.model?.trim() || defaults.model
  const simFloor =
    typeof config.simFloor === "number" && Number.isFinite(config.simFloor)
      ? config.simFloor
      : defaults.simFloor

  const post = async (url: string, headers: Record<string, string>, body: unknown) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      const detail = redactSecrets((await res.text().catch(() => "")).slice(0, 200)).text
      throw new Error(`${config.provider} embeddings failed (${res.status}): ${detail}`)
    }
    return (await res.json()) as unknown
  }

  const embedBatch = async (texts: string[], purpose: EmbedPurpose): Promise<number[][]> => {
    if (config.provider === "google_gemini") {
      const json = await post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:batchEmbedContents`,
        { "x-goog-api-key": config.apiKey },
        {
          requests: texts.map((text) => ({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            taskType: purpose === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT",
          })),
        },
      )
      const embeddings = (json as { embeddings?: Array<{ values?: number[] }> }).embeddings ?? []
      return embeddings.map((e) => e.values ?? [])
    }

    const url =
      config.provider === "voyage"
        ? "https://api.voyageai.com/v1/embeddings"
        : safeOpenAiEndpoint(config.endpointUrl)
    const json = await post(
      url,
      { Authorization: `Bearer ${config.apiKey}` },
      config.provider === "voyage"
        ? { input: texts, model, input_type: purpose }
        : { input: texts, model },
    )
    const data = (json as { data?: Array<{ embedding?: number[]; index?: number }> }).data ?? []
    return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((d) => d.embedding ?? [])
  }

  return {
    provider: config.provider,
    model,
    modelKey: `${config.provider}:${model}`,
    simFloor,
    async embed(texts, purpose) {
      const out: number[][] = []
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, MAX_INPUT_CHARS))
        const vectors = await embedBatch(batch, purpose)
        if (vectors.length !== batch.length || vectors.some((v) => v.length === 0)) {
          throw new Error(
            `${config.provider} returned ${vectors.length} embeddings for ${batch.length} inputs`,
          )
        }
        out.push(...vectors)
      }
      return out
    },
  }
}

/** Only an https endpoint ending in /embeddings may replace the OpenAI default. */
function safeOpenAiEndpoint(endpointUrl?: string | null): string {
  if (endpointUrl && /^https:\/\/[^\s]+\/embeddings$/.test(endpointUrl)) return endpointUrl
  return "https://api.openai.com/v1/embeddings"
}

const CACHE_TTL_MS = 60_000
const embedderCache = new Map<string, { at: number; embedder: Embedder | null }>()

/** The org's active embedding provider, or null when none is configured or supported. */
export async function getOrgEmbedder(db: Db, orgId: string): Promise<Embedder | null> {
  const cached = embedderCache.get(orgId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.embedder

  let embedder: Embedder | null = null
  try {
    const [row] = await db
      .select()
      .from(vectorProviders)
      .where(
        and(
          eq(vectorProviders.orgId, orgId),
          eq(vectorProviders.kind, "embedding"),
          eq(vectorProviders.isActive, true),
        ),
      )
      .limit(1)
    if (row && DEFAULTS[row.provider]) {
      const apiKey = decryptSecret(
        { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag },
        getEnv().MESH_KEK,
      )
      const config = (row.config ?? {}) as { model?: unknown; simFloor?: unknown }
      embedder = createEmbedder({
        provider: row.provider,
        apiKey,
        endpointUrl: row.endpointUrl,
        model: typeof config.model === "string" ? config.model : null,
        simFloor: typeof config.simFloor === "number" ? config.simFloor : null,
      })
    }
  } catch (error) {
    console.warn("[memory] embedding provider unavailable:", redactSecrets(String(error)).text)
    embedder = null
  }
  embedderCache.set(orgId, { at: Date.now(), embedder })
  return embedder
}

export function clearEmbedderCache(): void {
  embedderCache.clear()
}

const PGVECTOR_TTL_MS = 10 * 60_000
let pgvectorState: { at: number; available: boolean } | null = null

/** Whether the pgvector extension is installed, re-checked every 10 minutes. */
export async function hasPgvector(db: Db): Promise<boolean> {
  if (pgvectorState && Date.now() - pgvectorState.at < PGVECTOR_TTL_MS)
    return pgvectorState.available
  let available = false
  try {
    const result = await db.execute(sql`select 1 as ok from pg_extension where extname = 'vector'`)
    available = result.rows.length > 0
  } catch {
    available = false
  }
  pgvectorState = { at: Date.now(), available }
  return available
}

export function markPgvectorUnavailable(): void {
  pgvectorState = { at: Date.now(), available: false }
}

export function resetPgvectorState(): void {
  pgvectorState = null
}

/** pgvector text literal: `[0.1,0.2,...]`. */
export function toVectorLiteral(values: readonly number[]): string {
  return `[${values.map((v) => (Number.isFinite(v) ? v : 0)).join(",")}]`
}
