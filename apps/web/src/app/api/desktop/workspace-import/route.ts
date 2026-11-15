import { parseWorkspaceCopy } from "@sayabot/core"
import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { restoreWorkspaceCopy } from "@/lib/workspace-import"

export const dynamic = "force-dynamic"

/** Restores a Cloud copy onto the server this Mac is using now. Existing rows stay. */
export async function POST(request: Request) {
  const host = await hostFromRequest(request)
  if (!host?.org_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { snapshot?: unknown } | null
  const snapshot = parseWorkspaceCopy(body?.snapshot)
  await restoreWorkspaceCopy(host.org_id, snapshot)
  return NextResponse.json({ ok: true })
}
