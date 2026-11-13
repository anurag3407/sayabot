import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { result?: unknown; error?: string } | null
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const result = body.error ? null : body.result ?? null
  const encoded = JSON.stringify(result ?? null)
  if (encoded.length > 400_000) return NextResponse.json({ error: "result too large" }, { status: 413 })
  const admin = createAdminClient()
  const { data } = await admin
    .from("desktop_mcp_calls")
    .update(
      body.error
        ? { status: "failed", error: body.error.slice(0, 500), finished_at: new Date().toISOString() }
        : { status: "done", result, finished_at: new Date().toISOString() },
    )
    .eq("id", id)
    .eq("host_id", host.id)
    .eq("status", "running")
    .select("id")
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "call not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
