import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { requestMacApproval } from "@/lib/orchestrator"

/**
 * The app on this computer wants to do something that needs its owner's OK (run a command,
 * edit a file). It becomes an approval card in the room, answerable from the web, the phone or
 * this Mac; the computer then polls `approvals/<toolCallId>` for the answer.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const key = typeof body.key === "string" ? body.key : ""
  const toolName = typeof body.toolName === "string" ? body.toolName : ""
  const args =
    body.args && typeof body.args === "object" && !Array.isArray(body.args)
      ? (body.args as Record<string, unknown>)
      : {}
  if (!key || !toolName)
    return NextResponse.json({ error: "key and toolName are required" }, { status: 400 })
  const result = await requestMacApproval(id, host.id, { key, toolName, args })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 })
  }
  return NextResponse.json(result.data)
}
