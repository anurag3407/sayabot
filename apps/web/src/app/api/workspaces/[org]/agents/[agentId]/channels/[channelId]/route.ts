import { NextResponse } from "next/server"
import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { getKek } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

interface ChannelRow {
  id: string
  orgId: string
  source: string
  ciphertext: string
  iv: string
  tag: string
  config: Record<string, unknown> | null
  room_id: string | null
}

async function load(orgId: string, agentId: string, channelId: string): Promise<ChannelRow | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("agent_gateways")
    .select("id, org_id, source, ciphertext, iv, tag, config, room_id")
    .eq("id", channelId)
    .eq("org_id", orgId)
    .eq("agent_id", agentId)
    .maybeSingle()
  if (!data) return null
  return data as unknown as ChannelRow
}

async function telegramToken(row: ChannelRow): Promise<string> {
  return unwrapConnectorSecret(
    decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, getKek()),
  ).token
}

/** Disconnect: stop the webhook/socket, remove the mirrored conversations, then the row. */
export async function DELETE(
  _request: Request,
  context: { params: Promise<{ org: string; agentId: string; channelId: string }> },
) {
  const { org, agentId, channelId } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isOrgAdmin(access.role)) return NextResponse.json({ error: "Admins only" }, { status: 403 })

  const row = await load(access.org.id, agentId, channelId)
  if (!row) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

  const admin = createAdminClient()
  if (row.source === "telegram") {
    try {
      const token = await telegramToken(row)
      const base = (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, "")
      await fetch(`${base}/bot${token}/deleteWebhook`, {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      // The local row still goes; a stale webhook simply points at a 404.
    }
  }

  const { data: chats } = await admin
    .from("external_chats")
    .select("room_id")
    .eq("gateway_id", row.id)
  const roomIds = new Set(((chats ?? []) as { room_id: string }[]).map((chat) => chat.room_id))
  if (row.room_id) roomIds.add(row.room_id)
  if (roomIds.size)
    await admin
      .from("rooms")
      .delete()
      .in("id", [...roomIds])

  const { error } = await admin.from("agent_gateways").delete().eq("id", row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/** Update the allowlists and the silence switch. The token itself is never editable here. */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ org: string; agentId: string; channelId: string }> },
) {
  const { org, agentId, channelId } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isOrgAdmin(access.role)) return NextResponse.json({ error: "Admins only" }, { status: 403 })

  const row = await load(access.org.id, agentId, channelId)
  if (!row) return NextResponse.json({ error: "Channel not found" }, { status: 404 })

  const body = (await request.json().catch(() => null)) as {
    allowedChats?: string[]
    allowedUserIds?: string[]
    silence?: boolean
  } | null
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const clean = (values: unknown): string[] | undefined =>
    Array.isArray(values)
      ? values
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 100)
      : undefined

  const config = { ...(row.config ?? {}) } as Record<string, unknown>
  const chats = clean(body.allowedChats)
  const users = clean(body.allowedUserIds)
  if (chats !== undefined) config.allowedChats = chats
  if (users !== undefined) config.allowedUserIds = users
  if (typeof body.silence === "boolean") config.silence = body.silence

  const admin = createAdminClient()
  const { error } = await admin
    .from("agent_gateways")
    .update({ config, updated_at: new Date().toISOString() })
    .eq("id", row.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, config })
}
