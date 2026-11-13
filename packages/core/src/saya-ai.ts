/**
 * Saya AI: the model provider the server operator runs for everyone on this Sayabot.
 *
 * Agents never store a real model id for it, only a stable alias such as `saya/pro`. The alias is
 * resolved against the server's environment on every turn, so changing the endpoint, key or the
 * model behind an alias in `.env` switches every agent, in the web app, the phone app and the Mac
 * app, without anyone picking a model again or updating an app.
 *
 *   SAYA_AI_BASE_URL=https://llm.example.com/v1
 *   SAYA_AI_API_KEY=sk-...
 *   SAYA_AI_MODELS=pro=gpt-5.1|Saya Pro,fast=gpt-5.1-mini|Saya Fast
 *   SAYA_AI_DEFAULT=pro          # what "Automatic" and new agents use (default: first model)
 *   SAYA_AI_FAST=fast            # background work: titles, memory, summaries (default: default)
 *   SAYA_AI_PROTOCOL=openai-compatible   # or openai | anthropic
 *   SAYA_AI_NAME=Saya AI
 *
 * `SAYA_AI_MODEL=gpt-5.1` is shorthand for a single model with the alias `default`. Without any
 * SAYA_AI_* values the older DEV_OPENAI_COMPAT_* shared model is used, so existing servers keep working.
 */

export const SAYA_MODEL_PREFIX = "saya/"

export type SayaProtocol = "openai-compatible" | "openai" | "anthropic"

export interface SayaModel {
  /** Stable name agents store (as `saya/<alias>`). */
  alias: string
  /** The real model id sent to the endpoint. Changing it in .env is invisible to users. */
  id: string
  label: string
}

export interface SayaAiConfig {
  name: string
  protocol: SayaProtocol
  baseUrl: string
  apiKey: string
  models: SayaModel[]
  defaultAlias: string
  fastAlias: string
}

/** Public view: what browsers and phones may see. No key, no endpoint, no real model ids. */
export interface SayaAiPublic {
  name: string
  models: Array<{ value: string; label: string }>
  defaultLabel: string
}

const ALIAS_RE = /^[a-z0-9][a-z0-9._-]{0,39}$/
const PROTOCOLS = new Set<SayaProtocol>(["openai-compatible", "openai", "anthropic"])

type Env = Record<string, string | undefined>

function clean(value: string | undefined): string {
  return (value ?? "").trim()
}

function titleCase(alias: string): string {
  return alias.replace(/[-_.]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * "pro=gpt-5.1|Saya Pro, fast=gpt-5.1-mini" → models. Entries without "alias=" use the model id
 * as the alias (lowercased). Bad or duplicate aliases are skipped rather than failing the server.
 */
export function parseSayaModels(raw: string, name = "Saya AI"): SayaModel[] {
  const out: SayaModel[] = []
  const seen = new Set<string>()
  for (const part of raw.split(/[,\n]/)) {
    const entry = part.trim()
    if (!entry) continue
    const eq = entry.indexOf("=")
    const left = eq > 0 ? entry.slice(0, eq).trim() : ""
    const rest = eq > 0 ? entry.slice(eq + 1) : entry
    const [idPart, ...labelParts] = rest.split("|")
    const id = clean(idPart)
    if (!id) continue
    const alias = (left || id)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
    if (!ALIAS_RE.test(alias) || seen.has(alias)) continue
    seen.add(alias)
    const label = clean(labelParts.join("|")) || (left ? `${name} ${titleCase(alias)}` : id)
    out.push({ alias, id, label })
  }
  return out
}

/** The operator's Saya AI settings, or null when the server has none. Server-side only. */
export function readSayaAiConfig(env: Env): SayaAiConfig | null {
  const name = clean(env.SAYA_AI_NAME) || "Saya AI"
  let baseUrl = clean(env.SAYA_AI_BASE_URL)
  let apiKey = clean(env.SAYA_AI_API_KEY)
  let modelsRaw =
    clean(env.SAYA_AI_MODELS) ||
    (clean(env.SAYA_AI_MODEL) ? `default=${clean(env.SAYA_AI_MODEL)}` : "")
  if (!baseUrl) {
    // Older servers: the single shared model becomes Saya AI's only model.
    baseUrl = clean(env.DEV_OPENAI_COMPAT_BASE_URL)
    apiKey = apiKey || clean(env.DEV_OPENAI_COMPAT_API_KEY)
    // Its own model wins: SAYA_AI_MODELS belongs to an endpoint that isn't configured.
    if (clean(env.DEV_OPENAI_COMPAT_MODEL))
      modelsRaw = `default=${clean(env.DEV_OPENAI_COMPAT_MODEL)}`
  }
  if (!baseUrl || !modelsRaw) return null
  const models = parseSayaModels(modelsRaw, name)
  if (!models.length) return null
  // Single-model shorthand gets the provider name as its label.
  if (models.length === 1 && models[0]?.alias === "default" && !/\|/.test(modelsRaw)) {
    models[0] = { ...models[0], label: name }
  }
  const protocolRaw = clean(env.SAYA_AI_PROTOCOL).toLowerCase() as SayaProtocol
  const protocol: SayaProtocol = PROTOCOLS.has(protocolRaw) ? protocolRaw : "openai-compatible"
  const has = (alias: string) => models.some((m) => m.alias === alias)
  const wantedDefault = clean(env.SAYA_AI_DEFAULT).toLowerCase()
  const defaultAlias = has(wantedDefault) ? wantedDefault : (models[0] as SayaModel).alias
  const wantedFast = clean(env.SAYA_AI_FAST).toLowerCase()
  const fastAlias = has(wantedFast) ? wantedFast : has("fast") ? "fast" : defaultAlias
  return {
    name,
    protocol,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    models,
    defaultAlias,
    fastAlias,
  }
}

export function isSayaModel(model: string | null | undefined): boolean {
  return typeof model === "string" && model.startsWith(SAYA_MODEL_PREFIX)
}

export function sayaModelValue(alias: string): string {
  return `${SAYA_MODEL_PREFIX}${alias}`
}

/**
 * What an agent's stored value means right now. `saya/<alias>` → that alias; null or an alias the
 * operator has since removed → the current default, so a config change never breaks an agent.
 */
export function resolveSayaModel(
  config: SayaAiConfig,
  stored: string | null | undefined,
): SayaModel {
  const alias = isSayaModel(stored) ? (stored as string).slice(SAYA_MODEL_PREFIX.length) : ""
  return (
    config.models.find((m) => m.alias === alias) ??
    config.models.find((m) => m.alias === config.defaultAlias) ??
    (config.models[0] as SayaModel)
  )
}

export function resolveSayaFastModel(config: SayaAiConfig): SayaModel {
  return resolveSayaModel(config, sayaModelValue(config.fastAlias))
}

/** "Saya Pro", or "Saya AI · Automatic (Saya Pro)" for agents that follow the default. */
export function sayaModelLabel(config: SayaAiConfig, stored: string | null | undefined): string {
  const model = resolveSayaModel(config, stored)
  const explicit =
    isSayaModel(stored) && config.models.some((m) => sayaModelValue(m.alias) === stored)
  return explicit ? model.label : `${config.name} · Automatic (${model.label})`
}

export function publicSayaAi(config: SayaAiConfig): SayaAiPublic {
  return {
    name: config.name,
    models: config.models.map((m) => ({ value: sayaModelValue(m.alias), label: m.label })),
    defaultLabel: resolveSayaModel(config, null).label,
  }
}

/** sayaModelLabel for clients that only have the public view. */
export function sayaPublicLabel(view: SayaAiPublic, stored: string | null | undefined): string {
  const hit = view.models.find((m) => m.value === stored)
  return hit ? hit.label : `${view.name} · Automatic (${view.defaultLabel})`
}

/** One line describing an agent's model for people (lists, profiles). */
export function agentModelText(
  agent: { kind?: string | null; model: string | null; providerKeyId?: string | null },
  saya: SayaAiPublic | null,
): string {
  if (agent.kind === "external") return "external agent"
  if (!agent.providerKeyId && saya) return sayaPublicLabel(saya, agent.model)
  return agent.model ?? (agent.providerKeyId ? "default model" : "no model yet")
}
