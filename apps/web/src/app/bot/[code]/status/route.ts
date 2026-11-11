import { BOT_INVITE_WAIT_MAX_SECONDS } from "@sayabot/core"
import { NextResponse } from "next/server"
import {
  collectBotKey,
  inviteState,
  loadBotInviteByCode,
  pollTokenMatches,
  roomContext,
} from "@/lib/bot-invites"

export const maxDuration = 60

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The bot that asked waits here. Approval hands over its connection link and setup steps
 * exactly once; the poll token proves it is the same bot that asked.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const url = new URL(req.url)
  const wait = Math.max(0, Math.min(BOT_INVITE_WAIT_MAX_SECONDS, Number(url.searchParams.get("wait")) || 0))
  const authorization = req.headers.get("authorization")
  const deadline = Date.now() + wait * 1000

  let invite = await loadBotInviteByCode(code)
  if (!invite) return json({ status: "not_found" }, 404)
  if (!pollTokenMatches(invite, authorization)) {
    return json({ status: "unauthorized", message: "Send the poll_token you got when you asked to join, as 'authorization: Bearer <poll_token>'." }, 401)
  }

  while (inviteState(invite) === "pending" && Date.now() < deadline) {
    await sleep(2_000)
    invite = (await loadBotInviteByCode(code)) ?? invite
  }

  const state = inviteState(invite)
  const { ownerName, roomName } = await roomContext(invite.room_id)
  switch (state) {
    case "pending":
      return json({ status: "pending", retry_after_seconds: 5, message: `Waiting for ${ownerName} to approve you in their Inbox.` })
    case "declined":
      return json({ status: "declined", message: `${ownerName} declined this request. Stop and tell them.` })
    case "expired":
    case "revoked":
      return json({ status: state, message: `This link is ${state}. Ask ${ownerName} for a new one.` }, 410)
    case "joined":
      return json({
        status: "joined",
        message: "Your connection details were already handed over once and are not shown again. If you lost them, ask the person to add you again.",
      })
    case "approved": {
      const result = await collectBotKey(invite)
      if (!result.ok) return json({ status: "approved", retry_after_seconds: 3, message: result.reason }, 409)
      return json({
        status: "approved",
        handle: `@${result.handle}`,
        room: roomName,
        connection_url: result.connectionUrl,
        instructions: result.instructions,
        message: "You are approved. This is shown ONCE: save connection_url in your MCP settings now (it is private, never post it), then follow instructions step by step.",
      })
    }
    default:
      return json({ status: "waiting", message: "Ask to join first with a POST to the join link." }, 409)
  }
}
