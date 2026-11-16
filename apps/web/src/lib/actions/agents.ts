"use server"

import { z } from "zod"
import {
  DEFAULT_CAPABILITIES,
  isWorksOn,
  parseCapabilities,
  redactSecrets,
  type AgentCapabilities,
  type WorksOn,
} from "@sayabot/core"
import { generateWebhookSecret } from "@sayabot/core/server"
import { sealSecret } from "@sayabot/llm"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureBotDmRoom } from "@/lib/bot-dm"
import { planGate } from "@/lib/plan-limits"
import { getKek } from "@/lib/env"
import { headers } from "next/headers"
import { localDetectionAllowed } from "@/lib/local-agents"
import { resolveModelChoice } from "@/lib/model-choice"
import { writeAgentModel, writeRoomAgentModel } from "@/lib/room-models"
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

/** "Research Buddy!" → "research-buddy". Always a valid handle, even for names with no letters. */
function handleFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "")
  const base = /^[a-z]/.test(slug) ? slug : `bot-${slug}`.replace(/-+$/, "")
  return RESERVED_HANDLES.has(base) ? `${base}-bot` : base
}

/**
 * New bot, in one step: a name and a system prompt. The AI it runs on is optional here and is
 * normally picked later from its chat. The bot is not put in any group chat; its own chat with
 * you opens straight away. From a group chat's "Add bot", it joins that chat too.
 */
export async function createBotAction(input: {
  orgSlug: string
  name: string
  instructions?: string
  /**
   * Optional, usually set later from the chat: a provider key id, `host:…` for a Mac app, or
   * left out for the server's default model.
   */
  keyId?: string | null
  model?: string | null
  templateId?: string | null
  capabilities?: Partial<AgentCapabilities>
  /** Optional: also add the bot to this group chat. */
  roomId?: string | null
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const orgId = check.access.org.id

  const displayName = input.name.trim()
  if (!displayName || displayName.length > 60) return fail("Give your bot a name (up to 60 characters)")
  const agentGate = await planGate(orgId, "agents")
  if (!agentGate.ok) return fail(agentGate.message)

  const admin = createAdminClient()

  let template: { id: string; slug: string; system_prompt: string | null; default_capabilities: unknown } | null = null
  if (input.templateId) {
    const { data } = await admin
      .from("agent_templates")
      .select("id, slug, org_id, system_prompt, default_capabilities")
      .eq("id", input.templateId)
      .maybeSingle()
    if (data && (data.org_id === null || data.org_id === orgId)) template = data
  }

  const requestHeaders = await headers()
  const resolved = await resolveModelChoice({
    orgId,
    userId: check.access.user.id,
    requestHost: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    keyId: input.keyId ?? null,
    model: input.model ?? null,
  })
  if (!resolved.ok) return fail(resolved.error)
  const choice = resolved.choice

  let capabilities = parseCapabilities({
    ...DEFAULT_CAPABILITIES,
    ...((template?.default_capabilities as Partial<AgentCapabilities> | null) ?? {}),
    ...(input.capabilities ?? {}),
  })
  // On Sayabot Cloud a computer needs room in the plan; without it the bot is still made.
  let computerNote: string | null = null
  if (capabilities.computer) {
    const computerGate = await planGate(orgId, "computers")
    if (!computerGate.ok) {
      capabilities = { ...capabilities, computer: false }
      computerNote = computerGate.message
    }
  }

  const params: Record<string, unknown> = {}
  if (choice.runner) params.runner = choice.runner
  if (choice.effort) params.effort = choice.effort
  const systemPrompt = (input.instructions ?? "").trim() || template?.system_prompt || ""

  // The handle is made from the name; a clash gets a number (research-buddy-2).
  const base = handleFromName(displayName)
  const { data: taken } = await admin
    .from("agents")
    .select("handle")
    .eq("org_id", orgId)
    .like("handle", `${base}%`)
  const takenSet = new Set((taken ?? []).map((row) => row.handle as string))
  let handle = base
  for (let n = 2; takenSet.has(handle); n++) handle = `${base.slice(0, 34)}-${n}`

  const { data: agent, error: agentError } = await admin
    .from("agents")
    .insert({
      org_id: orgId,
      handle,
      display_name: displayName,
      kind: "llm",
      system_prompt: systemPrompt,
      provider_key_id: choice.providerKeyId,
      model: choice.agentModel,
      params,
      capabilities,
      template_id: template?.id ?? null,
      owner_user_id: choice.macOwnerUserId ?? check.access.user.id,
    })
    .select("id, handle, display_name")
    .single()
  if (agentError || !agent) {
    return fail(agentError?.code === "23505" ? "A bot with that name was just made. Try again." : errorMessage(agentError))
  }

  if (capabilities.computer) {
    await admin.from("agent_computers").insert({
      agent_id: agent.id,
      org_id: orgId,
      profile: capabilities.computer.profile,
      status: "none",
      volume: `saaya-bot-${agent.id}`,
    })
  }

  // From a group chat's "Add bot": join that chat as well.
  let path: string | null = null
  if (input.roomId) {
    const { data: room } = await admin.from("rooms").select("id, org_id, kind").eq("id", input.roomId).maybeSingle()
    if (room && room.org_id === orgId && room.kind !== "dm") {
      const { data: last } = await admin
        .from("room_agents")
        .select("position")
        .eq("room_id", room.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle()
      await admin
        .from("room_agents")
        .insert({ room_id: room.id, agent_id: agent.id, position: (last?.position ?? -1) + 1 })
      path = `/${input.orgSlug}/r/${room.id}`
    }
  }
  if (!path) {
    const dmId = await ensureBotDmRoom({
      orgId,
      userId: check.access.user.id,
      agentId: agent.id,
      agentName: agent.display_name,
    })
    path = `/${input.orgSlug}/r/${dmId}`
  }

  await audit({
    orgId,
    actorId: check.access.user.id,
    action: "agent.created",
    target: agent.handle,
    metadata: { agentId: agent.id, templateSlug: template?.slug ?? null, model: choice.label },
  })
  revalidateOrg(input.orgSlug)
  const created = ok(`${agent.display_name} is ready`, { agentId: agent.id, handle: agent.handle, path })
  return computerNote ? { ...created, warning: `Made without its own computer. ${computerNote}` } : created
}

/** The bot's page: change its name and system prompt. The handle stays, so @mentions keep working. */
export async function updateBotBasicsAction(input: {
  orgSlug: string
  agentId: string
  name: string
  systemPrompt: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const displayName = input.name.trim()
  if (!displayName || displayName.length > 60) return fail("The name must be 1 to 60 characters")
  const systemPrompt = input.systemPrompt.trim().slice(0, 20_000)
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, handle")
    .eq("id", input.agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== check.access.org.id) return fail("Bot not found")
  const { error } = await admin
    .from("agents")
    .update({ display_name: displayName, system_prompt: systemPrompt, updated_at: new Date().toISOString() })
    .eq("id", agent.id)
  if (error) return fail(errorMessage(error))
  // The bot's own chat is named after it.
  await admin.from("rooms").update({ name: displayName }).eq("agent_dm_agent_id", agent.id).eq("kind", "dm")
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent.updated",
    target: agent.handle,
    metadata: { fields: ["display_name", "system_prompt"] },
  })
  revalidateOrg(input.orgSlug)
  return ok("Saved")
}

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
  const requestHeaders = await headers()
  return writeAgentModel({
    access: check.access,
    requestHost: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    agentId: input.agentId,
    providerKeyId: input.providerKeyId,
    model: input.model,
    effort: input.effort,
  })
}

/**
 * The model picker in a chat: this bot's model in this chat only ("only this chat"), or its
 * default everywhere ("chat + bot default", which also drops this chat's own pick so the chat
 * follows the bot). `clear` goes back to the bot's default here.
 */
export async function setRoomAgentModelAction(input: {
  orgSlug: string
  roomId: string
  agentId: string
  scope: "chat" | "default"
  keyId?: string | null
  model?: string | null
  effort?: string | null
  clear?: boolean
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const requestHeaders = await headers()
  return writeRoomAgentModel({
    access: check.access,
    requestHost: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    roomId: input.roomId,
    agentId: input.agentId,
    scope: input.scope,
    keyId: input.keyId,
    model: input.model,
    effort: input.effort,
    clear: input.clear,
  })
}

const WORKS_ON_LABEL: Record<WorksOn, string> = {
  off: "Off",
  auto: "Auto",
  this_computer: "This computer",
  local_vm: "Local VM",
  boat: "Boat",
  vps: "Your own VPS",
}

/** Where this bot's desktop lives. Auto never creates or wakes a Boat; the bot calls select_computer. */
export async function setAgentWorksOnAction(input: {
  orgSlug: string
  agentId: string
  worksOn: string
  thisComputer?: boolean
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  if (!isWorksOn(input.worksOn)) return fail("Pick where this bot works")
  const admin = createAdminClient()
  const { data: agent } = await admin.from("agents").select("id, org_id, params").eq("id", input.agentId).maybeSingle()
  if (!agent || agent.org_id !== check.access.org.id) return fail("Agent not found")
  const params = { ...((agent.params as Record<string, unknown>) ?? {}) }
  params.worksOn = input.worksOn
  const computer = { ...((params.computer as Record<string, unknown>) ?? {}) }
  if (typeof input.thisComputer === "boolean") computer.thisComputer = input.thisComputer
  params.computer = computer
  const { error } = await admin.from("agents").update({ params }).eq("id", agent.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent.works_on",
    target: agent.id,
    metadata: { worksOn: input.worksOn, thisComputer: computer.thisComputer === true },
  })
  revalidateOrg(input.orgSlug)
  return ok(`Works on ${WORKS_ON_LABEL[input.worksOn]}`)
}

const WHEN_MAC_OFF = new Set(["auto", "server", "wait", "fail"])

/** What a bot that runs on someone's Mac does with a message while that Mac is off. */
export async function setAgentWhenMacOffAction(input: {
  orgSlug: string
  agentId: string
  whenMacOff: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  if (!WHEN_MAC_OFF.has(input.whenMacOff)) return fail("Pick what happens when your Mac is off")
  const admin = createAdminClient()
  const { data: agent } = await admin.from("agents").select("id, org_id, handle, params").eq("id", input.agentId).maybeSingle()
  if (!agent || agent.org_id !== check.access.org.id) return fail("Agent not found")
  const params = { ...((agent.params as Record<string, unknown>) ?? {}) }
  if (input.whenMacOff === "auto") delete params.whenMacOff
  else params.whenMacOff = input.whenMacOff
  const { error } = await admin.from("agents").update({ params }).eq("id", agent.id)
  if (error) return fail(errorMessage(error))
  revalidateOrg(input.orgSlug)
  return ok("Saved")
}
