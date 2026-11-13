import { sealSecret } from "@sayabot/llm"
import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { getKek } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

/** Seals whatever the password app printed. The plaintext is not stored. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id } = await params
  const body = (await request.json().catch(() => null)) as { result?: unknown; error?: string } | null
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 })
  const admin = createAdminClient()
  const patch = body.error
    ? { status: "failed", error: body.error.slice(0, 500), finished_at: new Date().toISOString() }
    : {
        status: "done",
        result_enc: sealSecret(JSON.stringify(body.result ?? null).slice(0, 200_000), getKek()),
        finished_at: new Date().toISOString(),
      }
  const { data } = await admin
    .from("desktop_secret_jobs")
    .update(patch)
    .eq("id", id)
    .eq("host_id", host.id)
    .eq("status", "running")
    .select("id")
    .maybeSingle()
  if (!data) return NextResponse.json({ error: "job not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
