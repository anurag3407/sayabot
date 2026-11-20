import { createHash, randomBytes } from "node:crypto"
import { NextResponse } from "next/server"
import { gatewayChatRoomName, isGatewaySource, looksLikeTelegramToken } from "@sayabot/core"
import { decryptSecret, encryptSecret, sealSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { getKek } from "@/lib/env"
import { getPublicOrigin } from "@/lib/public-origin"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * An agent's own Telegram/Discord bot accounts. A token is an identity, so:
 *  - one gateway per (agent, source),
 *  - one agent per token fingerprint, enforced globally,
 *  - a token already used by a workspace connector is refused too, otherwise the same bot would
 *    answer for two different things.
 */

interface GatewayBody {
  source?: string
  token?: string
}

interface ProviderIdentity {
  name: string
}

/** Mirrors of the provider APIs (self-hosted proxy or the E2E harness) can override the base URL. */
const telegramApi = () =>
  (process.env.TELEGRAM_API_BASE ?? "https://api.telegram.org").replace(/\/+$/, "")
const discordApi = () =>
  (process.env.DISCORD_API_BASE ?? "https://discord.com/api/v10").replace(/\/+$/, "")

async function verifyToken(
  source: "telegram" | "discord",
  token: string,
): Promise<ProviderIdentity> {
  if (source === "telegram") {
    if (!looksLikeTelegramToken(token)) {
      throw new Error("That does not look like a Telegram bot token (123456789:AA…)")
    }
    const response = await fetch(`${telegramApi()}/bot${token}/getMe`, {
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean
      description?: string
      result?: { username?: string; first_name?: string }
    } | null
    if (!body?.ok) throw new Error(body?.description ?? "Telegram rejected this token")
    const name = body.result?.username
      ? `@${body.result.username}`
      : (body.result?.first_name ?? "Telegram bot")
    return { name }
  }

  const response = await fetch(`${discordApi()}/users/@me`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Discord rejected this token (HTTP ${response.status})`)
  const body = (await response.json().catch(() => null)) as {
    username?: string
    global_name?: string
  } | null
  return { name: body?.username ?? body?.global_name ?? "Discord bot" }
}

async function setTelegramWebhook(token: string, url: string): Promise<void> {
  const response = await fetch(`${telegramApi()}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, allowed_updates: ["message"] }),
    signal: AbortSignal.timeout(10_000),
  })
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean
    description?: string
  } | null
  if (!body?.ok) {
    throw new Error(body?.description ?? "Telegram could not set the webhook for this bot")
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ org: string; agentId: string }> },
) {
  const { org, agentId } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("agent_gateways")
    .select(
      "id, source, name, status, last4, config, last_seen_at, last_error, webhook_secret_enc, bound_chat_id, room_id",
    )
    .eq("org_id", access.org.id)
    .eq("agent_id", agentId)
    .order("created_at", { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const channels = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: row.id,
    source: row.source,
    name: row.name,
    status: row.status,
    last4: row.last4,
    config: row.config ?? {},
    lastSeenAt: row.last_seen_at ?? null,
    lastError: row.last_error ?? null,
    webhookUrl: row.source === "telegram" && row.webhook_secret_enc ? "set" : null,
    boundChatId: row.bound_chat_id ?? null,
    roomId: row.room_id ?? null,
  }))
  return NextResponse.json({ channels }, { headers: { "cache-control": "no-store" } })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ org: string; agentId: string }> },
) {
  const { org, agentId } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (!isOrgAdmin(access.role)) return NextResponse.json({ error: "Admins only" }, { status: 403 })

  const body = (await request.json().catch(() => null)) as GatewayBody | null
  const source = body?.source
  const token = body?.token?.trim() ?? ""
  if (!isGatewaySource(source))
    return NextResponse.json({ error: "Unknown platform" }, { status: 400 })
  if (!token) return NextResponse.json({ error: "A bot token is required" }, { status: 400 })

  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, handle")
    .eq("id", agentId)
    .eq("org_id", access.org.id)
    .maybeSingle()
  if (!agent) return NextResponse.json({ error: "Agent not found" }, { status: 404 })

  const { data: existing } = await admin
    .from("agent_gateways")
    .select("id")
    .eq("agent_id", agentId)
    .eq("source", source)
    .maybeSingle()
  if (existing) {
    return NextResponse.json(
      { error: `This bot already has a ${source} channel. Disconnect it first.` },
      { status: 409 },
    )
  }

  let identity: ProviderIdentity
  try {
    identity = await verifyToken(source, token)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not verify the token" },
      { status: 400 },
    )
  }

  const fingerprint = createHash("sha256").update(token).digest("hex")
  const { data: shared } = await admin
    .from("agent_gateways")
    .select("id, agent_id")
    .eq("token_fingerprint", fingerprint)
    .maybeSingle()
  if (shared) {
    return NextResponse.json(
      { error: "That bot account is already connected to another agent in this deployment." },
      { status: 409 },
    )
  }

  // A legacy workspace connector may already use the same bot. One identity, one owner.
  const { data: connectors } = await admin
    .from("workspace_connectors")
    .select("id, ciphertext, iv, tag")
    .eq("org_id", access.org.id)
    .eq("source", source)
  for (const row of (connectors ?? []) as {
    id: string
    ciphertext: string
    iv: string
    tag: string
  }[]) {
    try {
      const legacy = unwrapConnectorSecret(
        decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, getKek()),
      ).token
      if (legacy === token) {
        return NextResponse.json(
          { error: "That bot account is already used by a workspace-wide connector." },
          { status: 409 },
        )
      }
    } catch {
      // unreadable legacy row: ignore it rather than blocking the connection
    }
  }

  const kek = getKek()
  const inboundSecret = randomBytes(24).toString("hex")
  const { data: room, error: roomError } = await admin
    .from("rooms")
    .insert({
      org_id: access.org.id,
      name: gatewayChatRoomName(source, agent.handle, identity.name),
      kind: "private",
      turn_mode: "mentions",
      timezone: "UTC",
      created_by: access.user.id,
    })
    .select("id")
    .single()
  if (roomError || !room) {
    return NextResponse.json(
      { error: roomError?.message ?? "Could not open the channel chat" },
      { status: 500 },
    )
  }

  const { data: created, error } = await admin
    .from("agent_gateways")
    .insert({
      org_id: access.org.id,
      agent_id: agentId,
      source,
      name: identity.name,
      status: "active",
      ...encryptSecret(JSON.stringify({ token, inboundSecret }), kek),
      last4: token.slice(-4),
      token_fingerprint: fingerprint,
      webhook_secret_enc: sealSecret(inboundSecret, kek),
      config: {},
      room_id: room.id,
      created_by: access.user.id,
    })
    .select("id, source, name, status, last4, config, created_at, room_id")
    .single()
  if (error || !created) {
    await admin.from("rooms").delete().eq("id", room.id)
    const duplicate = error?.code === "23505"
    return NextResponse.json(
      {
        error: duplicate
          ? "That bot account is already connected."
          : (error?.message ?? "Could not connect"),
      },
      { status: duplicate ? 409 : 500 },
    )
  }

  await admin.from("room_members").insert({
    room_id: room.id,
    user_id: access.user.id,
    role: "admin",
  })
  await admin.from("room_agents").insert({ room_id: room.id, agent_id: agentId, position: 0 })

  if (source === "telegram") {
    const webhookUrl = `${getPublicOrigin(request)}/api/gateways/telegram/${created.id}/${inboundSecret}`
    try {
      await setTelegramWebhook(token, webhookUrl)
    } catch (webhookError) {
      await admin.from("agent_gateways").delete().eq("id", created.id)
      await admin.from("rooms").delete().eq("id", room.id)
      return NextResponse.json(
        {
          error:
            webhookError instanceof Error
              ? webhookError.message
              : "Telegram could not set the webhook for this bot",
        },
        { status: 502 },
      )
    }
  }

  return NextResponse.json(
    { channel: { ...created, webhookUrl: source === "telegram" ? "set" : null } },
    { status: 201 },
  )
}
