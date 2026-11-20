"use server"

import { parseCapabilities } from "@sayabot/core"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  revalidateOrg,
} from "@/lib/actions/shared"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

export async function saveAgentAsTemplate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const agentId = field(formData, "agentId")
  const name = field(formData, "name").trim()
  const description = field(formData, "description").trim()
  const category = field(formData, "category").trim() || "general"

  if (!agentId || !name) {
    return fail("Agent ID and template name are required")
  }

  const admin = createAdminClient()

  // 1. Load agent details
  const { data: agent, error: agentError } = await admin
    .from("agents")
    .select("id, handle, display_name, system_prompt, model, capabilities, tool_ids")
    .eq("id", agentId)
    .eq("org_id", check.access.org.id)
    .single()

  if (agentError || !agent) {
    return fail("Agent not found")
  }

  // 2. Load agent grants to convert to secret slots
  const { data: grants } = await admin
    .from("agent_secret_grants")
    .select("env_name, allowed_hosts, inject, requires_approval")
    .eq("agent_id", agentId)
    .is("revoked_at", null)

  const secretSlots = (grants ?? []).map((g) => ({
    name: g.env_name,
    label: g.env_name.replace(/_/g, " "),
    required: true,
    allowedHosts: g.allowed_hosts,
    inject: g.inject,
  }))

  const slug = `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}-${Date.now().toString(36)}`

  // 3. Insert template
  const { data: template, error: insertError } = await admin
    .from("agent_templates")
    .insert({
      org_id: check.access.org.id,
      slug,
      name,
      description,
      category,
      system_prompt: agent.system_prompt || "",
      capabilities: parseCapabilities(agent.capabilities),
      default_model: agent.model,
      secret_slots: secretSlots,
      starter_tasks: [],
    })
    .select("id, slug, name")
    .single()

  if (insertError || !template) {
    return fail(errorMessage(insertError) || "Failed to save template")
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "template.created",
    target: template.id,
    metadata: { name, slug: template.slug },
  })

  revalidateOrg(orgSlug)
  return ok("Agent saved as template", { template })
}
