"use server"

import { z } from "zod"
import { DEFAULT_CAPABILITIES, isSayaModel, parseCapabilities, redactSecrets, sayaModelLabel, sayaModelValue } from "@sayabot/core"
import { generateWebhookSecret } from "@sayabot/core/server"
import { sealSecret } from "@sayabot/llm"
import { EFFORT_LEVELS } from "@sayabot/llm/models/effort"
import { randomBytes } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { planGate } from "@/lib/plan-limits"
import { getKek, sayaAi } from "@/lib/env"
import { headers } from "next/headers"
import { localDetectionAllowed } from "@/lib/local-agents"
import { testAgentInOrchestrator } from "@/lib/orchestrator"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  optionalField,
  parseJsonObject,
  revalidateOrg,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

const handleSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,38}$/, "Use lowercase letters, numbers and hyphens, starting with a letter")
const RESERVED_HANDLES = new Set(["all_bots", "human", "system", "moderator"])

function validateAgentFields(formData: FormData, kind: "llm" | "external") {
  const handle = field(formData, "handle").toLowerCase()
  const displayName = field(formData, "displayName")
  if (!handleSchema.safeParse(handle).success) {
    return { error: "Handle must be lowercase letters, numbers and hyphens, starting with a letter" }
  }
  if (RESERVED_HANDLES.has(handle)) return { error: "That handle is reserved" }
  if (displayName.length < 1 || displayName.length > 60) {
    return { error: "Display name must be 1 to 60 characters" }
  }
  const paramsResult = parseJsonObject(field(formData, "params"))
  if (!paramsResult.ok) return { error: `Params: ${paramsResult.error}` }
  const toolIds = formData
    .getAll("toolIds")
    .filter((value): value is string => typeof value === "string")
  const providerKeyId = optionalField(formData, "providerKeyId")
  const model = optionalField(formData, "model")
  const webhookUrl = optionalField(formData, "webhookUrl")
  if (kind === "llm" && providerKeyId && !model) {
    return { error: "A model id is required when a provider key is attached" }
  }
  // External agents without a webhook connect over MCP from their owner's own client.
  if (kind === "external" && webhookUrl && !/^https?:\/\//.test(webhookUrl)) {
    return { error: "Webhook URL must start with http(s)://" }
  }
  return {
    handle,
    displayName,
    params: paramsResult.value,
    toolIds,
    providerKeyId,
    model,
    webhookUrl,
  }
}

export async function createAgent(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const kindParsed = z.enum(["llm", "external"]).safeParse(field(formData, "kind") || "llm")
  if (!kindParsed.success) return fail("Choose an agent kind")
  const kind = kindParsed.data
  const fields = validateAgentFields(formData, kind)
  if ("error" in fields) return fail(fields.error ?? "Invalid agent fields")
  const agentGate = await planGate(check.access.org.id, "agents")
  if (!agentGate.ok) return fail(agentGate.message)
  const admin = createAdminClient()
  if (fields.providerKeyId) {
    const { data: key } = await admin
      .from("provider_keys")
      .select("id, org_id")
      .eq("id", fields.providerKeyId)
      .maybeSingle()
    if (!key || key.org_id !== check.access.org.id) return fail("Provider key not found")
  }
  const webhookSecret = kind === "external" && fields.webhookUrl ? generateWebhookSecret() : null
  const { data: agent, error } = await admin
    .from("agents")
    .insert({
      org_id: check.access.org.id,
      handle: fields.handle,
      display_name: fields.displayName,
      kind,
      provider_key_id: fields.providerKeyId,
      model: fields.model,
      system_prompt: field(formData, "systemPrompt"),
      params: fields.params,
      tool_ids: fields.toolIds,
      webhook_url: fields.webhookUrl,
      webhook_secret_enc: webhookSecret ? sealSecret(webhookSecret, getKek()) : null,
    })
    .select("id")
    .single()
  if (error || !agent) {
    return fail(
      error?.code === "23505" ? `@${fields.handle} already exists` : errorMessage(error),
    )
  }
  const roomId = optionalField(formData, "roomId")
  let addedToRoom = false
  if (roomId) {
    const { data: room } = await admin
      .from("rooms")
      .select("id, org_id, kind")
      .eq("id", roomId)
      .maybeSingle()
    if (room && room.org_id === check.access.org.id && room.kind !== "dm") {
      const { data: last } = await admin
        .from("room_agents")
        .select("position")
        .eq("room_id", roomId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle()
      const { error: linkError } = await admin
        .from("room_agents")
        .insert({ room_id: roomId, agent_id: agent.id, position: (last?.position ?? -1) + 1 })
      addedToRoom = !linkError
    }
  }
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent.created",
    target: fields.handle,
    metadata: { kind, model: fields.model },
  })
  revalidateOrg(orgSlug)
  return ok(
    webhookSecret
      ? "Agent created. Copy the webhook secret now."
      : addedToRoom
        ? "Agent created and added to the room"
        : "Agent created",
    { agentId: agent.id, kind, webhookSecret },
  )
}

export async function updateAgent(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const agentId = field(formData, "agentId")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("agents")
    .select("id, org_id, kind")
    .eq("id", agentId)
    .maybeSingle()
  if (!existing || existing.org_id !== check.access.org.id) return fail("Agent not found")
  const fields = validateAgentFields(formData, existing.kind)
  if ("error" in fields) return fail(fields.error ?? "Invalid agent fields")
  if (fields.providerKeyId) {
    const { data: key } = await admin
      .from("provider_keys")
      .select("id, org_id")
      .eq("id", fields.providerKeyId)
      .maybeSingle()
    if (!key || key.org_id !== check.access.org.id) return fail("Provider key not found")
  }
  const { error } = await admin
    .from("agents")
    .update({
      handle: fields.handle,
      display_name: fields.displayName,
      provider_key_id: fields.providerKeyId,
      model: fields.model,
      system_prompt: field(formData, "systemPrompt"),
      params: fields.params,
      tool_ids: fields.toolIds,
      webhook_url: fields.webhookUrl,
    })
    .eq("id", agentId)
  if (error) {
    return fail(error.code === "23505" ? `@${fields.handle} already exists` : errorMessage(error))
  }
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent.updated",
    target: fields.handle,
  })
  revalidateOrg(orgSlug)
  return ok("Agent saved")
}

export async function deleteAgentAction(input: {
  orgSlug: string
  agentId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const orgId = check.access.org.id
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, handle")
    .eq("id", input.agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== orgId) return fail("Agent not found")
  // A direct chat with a deleted agent could never get another reply.
  await admin.from("rooms").delete().eq("org_id", orgId).eq("agent_dm_agent_id", input.agentId)
  const { data: debateRooms } = await admin
    .from("rooms")
    .select("id, debate_order")
    .eq("org_id", orgId)
    .contains("debate_order", [input.agentId])
  for (const room of debateRooms ?? []) {
    await admin
      .from("rooms")
      .update({
        debate_order: (room.debate_order as string[]).filter((id) => id !== input.agentId),
      })
      .eq("id", room.id)
  }
  const { error } = await admin.from("agents").delete().eq("id", input.agentId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId,
    actorId: check.access.user.id,
    action: "agent.deleted",
    target: agent.handle,
  })
  revalidateOrg(input.orgSlug)
  return ok("Agent deleted")
}

export async function testAgent(orgSlug: string, agentId: string): Promise<ActionResult> {
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, handle, kind")
    .eq("id", agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== check.access.org.id) return fail("Agent not found")
  if (agent.kind === "external") {
    return fail("External agents are checked in their webhook delivery log")
  }
  const result = await testAgentInOrchestrator(agentId, check.access.org.id)
  if (!result.ok) {
    return fail(`Agent test failed: ${redactSecrets(result.error).text}`)
  }
  return ok(`@${agent.handle} replied in ${result.latencyMs} ms via ${result.model}`, {
    reply: redactSecrets(result.text).text,
  })
}

export async function createBotFromTemplate(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const templateId = field(formData, "templateId")
  const handle = field(formData, "handle").toLowerCase().trim()
  const displayName = field(formData, "displayName").trim()
  const providerKeyId = optionalField(formData, "providerKeyId")
  const model = optionalField(formData, "model")
  const roomId = optionalField(formData, "roomId")
  const rawRoomIds = formData.getAll("roomIds").filter((r): r is string => typeof r === "string" && r.length > 0)
  const roomIds = roomId ? Array.from(new Set([roomId, ...rawRoomIds])) : rawRoomIds

  if (!handleSchema.safeParse(handle).success) {
    return fail("Handle must be lowercase letters, numbers and hyphens, starting with a letter")
  }
  if (RESERVED_HANDLES.has(handle)) return fail("That handle is reserved")
  if (!displayName || displayName.length > 60) return fail("Display name must be 1 to 60 characters")
  const agentGate = await planGate(check.access.org.id, "agents")
  if (!agentGate.ok) return fail(agentGate.message)

  const admin = createAdminClient()

  // 1. Fetch template
  let template: any = null
  if (templateId) {
    const { data } = await admin
      .from("agent_templates")
      .select("*")
      .or(`id.eq.${templateId},slug.eq.${templateId}`)
      .maybeSingle()
    template = data
  }

  // 2. Parse capabilities
  const rawCaps = field(formData, "capabilities")
  let capabilities = template?.default_capabilities ? { ...template.default_capabilities } : { ...DEFAULT_CAPABILITIES }
  if (rawCaps) {
    try {
      capabilities = { ...capabilities, ...JSON.parse(rawCaps) }
    } catch {}
  }
  capabilities = parseCapabilities(capabilities)
  // On Sayabot Cloud an agent computer needs room in the plan; without it the agent is still
  // created, just without a computer, and the reply says why.
  let computerNote: string | null = null
  if (capabilities.computer) {
    const computerGate = await planGate(check.access.org.id, "computers")
    if (!computerGate.ok) {
      capabilities = { ...capabilities, computer: false }
      computerNote = computerGate.message
    }
  }

  const systemPrompt = field(formData, "systemPrompt") || template?.system_prompt || ""
  const selectedModel = model || template?.default_model || "anthropic/claude-3-7-sonnet"

  // 3. Insert agent
  const { data: agent, error: agentError } = await admin
    .from("agents")
    .insert({
      org_id: check.access.org.id,
      handle,
      display_name: displayName,
      kind: "llm",
      system_prompt: systemPrompt,
      model: selectedModel,
      provider_key_id: providerKeyId || null,
      capabilities,
      template_id: template?.id || null,
      owner_user_id: check.access.user.id,
      visibility: "team",
      room_ids: roomIds,
    })
    .select()
    .single()

  if (agentError || !agent) {
    return fail(errorMessage(agentError) || "Failed to create agent")
  }

  // 4. Link rooms
  for (const rid of roomIds) {
    await admin.from("room_agents").insert({
      room_id: rid,
      agent_id: agent.id,
    })
  }

  // 5. Initialize computer if computer capability is enabled
  if (capabilities.computer) {
    await admin.from("agent_computers").insert({
      agent_id: agent.id,
      org_id: check.access.org.id,
      profile: capabilities.browser ? "browser" : "standard",
      status: "none",
      volume: `saaya-bot-${agent.id}`,
    })
  }

  // 6. Bind secret slots if provided
  const rawSecretBindings = field(formData, "secretBindings")
  if (rawSecretBindings && template?.secret_slots) {
    try {
      const bindings = JSON.parse(rawSecretBindings) as Record<string, string>
      for (const slot of template.secret_slots) {
        const secretId = bindings[slot.name]
        if (secretId) {
          const placeholder = `saaya_ph_${randomBytes(16).toString("hex")}`
          await admin.from("agent_secret_grants").insert({
            org_id: check.access.org.id,
            agent_id: agent.id,
            secret_id: secretId,
            env_name: slot.name,
            placeholder,
            allowed_hosts: slot.allowedHosts ?? [],
            inject: slot.inject ?? { mode: "header" },
            requires_approval: false,
          })
        }
      }
    } catch (e) {
      console.warn("[createBotFromTemplate] failed to bind secrets", e)
    }
  }

  // 7. Starter task if provided
  const starterTitle = field(formData, "starterTaskTitle").trim()
  const starterDesc = field(formData, "starterTaskDescription").trim()
  if (starterTitle && roomIds[0]) {
    await admin.from("tasks").insert({
      room_id: roomIds[0],
      title: starterTitle,
      description: starterDesc || null,
      status: "open",
      assignee_agent_id: agent.id,
      lead_agent_id: agent.id,
    })
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent.created_from_template",
    target: agent.handle,
    metadata: { templateSlug: template?.slug, agentId: agent.id },
  })

  revalidateOrg(orgSlug)
  const created = ok(`@${agent.handle} created successfully!`, { agent })
  return computerNote ? { ...created, warning: `Created without its own computer. ${computerNote}` } : created
}

const EFFORTS = new Set<string>(EFFORT_LEVELS)

/**
 * The refresh button in the model picker: reads every model list again now instead of waiting
 * for its schedule (models.dev daily, the model manifest hourly, CLI lists every 6 hours, key
 * lists every 10 minutes, subscription usage every 45 seconds).
 */
export async function refreshModelListsAction(orgSlug: string): Promise<ActionResult> {
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const models = await import("@sayabot/llm/models")
  models.clearProviderModelCache()
  models.clearPlanUsageCache()
  const host = (await headers()).get("x-forwarded-host") ?? (await headers()).get("host")
  const local = localDetectionAllowed(host)
  await Promise.all([
    models.modelCatalog().refresh({ force: true }),
    models.modelManifest().refresh({ force: true }),
    local ? models.codexModelCatalog({ force: true }).catch(() => null) : Promise.resolve(null),
    local ? models.claudeModelCatalog({ force: true }).catch(() => null) : Promise.resolve(null),
  ])
  revalidateOrg(orgSlug)
  return ok("Model lists refreshed")
}

/**
 * The model picker on an agent card: provider account + model + thinking effort, saved
 * straight to the agent. providerKeyId null means "use the server's default model".
 */
export async function setAgentModelAction(input: {
  orgSlug: string
  agentId: string
  providerKeyId: string | null
  model: string | null
  effort?: string | null
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, kind, handle, params")
    .eq("id", input.agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== check.access.org.id) return fail("Agent not found")
  if (agent.kind !== "llm") return fail("Invited agents use the model of their own app")

  const model = input.model?.trim().slice(0, 200) || null
  const params = { ...((agent.params as Record<string, unknown>) ?? {}) }
  if (input.effort !== undefined) {
    if (input.effort && EFFORTS.has(input.effort)) params.effort = input.effort
    else delete params.effort
  }

  // "Run on my computer": the agent answers through an app signed in on the person's own Mac.
  if (input.providerKeyId?.startsWith("host:")) {
    const hostId = input.providerKeyId.slice(5)
    const { data: host } = await admin
      .from("desktop_hosts")
      .select("id, user_id, name, revoked_at")
      .eq("id", hostId)
      .maybeSingle()
    if (!host || host.revoked_at || host.user_id !== check.access.user.id) {
      return fail("You can only pick a computer you set up yourself")
    }
    if (!model || !["claude-code", "codex", "gemini", "opencode", "cursor"].includes(model)) return fail("Pick an app on that computer")
    params.runner = { hostId: host.id, app: model }
    const { error } = await admin
      .from("agents")
      .update({ provider_key_id: null, model: null, params, owner_user_id: check.access.user.id })
      .eq("id", agent.id)
    if (error) return fail(errorMessage(error))
    await audit({
      orgId: check.access.org.id,
      actorId: check.access.user.id,
      action: "agent.runner_set",
      target: agent.id,
      metadata: { hostId: host.id, app: model },
    })
    revalidateOrg(input.orgSlug)
    return ok(`@${agent.handle} now runs on ${host.name}`)
  }
  // "This computer": Claude Code / Codex signed in on the machine Sayabot runs on. No key, no login.
  if (input.providerKeyId?.startsWith("cli:")) {
    const app = input.providerKeyId.slice(4)
    if (app !== "claude-code" && app !== "codex" && app !== "cursor") return fail("Pick Claude Code, Codex or Cursor")
    const requestHeaders = await headers()
    if (!localDetectionAllowed(requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"))) {
      return fail("Apps on this computer are only available when Sayabot runs on your own machine")
    }
    if (model && model !== "default" && !/^[\w./:@~-]{1,120}$/.test(model)) return fail("That model id isn't valid")
    params.runner = { where: "server", app, ...(model && model !== "default" ? { model } : {}) }
    const { error } = await admin
      .from("agents")
      .update({ provider_key_id: null, model: null, params, owner_user_id: check.access.user.id })
      .eq("id", agent.id)
    if (error) return fail(errorMessage(error))
    await audit({
      orgId: check.access.org.id,
      actorId: check.access.user.id,
      action: "agent.runner_set",
      target: agent.id,
      metadata: { where: "server", app, model },
    })
    revalidateOrg(input.orgSlug)
    const appName = app === "codex" ? "Codex" : app === "cursor" ? "Cursor" : "Claude Code"
    return ok(`@${agent.handle} now uses ${appName} on this computer`)
  }
  delete params.runner

  if (input.providerKeyId) {
    const { data: key } = await admin
      .from("provider_keys")
      .select("id, org_id")
      .eq("id", input.providerKeyId)
      .maybeSingle()
    if (!key || key.org_id !== check.access.org.id) return fail("That provider account isn't in this workspace")
    if (!model) return fail("Pick a model")
  }

  // Saya AI (no key): store the alias, never the real id, so .env changes reach this agent.
  // null means "Automatic": follow the server's current default.
  let storedModel: string | null = input.providerKeyId ? model : null
  if (!input.providerKeyId && model) {
    const saya = sayaAi()
    if (!saya) return fail("This server has no Saya AI models set up")
    if (!isSayaModel(model) || !saya.models.some((m) => sayaModelValue(m.alias) === model)) {
      return fail("That Saya AI model isn't offered by this server any more")
    }
    storedModel = model
  }

  const { error } = await admin
    .from("agents")
    .update({ provider_key_id: input.providerKeyId, model: storedModel, params })
    .eq("id", agent.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent.model_changed",
    target: agent.id,
    metadata: { model, providerKeyId: input.providerKeyId, effort: params.effort ?? null },
  })
  revalidateOrg(input.orgSlug)
  const saya = !input.providerKeyId ? sayaAi() : null
  if (saya) return ok(`@${agent.handle} now uses ${sayaModelLabel(saya, storedModel)}`)
  return ok(model ? `@${agent.handle} now uses ${model}` : `@${agent.handle} uses the default model`)
}
