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
export async function buildModelCatalog(
  keys: ProviderKeyView[],
  inUse: Array<{ keyId: string | null; model: string | null }>,
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
  return groups
}
