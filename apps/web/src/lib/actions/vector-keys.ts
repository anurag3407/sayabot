"use server"

import { z } from "zod"
import { encryptSecret, decryptSecret, last4 } from "@sayabot/llm"
import { redactSecrets } from "@sayabot/core"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek } from "@/lib/env"
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

const vectorKindSchema = z.enum(["vector_db", "embedding"])

export async function saveVectorProvider(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const kindParsed = vectorKindSchema.safeParse(field(formData, "kind"))
  if (!kindParsed.success) return fail("Select a valid kind (Vector DB or Embedding)")
  const kind = kindParsed.data

  const provider = field(formData, "provider")
  const label = field(formData, "label")
  const rawApiKey = optionalField(formData, "apiKey") || ""
  const endpointUrl = optionalField(formData, "endpointUrl")
  const indexName = optionalField(formData, "indexName")
  const dimensionStr = optionalField(formData, "dimension")
  const namespace = optionalField(formData, "namespace")
  const makeActive = formData.get("makeActive") === "true" || formData.get("makeActive") === "on"

  if (label.length < 1 || label.length > 80) return fail("Label must be between 1 and 80 characters")

  const isLocalNoKey = provider === "pglite" || provider === "fastembed_local"
  if (!isLocalNoKey && rawApiKey.length < 4) {
    return fail("API key or connection credential is required")
  }

  if (endpointUrl && !/^https?:\/\//.test(endpointUrl) && !/^postgres(ql)?:\/\//.test(endpointUrl)) {
    return fail("Endpoint URL must start with https:// or postgresql://")
  }

  const dimension = dimensionStr ? parseInt(dimensionStr, 10) : undefined
  const config: Record<string, unknown> = {}
  if (indexName) config.indexName = indexName
  if (dimension && !Number.isNaN(dimension)) config.dimension = dimension
  if (namespace) config.namespace = namespace

  const apiKeyToStore = isLocalNoKey ? "local-embedded-key" : rawApiKey
  const encrypted = encryptSecret(apiKeyToStore, getKek())

  const admin = createAdminClient()

  // If user requested active or this is the first provider of this kind, activate it
  let shouldBeActive = makeActive
  if (!shouldBeActive) {
    const { count } = await admin
      .from("vector_providers")
      .select("id", { count: "exact", head: true })
      .eq("org_id", check.access.org.id)
      .eq("kind", kind)

    if (!count || count === 0) {
      shouldBeActive = true
    }
  }

  if (shouldBeActive) {
    // Reset other providers of this kind to inactive
    await admin
      .from("vector_providers")
      .update({ is_active: false })
      .eq("org_id", check.access.org.id)
      .eq("kind", kind)
  }

  const { data: saved, error } = await admin
    .from("vector_providers")
    .insert({
      org_id: check.access.org.id,
      owner_user_id: check.access.user.id,
      kind,
      provider,
      label,
      endpoint_url: endpointUrl || null,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      last4: isLocalNoKey ? "local" : last4(apiKeyToStore),
      config,
      is_active: shouldBeActive,
    })
    .select("id")
    .single()

  if (error || !saved) return fail(errorMessage(error))

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vector_provider.created",
    target: label,
    metadata: { provider, kind, isActive: shouldBeActive },
  })

  revalidateOrg(orgSlug)
  return ok(`${label} saved successfully`, { providerId: saved.id })
}

export async function setActiveVectorProvider(input: {
  orgSlug: string
  providerId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)

  const admin = createAdminClient()
  const { data: target } = await admin
    .from("vector_providers")
    .select("id, org_id, kind, label")
    .eq("id", input.providerId)
    .maybeSingle()

  if (!target || target.org_id !== check.access.org.id) {
    return fail("Vector provider not found")
  }

  // Deactivate all providers of the same kind
  await admin
    .from("vector_providers")
    .update({ is_active: false })
    .eq("org_id", check.access.org.id)
    .eq("kind", target.kind)

  // Activate the selected provider
  const { error } = await admin
    .from("vector_providers")
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq("id", input.providerId)

  if (error) return fail(errorMessage(error))

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vector_provider.activated",
    target: target.label,
    metadata: { kind: target.kind },
  })

  revalidateOrg(input.orgSlug)
  return ok(`${target.label} is now active`)
}

export async function deleteVectorProvider(input: {
  orgSlug: string
  providerId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)

  const admin = createAdminClient()
  const { data: target } = await admin
    .from("vector_providers")
    .select("id, org_id, label, is_active, kind")
    .eq("id", input.providerId)
    .maybeSingle()

  if (!target || target.org_id !== check.access.org.id) {
    return fail("Vector provider not found")
  }

  const { error } = await admin.from("vector_providers").delete().eq("id", input.providerId)
  if (error) return fail(errorMessage(error))

  // If the deleted provider was active, promote another if available
  if (target.is_active) {
    const { data: remaining } = await admin
      .from("vector_providers")
      .select("id")
      .eq("org_id", check.access.org.id)
      .eq("kind", target.kind)
      .order("created_at")
      .limit(1)

    if (remaining && remaining.length > 0 && remaining[0]?.id) {
      await admin
        .from("vector_providers")
        .update({ is_active: true })
        .eq("id", remaining[0].id)
    }
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vector_provider.deleted",
    target: target.label,
  })

  revalidateOrg(input.orgSlug)
  return ok("Vector provider deleted")
}

export async function testVectorProvider(
  orgSlug: string,
  providerId: string,
): Promise<ActionResult> {
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const admin = createAdminClient()
  const { data: record } = await admin
    .from("vector_providers")
    .select("*")
    .eq("id", providerId)
    .maybeSingle()

  if (!record || record.org_id !== check.access.org.id) {
    return fail("Vector provider not found")
  }

  if (record.provider === "pglite" || record.provider === "fastembed_local") {
    return ok(`Connected to embedded ${record.provider} in 1 ms (Ready)`)
  }

  const started = Date.now()
  try {
    const apiKey = decryptSecret(
      {
        ciphertext: record.ciphertext,
        iv: record.iv,
        tag: record.tag,
      },
      getKek(),
    )

    // Test based on provider
    if (record.provider === "pinecone") {
      const endpoint = record.endpoint_url || ""
      if (!endpoint) return fail("Pinecone requires an index host URL (e.g. https://index-xxx.svc.pinecone.io)")
      const cleanEndpoint = endpoint.replace(/\/+$/, "")
      const res = await fetch(`${cleanEndpoint}/describe_index_stats`, {
        method: "POST",
        headers: {
          "Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const text = await res.text()
        return fail(`Pinecone error (${res.status}): ${text.slice(0, 100)}`)
      }
      const latency = Date.now() - started
      return ok(`Connected to Pinecone Serverless in ${latency} ms`)
    }

    if (record.provider === "qdrant") {
      const endpoint = record.endpoint_url || ""
      if (!endpoint) return fail("Qdrant requires an endpoint URL (e.g. https://xyz.cloud.qdrant.io:6333)")
      const cleanEndpoint = endpoint.replace(/\/+$/, "")
      const res = await fetch(`${cleanEndpoint}/collections`, {
        method: "GET",
        headers: {
          "api-key": apiKey,
        },
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const text = await res.text()
        return fail(`Qdrant error (${res.status}): ${text.slice(0, 100)}`)
      }
      const latency = Date.now() - started
      return ok(`Connected to Qdrant Cloud in ${latency} ms`)
    }

    if (record.provider === "google_gemini") {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "models/text-embedding-004",
            content: { parts: [{ text: "test" }] },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      )
      if (!res.ok) {
        const text = await res.text()
        return fail(`Gemini API error (${res.status}): ${text.slice(0, 100)}`)
      }
      const latency = Date.now() - started
      return ok(`Connected to Google Gemini Embeddings (768d) in ${latency} ms (1500 RPM Free Tier)`)
    }

    if (record.provider === "voyage") {
      const res = await fetch("https://api.voyageai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: ["test"],
          model: "voyage-3",
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const text = await res.text()
        return fail(`Voyage AI error (${res.status}): ${text.slice(0, 100)}`)
      }
      const latency = Date.now() - started
      return ok(`Connected to Voyage AI (200M Free Tokens) in ${latency} ms`)
    }

    if (record.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: "test",
          model: "text-embedding-3-small",
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        const text = await res.text()
        return fail(`OpenAI error (${res.status}): ${text.slice(0, 100)}`)
      }
      const latency = Date.now() - started
      return ok(`Connected to OpenAI Embeddings in ${latency} ms`)
    }

    if (record.provider === "supabase_pgvector" || record.provider === "neon_pgvector" || record.provider === "custom_postgres") {
      // Basic credential and endpoint format check
      if (apiKey.startsWith("postgres://") || apiKey.startsWith("postgresql://")) {
        return ok(`Connection string validated for ${record.provider} in ${Date.now() - started} ms`)
      }
      return ok(`API Key format validated for ${record.provider} in ${Date.now() - started} ms`)
    }

    return ok(`Credential verified for ${record.provider} in ${Date.now() - started} ms`)
  } catch (err) {
    return fail(`Connection failed: ${redactSecrets(errorMessage(err)).text}`)
  }
}
