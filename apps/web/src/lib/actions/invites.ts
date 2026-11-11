"use server"

import {
  formatInvitationMessage,
  getClientConfigSnippet,
  normalizeClient,
} from "@sayabot/core"
import {
  generateAgentApiKey,
} from "@sayabot/core/server"
import {
  adminRoomAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  revalidateOrg,
} from "@/lib/actions/shared"
import { getAppUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

export async function createRoomBotKey(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const roomId = field(formData, "roomId")
  const client = normalizeClient(field(formData, "client") || "claude-code")
  const rawHandle = field(formData, "handle").toLowerCase().trim()

  const check = await adminRoomAccess(orgSlug, roomId)
  if ("error" in check) return fail(check.error)

  const admin = createAdminClient()

  // 1. Generate unique handle if not provided
  let handle = rawHandle
  if (!handle) {
    const base = client.id.replace(/[^a-z0-9]/g, "")
    handle = `${base}-${Date.now().toString(36).slice(-4)}`
  }

  // 2. Create external agent
  const displayName = rawHandle ? rawHandle.charAt(0).toUpperCase() + rawHandle.slice(1) : client.label
  const { data: agent, error: agentError } = await admin
    .from("agents")
    .insert({
      org_id: check.access.org.id,
      handle,
      display_name: displayName,
      kind: "external",
      visibility: "org",
      owner_user_id: check.access.user.id,
    })
    .select()
    .single()

  if (agentError || !agent) {
    return fail(errorMessage(agentError) || "Failed to register external bot")
  }

  // 3. Link agent to room
  const { error: memberError } = await admin.from("room_agents").insert({
    room_id: roomId,
    agent_id: agent.id,
  })
  if (memberError) {
    await admin.from("agents").delete().eq("id", agent.id)
    return fail(errorMessage(memberError) || "Failed to add the bot to the room")
  }

  // 4. Issue room-scoped agent key
  const generated = generateAgentApiKey()
  const rawApiKey = generated.token
  const keyHash = generated.hash
  const keyPrefix = generated.prefix

  const { error: keyError } = await admin.from("agent_api_keys").insert({
    agent_id: agent.id,
    prefix: keyPrefix,
    key_hash: keyHash,
    room_ids: [roomId],
    scopes: ["room:read", "room:write", "tasks:read", "tasks:write", "canvas:read", "canvas:write", "secrets:use"],
    label: `${client.label} connection key for #${check.access.room.name}`,
  })

  if (keyError) {
    await admin.from("agents").delete().eq("id", agent.id)
    return fail(errorMessage(keyError) || "Failed to create agent API key")
  }

  const appUrl = getAppUrl().replace(/\/+$/, "")
  const connectionUrl = `${appUrl}/mcp/${rawApiKey}`
  const snippet = getClientConfigSnippet(client.id, connectionUrl, "sayabot")
  const prompt = formatInvitationMessage({
    roomName: check.access.room.name,
    timezone: check.access.room.timezone ?? undefined,
    clientName: client.label,
    connectionUrl,
  })

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "invite.bot_key_created",
    target: agent.id,
    metadata: { client: client.id, roomId, handle: agent.handle },
  })

  revalidateOrg(orgSlug)
  return ok("Bot invitation created", {
    apiKey: rawApiKey,
    connectionUrl,
    snippet,
    prompt,
    handle: agent.handle,
    client: client.id,
  })
}
