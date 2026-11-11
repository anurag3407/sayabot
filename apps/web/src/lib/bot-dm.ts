import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"

export async function ensureBotDmRoom(args: {
  orgId: string
  userId: string
  agentId: string
  agentName: string
}): Promise<string> {
  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("rooms")
    .select("id")
    .eq("agent_dm_user_id", args.userId)
    .eq("agent_dm_agent_id", args.agentId)
    .maybeSingle()
  if (existing) {
    await letScopedKeysReachDm(args.agentId, existing.id)
    return existing.id
  }

  const { data: room, error } = await admin
    .from("rooms")
    .insert({
      org_id: args.orgId,
      name: args.agentName,
      kind: "dm",
      turn_mode: "mentions",
      turn_cap: 3,
      timezone: "UTC",
      agent_dm_user_id: args.userId,
      agent_dm_agent_id: args.agentId,
      created_by: args.userId,
    })
    .select("id")
    .single()
  if (error || !room) {
    if (error?.code === "23505") {
      const { data: raced } = await admin
        .from("rooms")
        .select("id")
        .eq("agent_dm_user_id", args.userId)
        .eq("agent_dm_agent_id", args.agentId)
        .maybeSingle()
      if (raced) return raced.id
    }
    throw new Error(error?.message ?? "Could not open the bot chat")
  }
  await admin.from("room_members").insert({ room_id: room.id, user_id: args.userId, role: "admin" })
  await admin.from("room_agents").insert({ room_id: room.id, agent_id: args.agentId, position: 0 })
  await admin.from("room_reads").upsert(
    { user_id: args.userId, room_id: room.id, last_read_at: new Date().toISOString() },
    { onConflict: "user_id,room_id" },
  )
  await letScopedKeysReachDm(args.agentId, room.id)
  return room.id
}

/**
 * Outside bots (Hermes, Claude Code…) connect with keys scoped to the rooms they were invited
 * to. Their private chat with a person is theirs too, so it joins that scope; otherwise a
 * private answer from the Inbox would never reach them.
 */
async function letScopedKeysReachDm(agentId: string, dmRoomId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: keys } = await admin
    .from("agent_api_keys")
    .select("id, room_ids")
    .eq("agent_id", agentId)
    .is("revoked_at", null)
  for (const key of (keys ?? []) as { id: string; room_ids: string[] | null }[]) {
    if (!key.room_ids || key.room_ids.length === 0 || key.room_ids.includes(dmRoomId)) continue
    await admin.from("agent_api_keys").update({ room_ids: [...key.room_ids, dmRoomId] }).eq("id", key.id)
  }
}
