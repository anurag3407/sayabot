import "server-only"
import { revalidatePath } from "next/cache"
import { audit, errorMessage, fail, ok } from "@/lib/actions/shared"
import type { OrgAccess } from "@/lib/types"
import type { ActionResult } from "@/lib/types"
import { agentModelUse } from "@/lib/model-catalog"
import { resolveModelChoice } from "@/lib/model-choice"
import { createAdminClient } from "@/lib/supabase/admin"

export interface RoomBotModel {
  id: string
  handle: string
  displayName: string
  /** Invited agents answer with their own app's model; the picker can't change it. */
  editable: boolean
  /** The bot's own model, in the picker's terms. */
  bot: { keyId: string | null; model: string | null; effort: string | null }
  /** This chat's own pick ("only this chat"), or null when the chat follows the bot. */
  chat: { keyId: string | null; model: string | null; effort: string | null } | null
}

function botFromAgent(agent: Record<string, unknown>, chat: RoomBotModel["chat"]): RoomBotModel {
  const params = (agent.params as Record<string, unknown> | null) ?? {}
  const use = agentModelUse({
    params,
    providerKeyId: (agent.provider_key_id as string | null) ?? null,
    model: (agent.model as string | null) ?? null,
  } as Parameters<typeof agentModelUse>[0])
  return {
    id: String(agent.id),
    handle: String(agent.handle),
    displayName: String(agent.display_name ?? agent.handle),
    editable: agent.kind === "llm",
    bot: { ...use, effort: typeof params.effort === "string" ? params.effort : null },
    chat,
  }
}

function chatOverride(override: Record<string, unknown> | null): RoomBotModel["chat"] {
  if (!override || typeof override !== "object") return null
  return {
    keyId: typeof override.keyId === "string" ? override.keyId : null,
    model: typeof override.model === "string" ? override.model : null,
    effort: typeof override.effort === "string" ? override.effort : null,
  }
}

/** The bots in one chat and the model each answers with there. Null when the room is not in this org. */
export async function loadRoomBotModels(orgId: string, roomId: string): Promise<RoomBotModel[] | null> {
  const admin = createAdminClient()
  const { data: room } = await admin.from("rooms").select("id, org_id").eq("id", roomId).maybeSingle()
  if (!room || room.org_id !== orgId) return null
  const { data: rows } = await admin
    .from("room_agents")
    .select("position, model_override, agents(id, handle, display_name, kind, provider_key_id, model, params)")
    .eq("room_id", room.id)
    .order("position")
  const bots: RoomBotModel[] = []
  for (const row of (rows ?? []) as Array<Record<string, unknown>>) {
    const agent = row.agents as Record<string, unknown> | null
    if (!agent) continue
    bots.push(botFromAgent(agent, chatOverride(row.model_override as Record<string, unknown> | null)))
  }
  return bots
}

/** One bot's default model, for the agent page picker. Null when it is not in this org. */
export async function loadAgentPickerModel(orgId: string, agentId: string): Promise<RoomBotModel | null> {
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, handle, display_name, kind, provider_key_id, model, params")
    .eq("id", agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== orgId) return null
  return botFromAgent(agent as Record<string, unknown>, null)
}

/**
 * Saves a bot's default model. The caller has already checked that this person is an org admin.
 * providerKeyId null means "use the server's default model".
 */
export async function writeAgentModel(input: {
  access: OrgAccess
  requestHost: string | null
  agentId: string
  providerKeyId: string | null
  model: string | null
  effort?: string | null
}): Promise<ActionResult> {
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, org_id, kind, handle, params")
    .eq("id", input.agentId)
    .maybeSingle()
  if (!agent || agent.org_id !== input.access.org.id) return fail("Agent not found")
  if (agent.kind !== "llm") return fail("Invited agents use the model of their own app")

  const resolved = await resolveModelChoice({
    orgId: input.access.org.id,
    userId: input.access.user.id,
    requestHost: input.requestHost,
    keyId: input.providerKeyId,
    model: input.model,
    effort: input.effort,
  })
  if (!resolved.ok) return fail(resolved.error)
  const choice = resolved.choice
  const params = { ...((agent.params as Record<string, unknown>) ?? {}) }
  if (input.effort !== undefined) {
    if (choice.effort) params.effort = choice.effort
    else delete params.effort
  }
  if (choice.runner) params.runner = choice.runner
  else delete params.runner

  const { error } = await admin
    .from("agents")
    .update({
      provider_key_id: choice.providerKeyId,
      model: choice.agentModel,
      params,
      // A Mac only runs its owner's bots, so picking your Mac makes the bot yours.
      ...(choice.macOwnerUserId ? { owner_user_id: choice.macOwnerUserId } : {}),
    })
    .eq("id", agent.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: input.access.org.id,
    actorId: input.access.user.id,
    action: choice.runner ? "agent.runner_set" : "agent.model_changed",
    target: agent.id,
    metadata: { keyId: input.providerKeyId, model: input.model, runner: choice.runner, effort: params.effort ?? null },
  })
  // A chat that followed this bot's default keeps doing so; one with its own model keeps that.
  // Only the bot pages show its model; re-rendering the whole workspace made picks lag.
  revalidatePath(`/${input.access.org.slug}/agents`, "layout")
  return ok(`@${agent.handle} now uses ${choice.label}`)
}

/**
 * The model picker in a chat: this bot's model in this chat only ("only this chat"), or its
 * default everywhere ("chat + bot default", which also drops this chat's own pick so the chat
 * follows the bot). `clear` goes back to the bot's default here.
 */
export async function writeRoomAgentModel(input: {
  access: OrgAccess
  requestHost: string | null
  roomId: string
  agentId: string
  scope: "chat" | "default"
  keyId?: string | null
  model?: string | null
  effort?: string | null
  clear?: boolean
}): Promise<ActionResult> {
  const admin = createAdminClient()
  const [{ data: room }, { data: link }, { data: agent }] = await Promise.all([
    admin.from("rooms").select("id, org_id").eq("id", input.roomId).maybeSingle(),
    admin.from("room_agents").select("agent_id").eq("room_id", input.roomId).eq("agent_id", input.agentId).maybeSingle(),
    admin.from("agents").select("id, org_id, kind, handle, owner_user_id").eq("id", input.agentId).maybeSingle(),
  ])
  if (!room || room.org_id !== input.access.org.id) return fail("Chat not found")
  if (!link || !agent || agent.org_id !== input.access.org.id) return fail("That bot isn't in this chat")
  if (agent.kind !== "llm") return fail("Invited agents use the model of their own app")

  if (input.scope === "default" || input.clear) {
    if (input.scope === "default" && !input.clear) {
      const saved = await writeAgentModel({
        access: input.access,
        requestHost: input.requestHost,
        agentId: agent.id,
        providerKeyId: input.keyId ?? null,
        model: input.model ?? null,
        effort: input.effort ?? null,
      })
      if (!saved.ok) return saved
    }
    const { error } = await admin.from("room_agents").update({ model_override: null }).eq("room_id", room.id).eq("agent_id", agent.id)
    if (error) return fail(errorMessage(error))
    return ok(input.clear ? `@${agent.handle} uses its own model here again` : `@${agent.handle}'s model changed everywhere`)
  }

  const resolved = await resolveModelChoice({
    orgId: input.access.org.id,
    userId: input.access.user.id,
    requestHost: input.requestHost,
    keyId: input.keyId ?? null,
    model: input.model ?? null,
    effort: input.effort,
  })
  if (!resolved.ok) return fail(resolved.error)
  const choice = resolved.choice
  // A chat can't hand someone else's bot to your Mac: a Mac only runs its owner's bots.
  if (choice.macOwnerUserId && agent.owner_user_id !== choice.macOwnerUserId) {
    return fail(`Only @${agent.handle}'s owner can run it on their computer. Use "Chat + bot default" to take it over.`)
  }
  const override = {
    keyId: input.keyId ?? null,
    model: input.model ?? null,
    effort: choice.effort,
    providerKeyId: choice.providerKeyId,
    agentModel: choice.agentModel,
    runner: choice.runner,
  }
  const { error } = await admin.from("room_agents").update({ model_override: override }).eq("room_id", room.id).eq("agent_id", agent.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: input.access.org.id,
    actorId: input.access.user.id,
    action: "room.agent_model_set",
    target: room.id,
    metadata: { agentId: agent.id, keyId: override.keyId, model: override.model, effort: override.effort },
  })
  return ok(`@${agent.handle} uses ${choice.label} in this chat`)
}
