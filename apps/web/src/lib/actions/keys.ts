"use server"

import { z } from "zod"
import { generateText } from "ai"
import {
  createLanguageModel,
  encryptSecret,
  last4,
  providerKeyToApiKey,
} from "@sayabot/llm"
import { PROVIDERS, redactSecrets } from "@sayabot/core"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek } from "@/lib/env"
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
  const label = field(formData, "label")
  // Local servers (Ollama, LM Studio) take no key; store a placeholder so the row is valid.
  const rawKey = field(formData, "apiKey")
  const apiKey = !rawKey && field(formData, "provider") === "openai-compatible" ? "no-key-needed" : rawKey
  const baseUrl = optionalField(formData, "baseUrl")
  if (!provider.success) return fail("Choose a provider")
  if (label.length < 1 || label.length > 60) return fail("Label must be 1 to 60 characters")
  if (apiKey.length < 8) return fail("Paste the provider API key")
  if (provider.data === "openai-compatible" && !baseUrl) {
    return fail("Custom OpenAI-compatible providers need a base URL")
  }
  if (baseUrl && !/^https?:\/\//.test(baseUrl)) return fail("Base URL must start with http(s)://")
  const dbProvider =
    provider.data === "openrouter" || provider.data === "copilot"
      ? "openai-compatible"
      : provider.data
  const effectiveBaseUrl =
    baseUrl ||
    (provider.data === "openrouter"
      ? "https://openrouter.ai/api/v1"
      : provider.data === "copilot"
        ? "https://api.githubcopilot.com"
        : null)
  const encrypted = encryptSecret(apiKey, getKek())
  const admin = createAdminClient()
  const { data: saved, error } = await admin
    .from("provider_keys")
    .insert({
      org_id: check.access.org.id,
      owner_user_id: check.access.user.id,
      provider: dbProvider,
      base_url: effectiveBaseUrl,
      label,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      last4: last4(apiKey),
    })
    .select("id")
    .single()
  if (error || !saved) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "provider_key.created",
    target: label,
    metadata: { provider: provider.data, last4: last4(apiKey) },
  })
  revalidateOrg(orgSlug)
  return ok("Key saved", { keyId: saved.id })
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

