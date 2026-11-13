import "server-only"
import { getAllGroupedModels } from "@/lib/connectors/registry"
import { devModelConfigured } from "@/lib/env"
import { effectiveProvider } from "@/lib/format"
import { MODEL_SUGGESTIONS } from "@/lib/model-options"
import type { ProviderKeyView } from "@/lib/types"

export interface PickerModel {
  id: string
  label: string
  free?: boolean
}

/** One rail entry in the model picker: a provider account (or the server default). */
export interface PickerGroup {
  keyId: string | null
  provider: string
  label: string
  detail: string
  models: PickerModel[]
}

const REGISTRY_PROVIDER: Record<string, string> = {
  openai: "openai",
  openrouter: "openrouter",
  copilot: "copilot",
  deepseek: "deepseek",
}

function addModel(list: PickerModel[], seen: Set<string>, model: PickerModel) {
  const id = model.id.trim()
  if (!id || seen.has(id)) return
  seen.add(id)
  list.push({ ...model, id })
}

/**
 * The models people can pick per provider account: common picks first, then the live list
 * (OpenRouter) where there is one, plus anything an agent already uses so it always shows.
 */
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
  models?: PickerModel[]
}

/** Models offered for apps on this computer; "default" leaves the choice to the app. */
const CLI_MODELS: Record<string, { provider: string; label: string; models: PickerModel[] }> = {
  "claude-code": {
    provider: "anthropic",
    label: "Claude",
    models: [
      { id: "default", label: "Claude Code default" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      { id: "claude-fable-5-2", label: "Claude Fable 5.2" },
    ],
  },
  codex: {
    provider: "openai",
    label: "Codex",
    models: [{ id: "default", label: "Codex default (your Codex settings)" }],
  },
  cursor: {
    provider: "cursor",
    label: "Cursor",
    models: [{ id: "default", label: "Cursor default (Auto)" }],
  },
}

export async function buildModelCatalog(
  keys: ProviderKeyView[],
  inUse: Array<{ keyId: string | null; model: string | null }>,
  hosts: RunnerHost[] = [],
  serverApps: ServerCliApp[] = [],
): Promise<PickerGroup[]> {
  let registry: Awaited<ReturnType<typeof getAllGroupedModels>>["groups"] = []
  try {
    registry = (
      await Promise.race([
        getAllGroupedModels(process.env.OPENROUTER_API_KEY),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 4_000)),
      ])
    ).groups
  } catch {
    registry = []
  }

  const groups: PickerGroup[] = []
  // Apps already signed in on this computer come first: no key, no login, your own subscription.
  for (const app of serverApps) {
    const spec = CLI_MODELS[app.id]
    if (!spec) continue
    const keyId = `cli:${app.id}`
    const used = inUse.some((use) => use.keyId === keyId)
    if ((!app.cli || app.status !== "ready") && !used) continue
    const models = [...spec.models]
    const seen = new Set(models.map((m) => m.id))
    for (const m of app.models ?? []) addModel(models, seen, m)
    for (const use of inUse) {
      if (use.keyId === keyId && use.model) addModel(models, seen, { id: use.model, label: use.model })
    }
    groups.push({
      keyId,
      provider: spec.provider,
      label: spec.label,
      detail:
        app.status === "ready"
          ? `${app.version ? `${app.version} · ` : ""}${RUNNER_APPS[app.id]} on this computer · your subscription`
          : `${RUNNER_APPS[app.id]} isn't signed in right now. Run it once in a terminal and sign in.`,
      models,
    })
  }
  if (devModelConfigured()) {
    groups.push({ keyId: null, provider: "sayabot", label: "Sayabot default", detail: "Set by your server", models: [] })
  }
  for (const key of keys) {
    const provider = effectiveProvider(key.provider, key.baseUrl)
    const models: PickerModel[] = []
    const seen = new Set<string>()
    for (const id of MODEL_SUGGESTIONS[provider] ?? []) {
      addModel(models, seen, { id, label: id, free: id.endsWith(":free") })
    }
    const registryProvider = REGISTRY_PROVIDER[provider]
    if (registryProvider) {
      for (const group of registry.filter((g) => g.provider === registryProvider)) {
        for (const m of group.models.slice(0, 80)) {
          if (m.blocked) continue
          addModel(models, seen, { id: m.id, label: m.label || m.id, free: Boolean(m.isFree) })
        }
      }
    }
    for (const use of inUse) {
      if (use.keyId === key.id && use.model) addModel(models, seen, { id: use.model, label: use.model })
    }
    groups.push({
      keyId: key.id,
      provider,
      label: key.label || provider,
      detail: `${provider} · •••• ${key.last4}`,
      models,
    })
  }
  // "Run on my computer": apps signed in on this person's own Macs, on their own subscription.
  for (const host of hosts) {
    const models = host.localAgents
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
      models,
    })
  }
  return groups
}
