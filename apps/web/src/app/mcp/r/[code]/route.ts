import { createAdminClient } from "@/lib/supabase/admin"
import { getAppUrl } from "@/lib/env"
import { generateSetupInstructions } from "@sayabot/core"
import { hashAgentApiKey } from "@sayabot/core/server"
import { type NextRequest, NextResponse } from "next/server"

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const admin = createAdminClient()
  const codeHash = hashAgentApiKey(code)

  const { data: invite } = await admin
    .from("room_invites")
    .select(
      "id, room_id, org_id, client, handle_hint, display_name_hint, expires_at, rooms(name, system_directive)",
    )
    .eq("code_hash", codeHash)
    .is("revoked_at", null)
    .maybeSingle()

  if (!invite) {
    return new NextResponse("Invite not found or revoked", { status: 404 })
  }

  if (new Date(invite.expires_at) < new Date()) {
    return new NextResponse("Invite expired", { status: 410 })
  }

  const room = (invite.rooms as any) || {}
  const appUrl = getAppUrl().replace(/\/+$/, "")
  const accept = req.headers.get("accept") || ""

  const instructions = generateSetupInstructions({
    handle: invite.handle_hint || "outside-bot",
    displayName: invite.display_name_hint || "External Bot",
    roomName: room.name || "Sayabot Room",
    roomId: invite.room_id,
    roomOwnerName: "Workspace Admin",
    timezone: "UTC",
    directive: room.system_directive || "",
    token: code,
    connectionUrl: `${appUrl}/mcp/${code}`,
    client: invite.client || "claude_code",
  })

  // Agents ask for markdown; browsers get the same text inline (text/markdown would download).
  // A browser OAuth hop used to live here, but it sent a fixed public PKCE challenge to a
  // callback route that never existed, so it could not complete and is removed.
  const wantsMarkdown = accept.includes("text/markdown") || req.nextUrl.searchParams.has("raw")
  return new NextResponse(instructions, {
    headers: {
      "content-type": wantsMarkdown ? "text/markdown; charset=utf-8" : "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex",
    },
  })
}
