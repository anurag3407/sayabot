/**
 * Rewrites src/models/models-dev.snapshot.json from https://models.dev/api.json.
 * The snapshot is only the fallback for a server that has never reached models.dev; the live
 * catalog refreshes itself daily. Keeps the providers Sayabot maps to, to stay small.
 *
 *   pnpm --filter @sayabot/llm catalog:snapshot
 */
import { writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  CATALOG_SCHEMA,
  MODELS_DEV_PROVIDER,
  MODELS_DEV_URL,
  catalogStats,
  trimModelsDevCatalog,
} from "../src/models/models-dev"

const target = fileURLToPath(new URL("../src/models/models-dev.snapshot.json", import.meta.url))
const only = new Set([...Object.values(MODELS_DEV_PROVIDER), "ollama-cloud", "mistral"])

const response = await fetch(MODELS_DEV_URL, {
  headers: { accept: "application/json", "user-agent": "Sayabot" },
})
if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
const providers = trimModelsDevCatalog(await response.json(), { only })
const doc = {
  schema: CATALOG_SCHEMA,
  updatedAt: new Date().toISOString(),
  source: { name: "models.dev", url: MODELS_DEV_URL, license: "MIT" },
  providers,
}
writeFileSync(target, `${JSON.stringify(doc)}\n`)
const stats = catalogStats(providers)
console.log(`wrote ${stats.providers} providers, ${stats.models} models to ${target}`)
