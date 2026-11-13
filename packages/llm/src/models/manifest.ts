import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { errorText, fetchCapped, providersCacheDir, type FetchLike } from "./http"
import { writeJsonAtomic, type ListPrice } from "./models-dev"
import bundledManifest from "./model-manifest.json"

/**
 * Sayabot's own model list for the subscription engines (Claude Code, Codex, Cursor): which
 * models each offers, the oldest CLI that can run each, and list prices that win over models.dev.
 * Claude Code has no "list models" command, so this file is where its picker comes from.
 *
 * Maintenance: edit src/models/model-manifest.json, bump `updatedAt`, merge to main. Every running
 * server picks it up within an hour (5 minutes after someone opens the picker) from
 * SAYABOT_MODEL_MANIFEST_URL, which defaults to that file on GitHub. A copy older than the one
 * bundled in this build is ignored, so a release can correct a model before the next fetch.
 */

export const MODEL_MANIFEST_URL =
  "https://raw.githubusercontent.com/anurag3407/sayabot/main/packages/llm/src/models/model-manifest.json"
export const MANIFEST_URL_ENV = "SAYABOT_MODEL_MANIFEST_URL"
export const MANIFEST_DISABLE_ENV = "SAYABOT_DISABLE_MODEL_MANIFEST_FETCH"
export const MANIFEST_TTL_MS = 60 * 60 * 1000
/** GitHub's raw CDN caches about this long, so a shorter window buys nothing. */
export const MANIFEST_ON_DEMAND_TTL_MS = 5 * 60 * 1000
/** Back off failed fetches so an offline server does not try on every picker open. */
export const MANIFEST_RETRY_MS = 5 * 60 * 1000
export const MANIFEST_FETCH_TIMEOUT_MS = 10_000
export const MANIFEST_MAX_BYTES = 512 * 1024

export const MANIFEST_ENGINES = ["claude-code", "codex", "cursor"] as const
export type ManifestEngine = (typeof MANIFEST_ENGINES)[number]

// Claude Code's `[1m]` suffix selects a model's 1M-token context. A model id reaches a command
// line, so each engine keeps a strict rule and a download must pass the same one.
const ENGINE_MODEL_ID: Record<ManifestEngine, RegExp> = {
  "claude-code": /^[a-z0-9][a-z0-9._:/-]*(?:\[1m\])?$/i,
  codex: /^[a-z0-9][a-z0-9._:+-]*$/i,
  cursor: /^[a-z0-9][a-z0-9._:+-]*$/i,
}
const CLI_VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/
const PRICE_KEY = /^[a-z0-9][a-z0-9._:/+-]*$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u
/** Allows for a slow local clock; a date past it would pin every install to that copy. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

const label = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "control characters")

const pricePeriod = {
  inputPerMillion: z.number().min(0).max(100_000),
  cachedInputPerMillion: z.number().min(0).max(100_000).optional(),
  outputPerMillion: z.number().min(0).max(100_000),
}

function modelId(engine: ManifestEngine) {
  return z
    .string()
    .max(160)
    .regex(ENGINE_MODEL_ID[engine])
    .refine((id) => id !== "default", "reserved id")
}

function engineSchema(engine: ManifestEngine) {
  return z
    .object({
      default: modelId(engine),
      models: z
        .array(
          z.object({
            id: modelId(engine),
            name: label(120),
            aliases: z.array(modelId(engine)).max(20).optional(),
            status: z.enum(["current", "legacy"]),
            contextWindow: z.number().int().positive().max(100_000_000).optional(),
            minCliVersion: z.string().regex(CLI_VERSION).optional(),
          }),
        )
        .min(1)
        .max(200),
    })
    .superRefine((catalog, context) => {
      const names = new Set<string>()
      for (const entry of catalog.models) {
        for (const name of [entry.id, ...(entry.aliases ?? [])]) {
          if (names.has(name))
            context.addIssue({ code: "custom", message: `${engine}: ${name} is listed twice` })
          names.add(name)
        }
      }
      const chosen = catalog.models.find((entry) => entry.id === catalog.default)
      if (chosen?.status !== "current") {
        context.addIssue({
          code: "custom",
          message: `${engine}: the default must be a current model`,
        })
      }
    })
}

const priceEntry = z
  .object({
    ...pricePeriod,
    asOf: z.string().regex(DAY),
    source: z
      .string()
      .max(300)
      .regex(/^https:\/\//),
    changes: z
      .array(z.object({ from: z.string().regex(DAY), ...pricePeriod }))
      .max(40)
      .optional(),
  })
  .refine(
    (entry) =>
      entry.changes === undefined ||
      entry.changes.every((c, i, all) => i === 0 || (all[i - 1]?.from ?? "") < c.from),
    "price changes must be in date order",
  )

function manifestSchema(nowMs: number) {
  return z.object({
    version: z.literal(1),
    updatedAt: z.iso
      .datetime({ offset: true })
      .refine(
        (value) => Date.parse(value) <= nowMs + FUTURE_TOLERANCE_MS,
        "updatedAt is in the future",
      ),
    engines: z.object({
      "claude-code": engineSchema("claude-code"),
      codex: engineSchema("codex").optional(),
      cursor: engineSchema("cursor").optional(),
    }),
    prices: z.record(z.string().max(160).regex(PRICE_KEY), priceEntry).optional(),
  })
}

export type ModelManifest = z.infer<ReturnType<typeof manifestSchema>>
export type ManifestModel = NonNullable<ModelManifest["engines"][ManifestEngine]>["models"][number]

export function parseModelManifest(
  value: unknown,
  options: { nowMs?: number } = {},
): { ok: true; manifest: ModelManifest } | { ok: false; error: string } {
  const parsed = manifestSchema(options.nowMs ?? Date.now()).safeParse(value)
  if (parsed.success) return { ok: true, manifest: parsed.data }
  const issue = parsed.error.issues[0]
  return {
    ok: false,
    error: `${issue?.path.join(".") || "manifest"}: ${issue?.message ?? "invalid"}`,
  }
}

function loadBundled(): ModelManifest {
  const parsed = parseModelManifest(bundledManifest, { nowMs: Number.MAX_SAFE_INTEGER / 2 })
  if (!parsed.ok) throw new Error(`The bundled model-manifest.json is invalid (${parsed.error})`)
  return parsed.manifest
}

export const BUNDLED_MODEL_MANIFEST: ModelManifest = loadBundled()

export function modelManifestCachePath(env: NodeJS.ProcessEnv = process.env): string {
  return join(providersCacheDir(env), "model-manifest", "model-manifest.json")
}

const updatedAtMs = (manifest: ModelManifest) => Date.parse(manifest.updatedAt)

export interface ModelManifestStoreOptions {
  env?: NodeJS.ProcessEnv
  fetch?: FetchLike
  now?: () => number
  log?: (line: string) => void
  bundled?: ModelManifest
  timeoutMs?: number
}

export class ModelManifestStore {
  private manifest: ModelManifest
  private readonly bundled: ModelManifest
  private fetchedAtMs: number | null = null
  private lastAttemptMs: number | null = null
  private diskChecked = false
  private inflight: Promise<ModelManifest> | undefined
  readonly cachePath: string

  constructor(private readonly options: ModelManifestStoreOptions = {}) {
    this.bundled = options.bundled ?? BUNDLED_MODEL_MANIFEST
    this.manifest = this.bundled
    this.cachePath = modelManifestCachePath(options.env)
  }

  private get env(): NodeJS.ProcessEnv {
    return this.options.env ?? process.env
  }

  private get now(): number {
    return (this.options.now ?? Date.now)()
  }

  private log(line: string): void {
    ;(this.options.log ?? ((l: string) => console.warn(l)))(`[model-manifest] ${line}`)
  }

  private get url(): string {
    return this.env[MANIFEST_URL_ENV]?.trim() || MODEL_MANIFEST_URL
  }

  get fetchDisabled(): boolean {
    return this.env[MANIFEST_DISABLE_ENV] === "1"
  }

  /** The newest usable manifest. Reads the disk cache once and never waits on the network. */
  current(): ModelManifest {
    if (!this.diskChecked) this.loadDiskCache()
    return this.manifest
  }

  /** Skipped inside `ttlMs` of the last good fetch and for a while after a failed one, unless `force`. Never throws. */
  refresh(options: { force?: boolean; ttlMs?: number } = {}): Promise<ModelManifest> {
    if (this.fetchDisabled) return Promise.resolve(this.current())
    this.inflight ??= this.fetchAndStore(
      Boolean(options.force),
      options.ttlMs ?? MANIFEST_TTL_MS,
    ).finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  /** For someone opening the picker: tolerates far less staleness than the background refresh. */
  refreshOnDemand(): Promise<ModelManifest> {
    return this.refresh({ ttlMs: MANIFEST_ON_DEMAND_TTL_MS })
  }

  private loadDiskCache(): void {
    this.diskChecked = true
    try {
      if (!existsSync(this.cachePath) || statSync(this.cachePath).size > MANIFEST_MAX_BYTES * 2)
        return
      const raw = JSON.parse(readFileSync(this.cachePath, "utf8")) as {
        fetchedAtMs?: unknown
        manifest?: unknown
      }
      const parsed = parseModelManifest(raw.manifest, { nowMs: this.now })
      if (!parsed.ok) {
        this.log(`ignoring the cached manifest (${parsed.error})`)
        return
      }
      if (updatedAtMs(this.bundled) > updatedAtMs(parsed.manifest)) return
      this.manifest = parsed.manifest
      this.fetchedAtMs =
        typeof raw.fetchedAtMs === "number" && Number.isFinite(raw.fetchedAtMs)
          ? raw.fetchedAtMs
          : null
    } catch (error) {
      this.log(`could not read the cached manifest (${errorText(error)})`)
    }
  }

  private async fetchAndStore(force: boolean, ttlMs: number): Promise<ModelManifest> {
    this.current()
    const now = this.now
    // Timestamps from the future (clock rollback) count as expired.
    const within = (since: number | null, windowMs: number) =>
      since !== null && now >= since && now - since < windowMs
    if (!force && within(this.fetchedAtMs, ttlMs)) return this.manifest
    if (!force && within(this.lastAttemptMs, MANIFEST_RETRY_MS)) return this.manifest
    this.lastAttemptMs = now
    let fetched: ModelManifest
    try {
      const response = await fetchCapped(this.url, {
        headers: { accept: "application/json" },
        timeoutMs: this.options.timeoutMs ?? MANIFEST_FETCH_TIMEOUT_MS,
        maxBytes: MANIFEST_MAX_BYTES,
        fetch: this.options.fetch,
      })
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`)
      let json: unknown
      try {
        json = JSON.parse(response.text)
      } catch {
        throw new Error("not valid JSON")
      }
      const parsed = parseModelManifest(json, { nowMs: now })
      if (!parsed.ok) throw new Error(parsed.error)
      fetched = parsed.manifest
    } catch (error) {
      this.log(`could not refresh the model list (${errorText(error)}); keeping the current one`)
      return this.manifest
    }
    // A stale CDN copy loses to what we have, so it cannot bring back a model a newer copy removed.
    if (updatedAtMs(fetched) < updatedAtMs(this.manifest)) return this.manifest
    this.manifest = fetched
    this.fetchedAtMs = now
    this.lastAttemptMs = null
    try {
      writeJsonAtomic(this.cachePath, { fetchedAtMs: now, manifest: fetched })
    } catch (error) {
      this.log(`could not save the downloaded model list (${errorText(error)})`)
    }
    return this.manifest
  }
}

let store: ModelManifestStore | undefined

export function modelManifest(): ModelManifestStore {
  return (store ??= new ModelManifestStore())
}

/** Parses "2.1.321" (or "claude 2.1.321 (Claude Code)") into a comparable triple. */
export function parseVersionTriple(
  value: string | null | undefined,
): [number, number, number] | null {
  const match = value?.match(/(\d+)\.(\d+)\.(\d+)/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function versionAtLeast(
  version: [number, number, number],
  floor: [number, number, number],
): boolean {
  for (let i = 0; i < 3; i++) {
    const a = version[i] ?? 0
    const b = floor[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

/** The manifest's list price for a model (or one of its aliases) on a given day. */
export function manifestPrice(
  model: string,
  manifest: ModelManifest = modelManifest().current(),
  at: Date = new Date(),
): ListPrice | null {
  const prices = manifest.prices ?? BUNDLED_MODEL_MANIFEST.prices ?? {}
  const key = model.trim().toLowerCase()
  let entry = prices[key]
  if (!entry) {
    for (const engine of Object.values(manifest.engines)) {
      const hit = engine?.models.find((m) =>
        m.aliases?.some((alias) => alias.toLowerCase() === key),
      )
      if (hit && prices[hit.id]) {
        entry = prices[hit.id]
        break
      }
    }
  }
  if (!entry) return null
  const day = at.toISOString().slice(0, 10)
  const change = entry.changes?.filter((candidate) => candidate.from <= day).at(-1)
  const current = change ?? entry
  return {
    inputPerMillion: current.inputPerMillion,
    outputPerMillion: current.outputPerMillion,
    ...(current.cachedInputPerMillion !== undefined
      ? { cachedInputPerMillion: current.cachedInputPerMillion }
      : {}),
  }
}
