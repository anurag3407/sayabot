import "server-only"
import { localDetectionAllowed } from "@/lib/local-agents"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Asks the person's own Macs to read their apps' model lists again now (they pick this up on the
 * next heartbeat, skip their six-hour cache, and report back within a minute).
 */
async function askMacsToRescan(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("desktop_hosts")
    .select("id, settings")
    .eq("user_id", userId)
    .is("revoked_at", null)
  const at = new Date().toISOString()
  await Promise.all(
    ((data ?? []) as Array<{ id: string; settings: Record<string, unknown> | null }>).map((host) =>
      admin
        .from("desktop_hosts")
        .update({ settings: { ...(host.settings ?? {}), agentsRescanAt: at } })
        .eq("id", host.id),
    ),
  )
}

/**
 * `refresh=1` on the model list: every caller asks their own Macs to rescan. Only an org admin
 * also drops the server's model caches (models.dev, the manifest, Codex/Claude CLI lists).
 */
export async function refreshModelSources(input: {
  userId: string
  host: string | null
  forceCatalog: boolean
}): Promise<void> {
  await askMacsToRescan(input.userId).catch((error: unknown) => {
    console.warn("[models] could not ask the Macs to rescan", error)
  })
  if (!input.forceCatalog) return
  const models = await import("@sayabot/llm/models")
  models.clearProviderModelCache()
  await Promise.all([
    models.modelCatalog().refresh({ force: true }),
    models.modelManifest().refresh({ force: true }),
    ...(localDetectionAllowed(input.host)
      ? [
          models.codexModelCatalog({ force: true }).catch(() => null),
          models.claudeModelCatalog({ force: true }).catch(() => null),
        ]
      : []),
  ])
}
