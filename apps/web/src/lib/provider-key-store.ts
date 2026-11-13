import "server-only"
import { encryptSecret, last4 } from "@sayabot/llm"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek } from "@/lib/env"
import { accountProvider, storedProvider } from "@/lib/ai-accounts"
import { audit, revalidateOrg } from "@/lib/actions/shared"
import { effectiveProvider } from "@/lib/format"
import type { OrgAccess } from "@/lib/types"

export type StoreKeyResult =
  | { ok: true; keyId: string; label: string; last4: string; models: number | null; note?: string }
  | { ok: false; error: string }

/** A key the provider itself refused: saving it would only fail later, in a turn. */
const REFUSED = /refused this key|did not give a Copilot token|HTTP 401|HTTP 403/i

/**
 * Saves a connected AI account as an encrypted provider key, the one place keys are written:
 * Settings → AI providers, the Manage AI accounts dialog, and the OpenRouter and Copilot
 * sign-ins all end here. With `verify`, the provider's model list is read with the new key right
 * away (it also fills the picker's cache); a key the provider refuses is removed again and the
 * reason returned. The secret never leaves the server, and the result carries only its last four
 * characters.
 */
export async function storeProviderKey(input: {
  access: OrgAccess
  /** An id from ACCOUNT_PROVIDERS. */
  provider: string
  secret: string
  label?: string
  /** For a custom server, or to point a known provider somewhere else. */
  baseUrl?: string | null
  verify?: boolean
}): Promise<StoreKeyResult> {
  const spec = accountProvider(input.provider)
  if (!spec || spec.kind === "app") return { ok: false, error: "Choose a provider" }
  const baseUrl = input.baseUrl?.trim() || null
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, error: "The address must start with http:// or https://" }
  }
  const stored = storedProvider(spec.id, baseUrl)
  if (!stored) return { ok: false, error: "A custom server needs its address" }
  // Local servers (Ollama, LM Studio) take no key; the row still needs one.
  const secret = input.secret.trim() || (spec.id === "openai-compatible" ? "no-key-needed" : "")
  if (secret.length < 8) return { ok: false, error: "Paste the API key" }
  const label = (input.label?.trim() || spec.name).slice(0, 60)

  const encrypted = encryptSecret(secret, getKek())
  const admin = createAdminClient()
  const { data: saved, error } = await admin
    .from("provider_keys")
    .insert({
      org_id: input.access.org.id,
      owner_user_id: input.access.user.id,
      provider: stored.provider,
      base_url: stored.baseUrl,
      label,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      last4: last4(secret),
    })
    .select("id")
    .single()
  if (error || !saved) return { ok: false, error: "Could not save the key" }
  const keyId = String(saved.id)

  let models: number | null = null
  let note: string | undefined
  if (input.verify) {
    const { listProviderModels } = await import("@sayabot/llm/models")
    const list = await listProviderModels({
      provider: effectiveProvider(stored.provider, stored.baseUrl),
      apiKey: secret,
      baseUrl: stored.baseUrl,
      cacheKey: keyId,
      force: true,
    }).catch((cause: unknown) => ({
      models: [],
      source: "catalog" as const,
      error: cause instanceof Error ? cause.message : "Could not reach the provider",
    }))
    if (list.source === "live") models = list.models.length
    else if (list.error && REFUSED.test(list.error)) {
      await admin.from("provider_keys").delete().eq("id", keyId)
      return { ok: false, error: list.error }
    } else if (list.error) {
      note = `Saved, but its model list could not be read yet: ${list.error}`
    }
  }

  await audit({
    orgId: input.access.org.id,
    actorId: input.access.user.id,
    action: "provider_key.created",
    target: label,
    metadata: { provider: spec.id, last4: last4(secret) },
  })
  revalidateOrg(input.access.org.slug)
  return { ok: true, keyId, label, last4: last4(secret), models, ...(note ? { note } : {}) }
}
