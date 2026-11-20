"use server"

import { isValidHostPattern } from "@sayabot/core"
import { last4, sealSecret } from "@sayabot/llm"
import { randomBytes } from "node:crypto"
import { z } from "zod"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  revalidateOrg,
} from "@/lib/actions/shared"
import { getKek } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

const secretKindSchema = z.enum(["api_token", "basic_auth", "password", "header_set", "github_app"])

export async function saveVaultSecret(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const label = field(formData, "label")
  if (!label || label.length > 80) {
    return fail("Label must be between 1 and 80 characters")
  }

  const kindParsed = secretKindSchema.safeParse(field(formData, "kind"))
  if (!kindParsed.success) {
    return fail("Choose a valid secret kind")
  }

  const rawValue = field(formData, "secretValue")
  if (!rawValue) {
    return fail("Secret value is required")
  }

  const kek = getKek()
  const sealed = sealSecret(rawValue, kek)
  const l4 = last4(rawValue)

  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from("vault_secrets")
    .insert({
      org_id: check.access.org.id,
      owner_user_id: check.access.user.id,
      label,
      kind: kindParsed.data,
      sealed,
      last4: l4,
    })
    .select("id, label, kind, last4, created_at")
    .single()

  if (error || !row) {
    return fail(errorMessage(error) || "Failed to save secret")
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vault.secret_created",
    target: row.id,
    metadata: { label, kind: kindParsed.data, last4: l4 },
  })

  revalidateOrg(orgSlug)
  return ok("Secret saved securely", { secret: row })
}

export async function rotateVaultSecret(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const secretId = field(formData, "secretId")
  const rawValue = field(formData, "secretValue")
  if (!secretId || !rawValue) {
    return fail("Secret ID and new secret value are required")
  }

  const kek = getKek()
  const sealed = sealSecret(rawValue, kek)
  const l4 = last4(rawValue)
  const now = new Date().toISOString()

  const admin = createAdminClient()
  const { error } = await admin
    .from("vault_secrets")
    .update({
      sealed,
      last4: l4,
      rotated_at: now,
    })
    .eq("id", secretId)
    .eq("org_id", check.access.org.id)

  if (error) {
    return fail(errorMessage(error) || "Failed to rotate secret")
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vault.secret_rotated",
    target: secretId,
    metadata: { last4: l4 },
  })

  revalidateOrg(orgSlug)
  return ok("Secret rotated successfully")
}

export async function deleteVaultSecret(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const secretId = field(formData, "secretId")
  if (!secretId) return fail("Secret ID is required")

  const admin = createAdminClient()
  const { error } = await admin
    .from("vault_secrets")
    .delete()
    .eq("id", secretId)
    .eq("org_id", check.access.org.id)

  if (error) {
    return fail(errorMessage(error) || "Failed to delete secret")
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vault.secret_deleted",
    target: secretId,
  })

  revalidateOrg(orgSlug)
  return ok("Secret removed")
}

export async function grantSecret(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const agentId = field(formData, "agentId")
  const secretId = field(formData, "secretId")
  const envName = field(formData, "envName").trim().toUpperCase()

  if (!agentId || !secretId) {
    return fail("Agent and secret must be specified")
  }

  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(envName)) {
    return fail(
      "Environment variable name must be uppercase letters, numbers, and underscores (e.g. STRIPE_API_KEY)",
    )
  }

  const rawHosts = field(formData, "allowedHosts")
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)

  if (rawHosts.length === 0) {
    return fail("At least one allowed host is required")
  }

  for (const host of rawHosts) {
    if (!isValidHostPattern(host)) {
      return fail(
        `Invalid host pattern: "${host}". Must be a valid domain (e.g. api.stripe.com or *.github.com). IP addresses and wildcards alone are not permitted.`,
      )
    }
  }

  const injectMode = (field(formData, "injectMode") || "header") as
    "header" | "basic" | "query" | "body"
  const requiresApproval =
    field(formData, "requiresApproval") === "true" || field(formData, "requiresApproval") === "on"
  const placeholder = `saaya_ph_${randomBytes(16).toString("hex")}`

  const admin = createAdminClient()
  const { data: grant, error } = await admin
    .from("agent_secret_grants")
    .insert({
      org_id: check.access.org.id,
      agent_id: agentId,
      secret_id: secretId,
      env_name: envName,
      placeholder,
      allowed_hosts: rawHosts,
      inject: { mode: injectMode },
      requires_approval: requiresApproval,
    })
    .select("id, agent_id, env_name, placeholder, allowed_hosts, created_at")
    .single()

  if (error || !grant) {
    return fail(errorMessage(error) || "Failed to grant secret")
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vault.grant_created",
    target: grant.id,
    metadata: { agentId, secretId, envName, allowedHosts: rawHosts, requiresApproval },
  })

  revalidateOrg(orgSlug)
  return ok("Secret granted to agent", { grant })
}

export async function revokeGrant(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const grantId = field(formData, "grantId")
  if (!grantId) return fail("Grant ID is required")

  const admin = createAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin
    .from("agent_secret_grants")
    .update({ revoked_at: now })
    .eq("id", grantId)
    .eq("org_id", check.access.org.id)

  if (error) {
    return fail(errorMessage(error) || "Failed to revoke grant")
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "vault.grant_revoked",
    target: grantId,
  })

  revalidateOrg(orgSlug)
  return ok("Grant revoked")
}
