import { normalizeClient } from "@sayabot/core"
import { generatePollToken } from "@sayabot/core/server"
import { NextResponse } from "next/server"
import { botInviteUrl, inviteState, loadBotInviteByCode, roomContext } from "@/lib/bot-invites"
import { createAdminClient } from "@/lib/supabase/admin"

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } })
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : ""
}

/**
 * A bot asks to join. The first request on a link wins and gets a poll token; any later
 * request (another app, or a copy of the link) is turned away and recorded for the owner.
 */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const invite = await loadBotInviteByCode(code)
  if (!invite) return json({ status: "not_found", message: "This invite link does not exist." }, 404)

  const state = inviteState(invite)
  if (state === "expired" || state === "revoked" || state === "declined") {
    return json({ status: state, message: `This invite link is ${state}. Ask the person for a new link.` }, 410)
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    // Some agents post an empty body; fall back to the names on the invite.
  }
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 200)
  const app = normalizeClient(text(body.app, 40) || invite.app || "generic").id
  const name = text(body.name, 60) || invite.name || "bot"
  const about = text(body.about, 300)
  const admin = createAdminClient()

  if (state !== "waiting") {
    const attempts = [...(invite.rejected_attempts ?? []), { at: new Date().toISOString(), app, userAgent }].slice(-10)
    await admin.from("bot_invites").update({ rejected_attempts: attempts }).eq("id", invite.id)
    return json(
      {
        status: "already_used",
        message:
          "Another app already asked to join with this link, and each link works for one bot only. If you are that bot, keep polling with the token you got the first time. Otherwise ask the person for a new link.",
      },
      409,
    )
  }

  const poll = generatePollToken()
  const { data: claimed } = await admin
    .from("bot_invites")
    .update({
      status: "pending",
      request_name: name,
      request_app: app,
      request_about: about || null,
      request_user_agent: userAgent || null,
      requested_at: new Date().toISOString(),
      poll_token_hash: poll.hash,
    })
    .eq("id", invite.id)
    .eq("status", "waiting")
    .select("id")
    .maybeSingle()
  if (!claimed) return json({ status: "already_used", message: "Another app asked a moment earlier. Ask the person for a new link." }, 409)

  const ctx = await roomContext(invite.room_id)
  const label = normalizeClient(app).label
  await admin.from("messages").insert({
    room_id: invite.room_id,
    sender_type: "system",
    content: `${name} (${label}) is asking to join this room. Approve or decline it in your Inbox.`,
    status: "complete",
    metadata: { botJoinRequest: true, inviteId: invite.id },
  })

  return json({
    status: "pending",
    poll_token: poll.token,
    status_url: `${botInviteUrl(invite.code)}/status`,
    message: `Asked to join "${ctx.roomName}". Tell ${ctx.ownerName}: "I asked to join ${ctx.roomName}. Please approve me in your Sayabot Inbox." Then call status_url with header "authorization: Bearer <poll_token>" (add ?wait=25 to wait) until it says approved. Keep the poll token private.`,
  })
}
