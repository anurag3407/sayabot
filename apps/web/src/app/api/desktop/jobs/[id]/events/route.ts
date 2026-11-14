import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { recordMacToolEvents } from "@/lib/orchestrator"

/**
 * What the app on this computer is doing for a running job (each step it takes, and how it
 * ended), shown live in the room as tool cards. The orchestrator checks the job is this host's.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { events?: unknown }
  if (!Array.isArray(body.events) || body.events.length > 50) {
    return NextResponse.json({ error: "invalid events" }, { status: 400 })
  }
  const result = await recordMacToolEvents(id, host.id, body.events)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status || 502 })
  }
  return NextResponse.json(result.data)
}
