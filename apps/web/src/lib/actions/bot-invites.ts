"use server"

import {
  BOT_INVITE_TTL_DAYS,
  botInviteMessage,
  handleFromName,
  normalizeClient,
  type BotInviteState,
} from "@sayabot/core"
import { generateBotInviteCode } from "@sayabot/core/server"
import { adminRoomAccess, audit, errorMessage, fail, ok, revalidateOrg } from "@/lib/actions/shared"
import { botInviteUrl, inviteState, roomContext, type BotInviteRow } from "@/lib/bot-invites"
import { createAdminClient } from "@/lib/supabase/admin"
import type { ActionResult } from "@/lib/types"

export interface BotInviteView {
  id: string
  roomId: string
  url: string
  message: string
  name: string | null
  app: string | null
  appLabel: string
  state: BotInviteState
  requestName: string | null
  requestAppLabel: string | null
  requestAbout: string | null
  requestedAt: string | null
  rejectedAttempts: number
  agentHandle: string | null
  expiresAt: string
}

async function viewOf(row: BotInviteRow): Promise<BotInviteView> {
  const ctx = await roomContext(row.room_id)
  const url = botInviteUrl(row.code)
  let agentHandle: string | null = null
  if (row.agent_id) {
    const { data } = await createAdminClient().from("agents").select("handle").eq("id", row.agent_id).maybeSingle()
    agentHandle = data?.handle ?? null
  }
  return {
    id: row.id,
    roomId: row.room_id,
    url,
    message: botInviteMessage({ roomName: ctx.roomName, ownerName: ctx.ownerName, url }),
    name: row.name,
    app: row.app,
    appLabel: normalizeClient(row.app ?? "generic").label,
    state: inviteState(row),
    requestName: row.request_name,
    requestAppLabel: row.request_app ? normalizeClient(row.request_app).label : null,
    requestAbout: row.request_about,
    requestedAt: row.requested_at,
    rejectedAttempts: row.rejected_attempts?.length ?? 0,
    agentHandle,
    expiresAt: row.expires_at,
  }
}

async function loadRow(inviteId: string): Promise<BotInviteRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(inviteId)) return null
  const { data } = await createAdminClient().from("bot_invites").select("*").eq("id", inviteId).maybeSingle()
  return (data as BotInviteRow | null) ?? null
}

/** "Add an agent": makes a single-use link to paste into the bot's own chat. */
export async function createBotInviteAction(input: {
  orgSlug: string
  roomId: string
  name?: string
  app?: string
}): Promise<ActionResult> {
  const check = await adminRoomAccess(input.orgSlug, input.roomId)
  if ("error" in check) return fail(check.error)
  const name = input.name?.trim().slice(0, 60) || null
  const app = input.app ? normalizeClient(input.app).id : null
  const { data, error } = await createAdminClient()
    .from("bot_invites")
    .insert({
      org_id: check.access.org.id,
      room_id: input.roomId,
      code: generateBotInviteCode(),
      name,
      app,
      created_by: check.access.user.id,
      expires_at: new Date(Date.now() + BOT_INVITE_TTL_DAYS * 86_400_000).toISOString(),
    })
    .select("*")
    .single()
  if (error || !data) return fail(errorMessage(error) || "Could not create the link")
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "bot_invite.created",
    target: data.id,
    metadata: { roomId: input.roomId, app, name },
  })
  return ok("Link ready", { invite: await viewOf(data as BotInviteRow) })
}

/** Polled by the add-agent dialog so it flips to "asked to join" without a reload. */
export async function botInviteStatusAction(input: { orgSlug: string; inviteId: string }): Promise<ActionResult> {
  const row = await loadRow(input.inviteId)
  if (!row) return fail("Link not found")
  const check = await adminRoomAccess(input.orgSlug, row.room_id)
  if ("error" in check) return fail(check.error)
  return ok(undefined, { invite: await viewOf(row) })
}

async function uniqueHandle(orgId: string, base: string): Promise<string> {
  const admin = createAdminClient()
  const root = handleFromName(base)
  for (let i = 0; i < 30; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`
    const { data } = await admin.from("agents").select("id").eq("org_id", orgId).eq("handle", candidate).maybeSingle()
    if (!data) return candidate
  }
  return `${root}-${Date.now().toString(36).slice(-4)}`
}

/** Approve or decline a bot that asked to join. Approval adds it to the room; its key is minted when it collects. */
export async function decideBotInviteAction(input: {
  orgSlug: string
  inviteId: string
  approve: boolean
}): Promise<ActionResult> {
  const row = await loadRow(input.inviteId)
  if (!row) return fail("Request not found")
  const check = await adminRoomAccess(input.orgSlug, row.room_id)
  if ("error" in check) return fail(check.error)
  if (inviteState(row) !== "pending") return fail("This request was already handled or has expired")

  const admin = createAdminClient()
  const now = new Date().toISOString()

  if (!input.approve) {
    await admin
      .from("bot_invites")
      .update({ status: "declined", decided_by: check.access.user.id, decided_at: now })
      .eq("id", row.id)
      .eq("status", "pending")
    await audit({
      orgId: row.org_id,
      actorId: check.access.user.id,
      action: "bot_invite.declined",
      target: row.id,
      metadata: { roomId: row.room_id, app: row.request_app },
    })
    revalidateOrg(input.orgSlug)
    return ok("Declined")
  }

  const displayName = row.name || row.request_name || "Bot"
  const handle = await uniqueHandle(row.org_id, displayName)
  const { data: agent, error: agentError } = await admin
    .from("agents")
    .insert({
      org_id: row.org_id,
      handle,
      display_name: displayName,
      kind: "external",
      visibility: "org",
      owner_user_id: check.access.user.id,
      bio: row.request_about,
    })
    .select("id, handle")
    .single()
  if (agentError || !agent) return fail(errorMessage(agentError) || "Could not add the bot")

  const { error: memberError } = await admin.from("room_agents").insert({ room_id: row.room_id, agent_id: agent.id })
  if (memberError) {
    await admin.from("agents").delete().eq("id", agent.id)
    return fail(errorMessage(memberError))
  }

  const { data: updated } = await admin
    .from("bot_invites")
    .update({ status: "approved", agent_id: agent.id, decided_by: check.access.user.id, decided_at: now })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle()
  if (!updated) {
    await admin.from("agents").delete().eq("id", agent.id)
    return fail("This request changed while you were deciding. Refresh and try again.")
  }

  await audit({
    orgId: row.org_id,
    actorId: check.access.user.id,
    action: "bot_invite.approved",
    target: agent.id,
    metadata: { roomId: row.room_id, inviteId: row.id, app: row.request_app, handle },
  })
  revalidateOrg(input.orgSlug)
  return ok(`Approved @${agent.handle}. It connects on its next check.`, { handle: agent.handle })
}

export async function revokeBotInviteAction(input: { orgSlug: string; inviteId: string }): Promise<ActionResult> {
  const row = await loadRow(input.inviteId)
  if (!row) return fail("Link not found")
  const check = await adminRoomAccess(input.orgSlug, row.room_id)
  if ("error" in check) return fail(check.error)
  if (!["waiting", "pending"].includes(row.status)) return fail("This link can no longer be cancelled")
  await createAdminClient().from("bot_invites").update({ status: "revoked" }).eq("id", row.id)
  revalidateOrg(input.orgSlug)
  return ok("Link cancelled")
}
