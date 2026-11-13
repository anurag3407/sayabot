import { NextResponse } from "next/server"
import { sayaAiPublic } from "@/lib/env"
import { userFromRequest } from "@/lib/route-bearer"

export const dynamic = "force-dynamic"

/**
 * The server's Saya AI models for any signed-in client (web, phone, Mac app): names and aliases
 * only. Read live from the server's environment, so clients never need an update to see a new
 * model; the operator changes .env and restarts. Never includes the key, endpoint or real ids.
 */
export async function GET(request: Request) {
  const auth = await userFromRequest(request)
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const saya = sayaAiPublic()
  return NextResponse.json(
    { enabled: Boolean(saya), ...(saya ?? {}) },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
