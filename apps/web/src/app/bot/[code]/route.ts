import { botJoinInstructions } from "@sayabot/core"
import { NextResponse } from "next/server"
import { botInviteUrl, inviteState, loadBotInviteByCode, roomContext } from "@/lib/bot-invites"

/** What a bot reads when it opens its invite link: how to ask, wait and collect. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const invite = await loadBotInviteByCode(code)
  const headers = {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex",
  }
  if (!invite) return new NextResponse("This invite link does not exist. Ask the person for a new one.", { status: 404, headers })

  const state = inviteState(invite)
  if (state === "expired" || state === "revoked" || state === "declined") {
    return new NextResponse(
      `This invite link is ${state}. Tell the person who sent it and ask them for a new link.`,
      { status: 410, headers },
    )
  }
  if (state === "joined") {
    return new NextResponse(
      "This invite link was already used to join. If that was you, you are connected already: use your saved Sayabot connection. If not, ask the person for a new link.",
      { status: 409, headers },
    )
  }

  const ctx = await roomContext(invite.room_id)
  const base = botInviteUrl(invite.code)
  return new NextResponse(
    botJoinInstructions({
      roomName: ctx.roomName,
      ownerName: ctx.ownerName,
      joinUrl: `${base}/join`,
      statusUrl: `${base}/status`,
      suggestedName: invite.name,
      suggestedApp: invite.app,
    }),
    { headers },
  )
}
