import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

/**
 * This Mac's bots, chats, routines, and sealed keys. The desktop sends this once when Cloud is ready.
 * Key material stays in its envelope. Nothing here is decrypted.
 */
export async function GET(request: Request) {
  const host = await hostFromRequest(request)
  if (!host?.org_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const admin = createAdminClient()
  const orgId = host.org_id
  const [bots, chats, routines, keys, computers] = await Promise.all([
    admin
      .from("agents")
      .select("id, handle, display_name, kind, model, system_prompt, params, bio, provider_key_id")
      .eq("org_id", orgId)
      .limit(200),
    admin.from("rooms").select("id, name, kind").eq("org_id", orgId).limit(200),
    admin
      .from("routines")
      .select("id, name, agent_id, room_id, schedule_expr, prompt, timezone, enabled")
      .eq("org_id", orgId)
      .limit(200),
    admin
      .from("provider_keys")
      .select("id, provider, label, ciphertext, iv, tag, last4, base_url")
      .eq("org_id", orgId)
      .limit(50),
    admin
      .from("org_computer_settings")
      .select(
        "boat_ciphertext, boat_iv, boat_tag, boat_last4, vps_ssh_alias, vps_start_automatically",
      )
      .eq("org_id", orgId)
      .maybeSingle(),
  ])
  const roomIds = (chats.data ?? []).map((room) => room.id as string)
  const messages = roomIds.length
    ? await admin
        .from("messages")
        .select("id, room_id, sender_type, content, created_at")
        .in("room_id", roomIds)
        .order("created_at", { ascending: false })
        .limit(600)
    : { data: [] }
  const byRoom = new Map<string, Array<Record<string, unknown>>>()
  for (const message of messages.data ?? []) {
    const roomId = message.room_id as string
    const list = byRoom.get(roomId) ?? []
    if (list.length >= 30) continue
    list.push({
      id: message.id,
      senderType: message.sender_type,
      content: message.content,
      createdAt: message.created_at,
    })
    byRoom.set(roomId, list)
  }
  return NextResponse.json({
    snapshot: {
      bots: (bots.data ?? []).map((bot) => ({
        id: bot.id,
        handle: bot.handle,
        displayName: bot.display_name,
        kind: bot.kind,
        model: bot.model,
        systemPrompt: bot.system_prompt,
        params: bot.params,
        bio: bot.bio,
        providerKeyId: bot.provider_key_id,
      })),
      chats: (chats.data ?? []).map((room) => ({
        id: room.id,
        name: room.name,
        kind: room.kind,
        messages: byRoom.get(room.id as string) ?? [],
      })),
      routines: (routines.data ?? []).map((routine) => ({
        id: routine.id,
        name: routine.name,
        agentId: routine.agent_id,
        roomId: routine.room_id,
        scheduleExpr: routine.schedule_expr,
        prompt: routine.prompt,
        timezone: routine.timezone,
        enabled: routine.enabled,
      })),
      keys: (keys.data ?? []).map((key) => ({
        id: key.id,
        provider: key.provider,
        label: key.label,
        ciphertext: key.ciphertext,
        iv: key.iv,
        tag: key.tag,
        last4: key.last4,
        baseUrl: key.base_url,
      })),
      computers: computers.data
        ? {
            boatCiphertext: computers.data.boat_ciphertext,
            boatIv: computers.data.boat_iv,
            boatTag: computers.data.boat_tag,
            boatLast4: computers.data.boat_last4,
            vpsSshAlias: computers.data.vps_ssh_alias,
            vpsStartAutomatically: computers.data.vps_start_automatically === true,
          }
        : null,
    },
  })
}
