import "server-only"
import { MAC_CLI_APPS } from "@sayabot/core"
import { providerKeyToApiKey } from "@sayabot/llm"
import {
  ENGINE_EFFORT_LEVELS,
  engineCatalogFromManifest,
  engineModelCatalog,
  isEffortLevel,
  listProviderModels,
  loadEnginePlanUsage,
  modelCatalog,
  modelListings,
  modelManifest,
  type EffortLevel,
  type EngineCatalog,
  type ListPrice,
  type ModelListing,
  type PlanUsage,
  type ProviderModel,
} from "@sayabot/llm/models"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek, sayaAiPublic } from "@/lib/env"
import { effectiveProvider } from "@/lib/format"
import { isOrgAdmin } from "@/lib/auth"
import { detectLocalAgents, localDetectionAllowed } from "@/lib/local-agents"
import { MODEL_SUGGESTIONS } from "@/lib/model-options"
import { listOrgAgents, listProviderKeys } from "@/lib/queries"
import type { AgentView, OrgAccess, ProviderKeyView } from "@/lib/types"

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
  /** `new`: out this week. `older`: a newer model replaces it, so the picker folds it away. */
  listing?: ModelListing
  /** `YYYY-MM-DD`, from models.dev. */
  releaseDate?: string
}

/**
 * Rail sections: the server's own models, apps signed in on the server, saved API keys, apps
 * signed in on the person's own Macs, models served on their Macs (Ollama, LM Studio), and a Mac
 * with nothing to offer yet.
 */
export type PickerSection = "server" | "subscription" | "key" | "mac" | "local" | "computer"

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
  /** Mac groups only: whether "Run agents on this computer" is on. */
  runnerEnabled?: boolean
  /** Who the app is signed in as, when it says ("you@example.com · Org"). */
  account?: string
  /** The app's version, shown as a badge. */
  version?: string
  /** Mac, local and computer groups: which of the person's computers it is on. */
  hostId?: string
  hostName?: string
}

const RUNNER_APPS: Record<string, string> = Object.fromEntries(
  MAC_CLI_APPS.map((app) => [app.id, app.name]),
)

/** A model an app on someone's Mac listed (see the desktop heartbeat). */
export interface ReportedModel {
  id: string
  label: string
  effort?: string[]
  defaultEffort?: string
  isDefault?: boolean
}

export interface RunnerHost {
  id: string
  name: string
  runnerEnabled: boolean
  localAgents: Array<{
    id: string
    status: string
    version?: string | null
    account?: string
    models?: ReportedModel[]
  }>
}

/**
 * Apps on a Mac and the model provider each one stands for in the picker (MAC_CLI_APPS in
 * @sayabot/core). Apps that don't report their models fall back to Sayabot's list for the engine.
 */
const MAC_APP_FALLBACK: Record<
  string,
  { engine?: "claude-code" | "codex" | "cursor"; suggestions?: string }
> = {
  "claude-code": { engine: "claude-code" },
  codex: { engine: "codex" },
  gemini: { suggestions: "google" },
  cursor: { engine: "cursor" },
}
const MAC_APPS: Record<
  string,
  {
    provider: string
    label: string
    engine?: "claude-code" | "codex" | "cursor"
    suggestions?: string
  }
> = Object.fromEntries(
  MAC_CLI_APPS.map((app) => [
    app.id,
    { provider: app.provider, label: app.label, ...MAC_APP_FALLBACK[app.id] },
  ]),
)
const LOCAL_MODEL_APPS: Record<string, { provider: string; label: string }> = {
  ollama: { provider: "ollama", label: "Ollama" },
  lmstudio: { provider: "lmstudio", label: "LM Studio" },
}

/** Picker key for an app on a Mac: `host:<hostId>:<app>`. */
export function macKeyId(hostId: string, app: string): string {
  return `host:${hostId}:${app}`
}

/** `host:<id>:<app>` (or the older `host:<id>`, whose model was the app) back into its parts. */
export function parseMacKeyId(keyId: string): { hostId: string; app: string | null } | null {
  const match = /^host:([0-9a-f-]{36})(?::([a-z-]{1,20}))?$/i.exec(keyId)
  return match?.[1] ? { hostId: match[1], app: match[2] ?? null } : null
}

function effortList(values: string[] | undefined): EffortLevel[] {
  return (values ?? []).filter(isEffortLevel)
}

/** One Mac app's models: what the app listed itself, else Sayabot's list for its version. */
function macAppModels(
  app: string,
  reported: ReportedModel[] | undefined,
  version: string | null,
): { models: PickerModel[]; effortLevels: EffortLevel[]; source: PickerGroup["source"] } {
  const spec = MAC_APPS[app]
  const engineLevels = [...(ENGINE_EFFORT_LEVELS[app] ?? [])]
  const fromApp = (reported ?? []).map((m) => ({
    id: m.id,
    label: m.label,
    ...(m.effort ? { effort: effortList(m.effort) } : {}),
    ...(m.defaultEffort && isEffortLevel(m.defaultEffort)
      ? { defaultEffort: m.defaultEffort }
      : {}),
  }))
  const defaultModel = reported?.find((m) => m.isDefault)
  const defaultRow: PickerModel = {
    id: "default",
    label: defaultModel
      ? `${spec?.label ?? app} default · ${defaultModel.label}`
      : `${spec?.label ?? app} default`,
  }
  if (fromApp.length) {
    // Apps Sayabot has no effort list for (OpenCode, Copilot…) say which levels their models take.
    const reportedLevels = engineLevels.length
      ? engineLevels
      : effortList([...new Set(fromApp.flatMap((m) => m.effort ?? []))])
    return { models: [defaultRow, ...fromApp], effortLevels: reportedLevels, source: "live" }
  }
  if (spec?.engine) {
    const listed = engineCatalogFromManifest(spec.engine, version)
    return {
      models: [defaultRow, ...listed.options.map(fromEngine)],
      effortLevels: [...listed.effortLevels],
      source: "manifest",
    }
  }
  const suggested = spec?.suggestions ? (MODEL_SUGGESTIONS[spec.suggestions] ?? []) : []
  return {
    models: [defaultRow, ...suggested.map((id) => ({ id, label: id }))],
    effortLevels: engineLevels,
    source: "static",
  }
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
  codex: {
    provider: "openai",
    label: "Codex",
    defaultLabel: "Codex default (your Codex settings)",
  },
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
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
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
  return {
    plan: usage.plan,
    windows: usage.windows,
    ...(usage.error ? { error: usage.error } : {}),
  }
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
          {
            provider: row.provider as never,
            baseUrl: row.base_url,
            ciphertext: row.ciphertext,
            iv: row.iv,
            tag: row.tag,
          },
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
        within(
          engineModelCatalog(app.id as "claude-code" | "codex" | "cursor"),
          8_000,
          null as EngineCatalog | null,
        ),
      ),
    ),
    Promise.all(
      readyApps.map((app) =>
        PLAN_ENGINES.has(app.id) && app.status === "ready"
          ? within(
              loadEnginePlanUsage(app.id as "claude-code" | "codex"),
              9_000,
              null as PlanUsage | null,
            )
          : Promise.resolve(null),
      ),
    ),
    keys.length
      ? keySecrets(orgId).catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
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
    // Claude Code says which model its default is today, so the row can name it.
    const defaultModel =
      app.id === "claude-code" ? list?.options.find((o) => o.id === list.default) : undefined
    const models: PickerModel[] = [
      {
        id: "default",
        label: defaultModel ? `${spec.defaultLabel} · ${defaultModel.label}` : spec.defaultLabel,
      },
    ]
    const seen = new Set(models.map((m) => m.id))
    for (const row of list?.options ?? []) addModel(models, seen, fromEngine(row))
    for (const m of app.models ?? []) addModel(models, seen, { id: m.id, label: m.label })
    for (const use of inUse) {
      if (use.keyId === keyId && use.model)
        addModel(models, seen, { id: use.model, label: use.model })
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
      for (const id of MODEL_SUGGESTIONS[provider] ?? [])
        addModel(models, seen, { id, label: id, free: id.endsWith(":free") })
    }
    for (const use of inUse) {
      if (use.keyId === key.id && use.model)
        addModel(models, seen, { id: use.model, label: use.model })
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

  // Apps signed in on this person's own Macs, each its own provider: no key, no login, their own
  // subscription. Then models served on those Macs (Ollama, LM Studio).
  for (const host of hosts) {
    const off = host.runnerEnabled
      ? ""
      : " · turn on “Run agents on this computer” in Settings → Computers"
    let offered = 0
    for (const agent of host.localAgents) {
      const spec = MAC_APPS[agent.id]
      const keyId = macKeyId(host.id, agent.id)
      const used = inUse.filter((use) => use.keyId === keyId)
      if (!spec || (agent.status !== "ready" && !used.length)) continue
      offered++
      const { models, effortLevels, source } = macAppModels(
        agent.id,
        agent.models,
        agent.version ?? null,
      )
      const seen = new Set(models.map((m) => m.id))
      for (const use of used)
        if (use.model) addModel(models, seen, { id: use.model, label: use.model })
      groups.push({
        keyId,
        provider: spec.provider,
        label: spec.label,
        detail:
          agent.status === "ready"
            ? `${RUNNER_APPS[agent.id] ?? spec.label} on ${host.name} · your subscription${off}`
            : `${RUNNER_APPS[agent.id] ?? spec.label} isn't signed in on ${host.name} right now. Open it once and sign in.`,
        section: "mac",
        models,
        effortLevels,
        source,
        runnerEnabled: host.runnerEnabled,
        hostId: host.id,
        hostName: host.name,
        ...(agent.account ? { account: agent.account } : {}),
        ...(agent.version ? { version: agent.version } : {}),
      })
    }
    for (const agent of host.localAgents) {
      const spec = LOCAL_MODEL_APPS[agent.id]
      const keyId = macKeyId(host.id, agent.id)
      const used = inUse.filter((use) => use.keyId === keyId)
      if (!spec || (agent.status !== "ready" && !used.length)) continue
      offered++
      const models: PickerModel[] = (agent.models ?? []).map((m) => ({
        id: m.id,
        label: m.label,
        free: true,
      }))
      const seen = new Set(models.map((m) => m.id))
      for (const use of used) {
        if (use.model)
          addModel(models, seen, { id: use.model, label: `${use.model} (not running right now)` })
      }
      groups.push({
        keyId,
        provider: spec.provider,
        label: spec.label,
        detail:
          agent.status === "ready"
            ? `Runs on ${host.name} · free, nothing leaves that computer but the reply${off}`
            : `${spec.label} isn't running on ${host.name} right now`,
        section: "local",
        models,
        effortLevels: [],
        source: "live",
        runnerEnabled: host.runnerEnabled,
        hostId: host.id,
        hostName: host.name,
      })
    }
    if (!offered) {
      groups.push({
        keyId: `host:${host.id}`,
        provider: "computer",
        label: host.name,
        detail: "No signed-in app found on this computer yet",
        section: "computer",
        models: [],
        effortLevels: [],
        source: "static",
        runnerEnabled: host.runnerEnabled,
        hostId: host.id,
        hostName: host.name,
      })
    }
  }
  return groups.map((group) =>
    group.section === "subscription" || group.section === "key"
      ? { ...group, models: withListings(group, inUse) }
      : group,
  )
}

/**
 * Marks which models lead the list and which fold under Older models, from models.dev release
 * dates, so a new model leads on its own the day its provider lists it (see `modelListings`).
 */
function withListings(
  group: PickerGroup,
  inUse: Array<{ keyId: string | null; model: string | null }>,
): PickerModel[] {
  const used = new Set(
    inUse.flatMap((use) => (use.keyId === group.keyId && use.model ? [use.model] : [])),
  )
  const listings = modelListings(group.provider, group.models, { inUse: used })
  if (!listings.size) return group.models
  return group.models.map((model) => {
    const info = listings.get(model.id)
    return info ? { ...model, ...info } : model
  })
}

/** Which provider account and model an agent runs on, in the picker's terms. */
export function agentModelUse(agent: Pick<AgentView, "params" | "providerKeyId" | "model">): {
  keyId: string | null
  model: string | null
} {
  return agentRunner(agent) ?? { keyId: agent.providerKeyId, model: agent.model }
}

/** An agent that runs through an app (on the server or on someone's Mac) instead of a key. */
export function agentRunner(
  agent: Pick<AgentView, "params">,
): { keyId: string; model: string | null } | null {
  const runner = agent.params?.runner as
    { hostId?: string; app?: string; where?: string; model?: string } | undefined
  if (runner?.where === "server" && runner.app) {
    return { keyId: `cli:${runner.app}`, model: runner.model ?? "default" }
  }
  return runner?.hostId
    ? {
        keyId: macKeyId(runner.hostId, runner.app ?? "claude-code"),
        model: runner.model ?? "default",
      }
    : null
}

/**
 * Everything the model picker can offer this person in this workspace, live: the server's own
 * models, apps signed in on the server, every saved key's provider list and their own computers.
 * Shared by the agents page and the title-bar picker so both always show the same list.
 */
export async function loadWorkspaceModels(input: {
  access: OrgAccess
  /** The request's host, which decides whether apps signed in on this computer count. */
  host: string | null
  keys?: ProviderKeyView[]
  agents?: AgentView[]
}): Promise<{ groups: PickerGroup[]; serverApps: ServerCliApp[] }> {
  const { access } = input
  const [keys, agents, hostRows] = await Promise.all([
    input.keys ?? listProviderKeys(access.org.id),
    input.agents ?? listOrgAgents(access.org.id),
    createAdminClient()
      .from("desktop_hosts")
      .select("id, name, settings, local_agents")
      .eq("user_id", access.user.id)
      .is("revoked_at", null)
      .then(({ data }) => data ?? []),
  ])
  const hosts: RunnerHost[] = (
    hostRows as Array<{
      id: string
      name: string
      settings: { runnerEnabled?: boolean } | null
      local_agents: RunnerHost["localAgents"] | null
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    runnerEnabled: Boolean(row.settings?.runnerEnabled),
    localAgents: row.local_agents ?? [],
  }))
  // Claude Code / Codex signed in on this computer, when the server is the person's own Mac.
  const serverApps: ServerCliApp[] =
    isOrgAdmin(access.role) && localDetectionAllowed(input.host)
      ? (await detectLocalAgents().catch(() => [])).filter(
          (app) => app.id === "claude-code" || app.id === "codex" || app.id === "cursor",
        )
      : []
  const groups = await buildModelCatalog(
    access.org.id,
    keys,
    agents.map(agentModelUse),
    hosts,
    serverApps,
  )
  return { groups, serverApps }
}
