import "server-only"
import { providerKeyToApiKey } from "@sayabot/llm"
import {
  ENGINE_EFFORT_LEVELS,
  engineModelCatalog,
  listProviderModels,
  loadEnginePlanUsage,
  modelCatalog,
  modelManifest,
  type EffortLevel,
  type EngineCatalog,
  type ListPrice,
  type PlanUsage,
  type ProviderModel,
} from "@sayabot/llm/models"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek, sayaAiPublic } from "@/lib/env"
import { effectiveProvider } from "@/lib/format"
import { MODEL_SUGGESTIONS } from "@/lib/model-options"
import type { ProviderKeyView } from "@/lib/types"

/**
 * The model picker's data, built the way OpenMausBot builds it:
 *  - Subscriptions (Claude Code, Codex, Cursor signed in on this computer): each engine's own
 *    model list (Codex asks the CLI; Claude Code and Cursor read the model manifest), with the
 *    plan name and how much of its 5-hour / weekly limits is used.
 *  - API keys: the provider's live `/models` for that key, priced from models.dev.
 *  - Every model carries its list price, context window and the effort levels it takes.
 */

export interface PickerModel {
  id: string
  label: string
  free?: boolean
  /** US dollars per million tokens. */
  price?: ListPrice
  contextWindow?: number
  /** Levels this model takes; undefined means the group's list, [] means Default only. */
  effort?: EffortLevel[]
  defaultEffort?: EffortLevel
  custom?: boolean
  /** The organization behind the subscription does not allow this model. */
  orgBlocked?: boolean
  /** The installed CLI is older than this model needs. */
  needsCliUpdate?: string
}

export type PickerSection = "server" | "subscription" | "key" | "computer"

export interface PickerPlan {
  /** "max", "pro", "plus"…, or null when the vendor did not say. */
  plan: string | null
  windows: Array<{ label: string; usedPercent: number; resetsAt: string | null }>
  error?: string
}

/** One rail entry in the model picker: a provider account (or the server default). */
export interface PickerGroup {
  keyId: string | null
  provider: string
  label: string
  detail: string
  section: PickerSection
  models: PickerModel[]
  /** Effort levels for models that do not list their own. */
  effortLevels: EffortLevel[]
  plan?: PickerPlan
  /** Where the model list came from: "live" (asked the provider/CLI) or a fallback. */
  source?: "live" | "cache" | "manifest" | "catalog" | "static"
  /** Set when the live list could not be read. */
  notice?: string
}

const RUNNER_APPS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  cursor: "Cursor",
}

export interface RunnerHost {
  id: string
  name: string
  runnerEnabled: boolean
  localAgents: Array<{ id: string; status: string }>
}

/** An app signed in on the computer this server runs on (Claude Code, Codex). */
export interface ServerCliApp {
  id: string
  version: string | null
  status: string
  /** Its command-line tool is installed (Cursor the editor alone doesn't count). */
  cli: boolean
  models?: Array<{ id: string; label: string }>
}

const CLI_ENGINES: Record<string, { provider: string; label: string; defaultLabel: string }> = {
  "claude-code": { provider: "anthropic", label: "Claude", defaultLabel: "Claude Code default" },
  codex: { provider: "openai", label: "Codex", defaultLabel: "Codex default (your Codex settings)" },
  cursor: { provider: "cursor", label: "Cursor", defaultLabel: "Cursor default (Auto)" },
}

const PLAN_ENGINES = new Set(["claude-code", "codex"])

function addModel(list: PickerModel[], seen: Set<string>, model: PickerModel) {
  const id = model.id.trim()
  if (!id || seen.has(id)) return
  seen.add(id)
  list.push({ ...model, id })
}

/** Resolves within `ms` with the fallback, so one slow provider never holds up the page. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([promise.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))])
}

function fromEngine(row: EngineCatalog["options"][number]): PickerModel {
  return {
    id: row.id,
    label: row.label,
    ...(row.price ? { price: row.price } : {}),
    ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
    ...(row.defaultEffort ? { defaultEffort: row.defaultEffort } : {}),
    ...(row.custom ? { custom: true } : {}),
    ...(row.orgBlocked ? { orgBlocked: true } : {}),
    ...(row.needsCliUpdate ? { needsCliUpdate: row.needsCliUpdate } : {}),
  }
}

function fromProvider(row: ProviderModel): PickerModel {
  return {
    id: row.id,
    label: row.label,
    ...(row.free ? { free: true } : {}),
    ...(row.price ? { price: row.price } : {}),
    ...(row.contextWindow ? { contextWindow: row.contextWindow } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
  }
}

function planOf(usage: PlanUsage | null): PickerPlan | undefined {
  if (!usage) return undefined
  return { plan: usage.plan, windows: usage.windows, ...(usage.error ? { error: usage.error } : {}) }
}

interface KeySecretRow {
  id: string
  provider: string
  base_url: string | null
  ciphertext: string
  iv: string
  tag: string
}

/** Decrypts each key only to read its model list; the key never leaves this function's request. */
async function keySecrets(orgId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const { data } = await createAdminClient()
    .from("provider_keys")
    .select("id, provider, base_url, ciphertext, iv, tag")
    .eq("org_id", orgId)
  let kek: string
  try {
    kek = getKek()
  } catch {
    return out
  }
  for (const row of (data ?? []) as KeySecretRow[]) {
    try {
      out.set(
        row.id,
        providerKeyToApiKey(
          { provider: row.provider as never, baseUrl: row.base_url, ciphertext: row.ciphertext, iv: row.iv, tag: row.tag },
          kek,
        ),
      )
    } catch {
      // a key sealed with another KEK just gets the models.dev list
    }
  }
  return out
}

export async function buildModelCatalog(
  orgId: string,
  keys: ProviderKeyView[],
  inUse: Array<{ keyId: string | null; model: string | null }>,
  hosts: RunnerHost[] = [],
  serverApps: ServerCliApp[] = [],
): Promise<PickerGroup[]> {
  // Background refreshes: the page uses what is on disk now and the next open sees the update.
  void modelCatalog().refresh()
  void modelManifest().refreshOnDemand()

  const readyApps = serverApps.filter((app) => {
    if (!CLI_ENGINES[app.id]) return false
    return (app.cli && app.status === "ready") || inUse.some((use) => use.keyId === `cli:${app.id}`)
  })
  const [engineLists, plans, secrets] = await Promise.all([
    Promise.all(
      readyApps.map((app) =>
        within(engineModelCatalog(app.id as "claude-code" | "codex" | "cursor"), 8_000, null as EngineCatalog | null),
      ),
    ),
    Promise.all(
      readyApps.map((app) =>
        PLAN_ENGINES.has(app.id) && app.status === "ready"
          ? within(loadEnginePlanUsage(app.id as "claude-code" | "codex"), 9_000, null as PlanUsage | null)
          : Promise.resolve(null),
      ),
    ),
    keys.length ? keySecrets(orgId).catch(() => new Map<string, string>()) : Promise.resolve(new Map<string, string>()),
  ])
  const keyLists = await Promise.all(
    keys.map((key) =>
      within(
        listProviderModels({
          provider: effectiveProvider(key.provider, key.baseUrl),
          apiKey: secrets.get(key.id) ?? null,
          baseUrl: key.baseUrl,
          cacheKey: key.id,
        }),
        10_000,
        null,
      ),
    ),
  )

  const groups: PickerGroup[] = []

  // Saya AI: the server operator's models. Agents store an alias (saya/pro), never the real id, so
  // the operator can change what's behind it in .env and every agent follows on its next turn.
  const saya = sayaAiPublic()
  if (saya) {
    groups.push({
      keyId: null,
      provider: "saya",
      label: saya.name,
      detail: "Provided by this server · no key needed · always up to date",
      section: "server",
      models: [
        { id: "", label: `Automatic · ${saya.defaultLabel}` },
        ...saya.models.map((m) => ({ id: m.value, label: m.label })),
      ],
      effortLevels: ["low", "medium", "high", "max"],
      source: "static",
    })
  }

  // Apps already signed in on this computer: no key, no login, your own subscription.
  readyApps.forEach((app, index) => {
    const spec = CLI_ENGINES[app.id]
    if (!spec) return
    const keyId = `cli:${app.id}`
    const list = engineLists[index]
    const models: PickerModel[] = [{ id: "default", label: spec.defaultLabel }]
    const seen = new Set(models.map((m) => m.id))
    for (const row of list?.options ?? []) addModel(models, seen, fromEngine(row))
    for (const m of app.models ?? []) addModel(models, seen, { id: m.id, label: m.label })
    for (const use of inUse) {
      if (use.keyId === keyId && use.model) addModel(models, seen, { id: use.model, label: use.model })
    }
    const plan = planOf(plans[index] ?? null)
    groups.push({
      keyId,
      provider: spec.provider,
      label: spec.label,
      detail:
        app.status === "ready"
          ? `${app.version ? `${app.version} · ` : ""}${RUNNER_APPS[app.id]} on this computer · your subscription`
          : `${RUNNER_APPS[app.id]} isn't signed in right now. Run it once in a terminal and sign in.`,
      section: "subscription",
      models,
      effortLevels: [...(list?.effortLevels ?? ENGINE_EFFORT_LEVELS[app.id] ?? [])],
      ...(plan ? { plan } : {}),
      source: list?.source ?? "static",
    })
  })

  keys.forEach((key, index) => {
    const provider = effectiveProvider(key.provider, key.baseUrl)
    const list = keyLists[index]
    const models: PickerModel[] = []
    const seen = new Set<string>()
    for (const row of list?.models ?? []) addModel(models, seen, fromProvider(row))
    if (!models.length) {
      for (const id of MODEL_SUGGESTIONS[provider] ?? []) addModel(models, seen, { id, label: id, free: id.endsWith(":free") })
    }
    for (const use of inUse) {
      if (use.keyId === key.id && use.model) addModel(models, seen, { id: use.model, label: use.model })
    }
    const freeTier = list?.freeTier ? " · free tier" : ""
    groups.push({
      keyId: key.id,
      provider,
      label: key.label || provider,
      detail: `${provider} · •••• ${key.last4}${freeTier}`,
      section: "key",
      models,
      effortLevels: [...(ENGINE_EFFORT_LEVELS[provider] ?? ["low", "medium", "high"])],
      source: list?.source ?? "static",
      ...(list?.error ? { notice: `Showing the models.dev list: ${list.error}` } : {}),
    })
  })

  // "Run on my computer": apps signed in on this person's own Macs, on their own subscription.
  for (const host of hosts) {
    const models: PickerModel[] = host.localAgents
      .filter((a) => RUNNER_APPS[a.id] && a.status === "ready")
      .map((a) => ({ id: a.id, label: `${RUNNER_APPS[a.id]} · your subscription` }))
    for (const use of inUse) {
      if (use.keyId === `host:${host.id}` && use.model && !models.some((m) => m.id === use.model)) {
        models.push({ id: use.model, label: `${RUNNER_APPS[use.model] ?? use.model} (not signed in right now)` })
      }
    }
    groups.push({
      keyId: `host:${host.id}`,
      provider: "computer",
      label: host.name,
      detail: host.runnerEnabled
        ? "Runs on this computer with the apps signed in there"
        : "Turn on “Run agents on this computer” in Settings → Computers first",
      section: "computer",
      models,
      effortLevels: [],
      source: "static",
    })
  }
  return groups
}
