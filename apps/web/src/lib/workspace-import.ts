import "server-only"
import { materializeCopy, type WorkspaceCopy } from "@sayabot/core"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Inserts a Mac's bots, chats, routines, and sealed keys into this workspace.
 * A row that is already here is left as it is.
 */
export async function restoreWorkspaceCopy(orgId: string, incoming: WorkspaceCopy): Promise<void> {
  const admin = createAdminClient()
  const [bots, chats, routines, keys, computers] = await Promise.all([
    admin.from("agents").select("id, handle").eq("org_id", orgId).limit(500),
    admin.from("rooms").select("id").eq("org_id", orgId).limit(500),
    admin.from("routines").select("id").eq("org_id", orgId).limit(500),
    admin.from("provider_keys").select("id").eq("org_id", orgId).limit(200),
    admin
      .from("org_computer_settings")
      .select("org_id, boat_ciphertext, vps_ssh_alias")
      .eq("org_id", orgId)
      .maybeSingle(),
  ])
  const plan = materializeCopy(
    {
      botIds: (bots.data ?? []).map((row) => row.id as string),
      handles: (bots.data ?? []).map((row) => row.handle as string),
      chatIds: (chats.data ?? []).map((row) => row.id as string),
      routineIds: (routines.data ?? []).map((row) => row.id as string),
      keyIds: (keys.data ?? []).map((row) => row.id as string),
      computerSettings: Boolean(computers.data?.boat_ciphertext || computers.data?.vps_ssh_alias),
    },
    incoming,
  )
  for (const key of plan.keys) {
    await admin.from("provider_keys").insert({
      id: key.id,
      org_id: orgId,
      provider: key.provider,
      label: key.label,
      ciphertext: key.ciphertext,
      iv: key.iv,
      tag: key.tag,
      last4: key.last4,
      base_url: key.baseUrl,
    })
  }
  for (const bot of plan.bots) {
    await admin.from("agents").insert({
      id: bot.id,
      org_id: orgId,
      handle: bot.handle,
      display_name: bot.displayName,
      kind: bot.kind,
      model: bot.model,
      system_prompt: bot.systemPrompt,
      params: bot.params,
      bio: bot.bio,
      provider_key_id: bot.providerKeyId,
    })
  }
  for (const chat of plan.chats) {
    const inserted = await admin
      .from("rooms")
      .insert({ id: chat.id, org_id: orgId, name: chat.name, kind: chat.kind })
      .select("id")
    if (inserted.error) continue
    for (const message of chat.messages) {
      await admin.from("messages").insert({
        id: message.id,
        room_id: chat.id,
        sender_type: message.senderType,
        content: message.content,
        created_at: message.createdAt ?? undefined,
      })
    }
  }
  for (const routine of plan.routines) {
    await admin.from("routines").insert({
      id: routine.id,
      org_id: orgId,
      name: routine.name,
      agent_id: routine.agentId,
      room_id: routine.roomId,
      schedule_expr: routine.scheduleExpr,
      prompt: routine.prompt,
      timezone: routine.timezone,
      enabled: routine.enabled,
    })
  }
  if (plan.computers) {
    await admin.from("org_computer_settings").upsert({
      org_id: orgId,
      boat_ciphertext: plan.computers.boatCiphertext,
      boat_iv: plan.computers.boatIv,
      boat_tag: plan.computers.boatTag,
      boat_last4: plan.computers.boatLast4,
      vps_ssh_alias: plan.computers.vpsSshAlias,
      vps_start_automatically: plan.computers.vpsStartAutomatically,
      updated_at: new Date().toISOString(),
    })
  }
}
