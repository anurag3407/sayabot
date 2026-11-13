"use server"

import { z } from "zod"
import { generateText } from "ai"
import {
  createLanguageModel,
  providerKeyToApiKey,
} from "@sayabot/llm"
import { PROVIDERS, redactSecrets } from "@sayabot/core"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek } from "@/lib/env"
import { storeProviderKey } from "@/lib/provider-key-store"
import { defaultModel } from "@/lib/model-options"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  optionalField,
  revalidateOrg,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

const providerSchema = z.enum(PROVIDERS)

export async function saveProviderKey(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const provider = providerSchema.safeParse(field(formData, "provider"))
  if (!provider.success) return fail("Choose a provider")
  const label = field(formData, "label")
  if (label.length < 1 || label.length > 60) return fail("Label must be 1 to 60 characters")
  const saved = await storeProviderKey({
    access: check.access,
    provider: provider.data,
    secret: field(formData, "apiKey"),
    label,
    baseUrl: optionalField(formData, "baseUrl"),
  })
  if (!saved.ok) return fail(saved.error)
  return ok("Key saved", { keyId: saved.keyId })
}

/**
 * The Manage AI accounts dialog: saves a key for a provider and checks it at once by reading the
 * provider's model list with it. A key the provider refuses is not kept.
 */
export async function connectAccountAction(input: {
  orgSlug: string
  provider: string
  apiKey: string
  label?: string
  baseUrl?: string | null
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const saved = await storeProviderKey({
    access: check.access,
    provider: input.provider,
    secret: input.apiKey,
    label: input.label,
    baseUrl: input.baseUrl,
    verify: true,
  })
  if (!saved.ok) return fail(saved.error)
  const message =
    saved.note ??
    (saved.models !== null
      ? `Connected · ${saved.models} ${saved.models === 1 ? "model" : "models"}`
      : "Connected")
  return ok(message, { keyId: saved.keyId, label: saved.label, last4: saved.last4 })
}

export async function deleteProviderKey(input: {
  orgSlug: string
  keyId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: key } = await admin
    .from("provider_keys")
    .select("id, org_id, label, last4")
    .eq("id", input.keyId)
    .maybeSingle()
  if (!key || key.org_id !== check.access.org.id) return fail("Key not found")
  const { error } = await admin.from("provider_keys").delete().eq("id", input.keyId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "provider_key.deleted",
    target: key.label,
    metadata: { last4: key.last4 },
  })
  revalidateOrg(input.orgSlug)
  return ok("Key deleted")
}

export async function testProviderKey(
  orgSlug: string,
  keyId: string,
  modelOverride?: string,
): Promise<ActionResult> {
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: key } = await admin
    .from("provider_keys")
    .select("*")
    .eq("id", keyId)
    .maybeSingle()
  if (!key || key.org_id !== check.access.org.id) return fail("Key not found")
  const model =
    modelOverride?.trim() ||
    defaultModel(key.provider) ||
    process.env.DEV_OPENAI_COMPAT_MODEL ||
    ""
  if (!model) return fail("Enter a model name to test custom endpoints")
  const started = Date.now()
  try {
    const apiKey = providerKeyToApiKey(
      {
        provider: key.provider,
        baseUrl: key.base_url,
        ciphertext: key.ciphertext,
        iv: key.iv,
        tag: key.tag,
      },
      getKek(),
    )
    const languageModel = createLanguageModel({
      provider: key.provider,
      apiKey,
      model,
      baseUrl: key.base_url,
    })
    const result = await generateText({
      model: languageModel,
      prompt: "Reply with the single word: ok",
      maxOutputTokens: 8,
      abortSignal: AbortSignal.timeout(25_000),
    })
    return ok(`Connected to ${model} in ${Date.now() - started} ms`, {
      reply: result.text.slice(0, 80),
    })
  } catch (error) {
    return fail(`Connection failed: ${redactSecrets(errorMessage(error)).text}`)
  }
}

