import { decryptSecret } from "@sayabot/llm"
import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { getKek } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

const SOURCES = new Set(["onepassword", "bitwarden", "protonpass"])

/**
 * Hands the computer one queued password lookup, including the token, exactly once.
 * The computer chooses the command from the source name. It never receives a shell line.
 */
export async function POST(request: Request) {
  const host = await hostFromRequest(request)
  if (!host?.org_id) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const admin = createAdminClient()
  const { data: next } = await admin
    .from("desktop_secret_jobs")
    .select("id")
    .eq("host_id", host.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle()
  if (!next) return NextResponse.json({ job: null })
  const { data: job } = await admin
    .from("desktop_secret_jobs")
    .update({ status: "running" })
    .eq("id", next.id)
    .eq("status", "queued")
    .select("id, org_id, connector_id, source, action, query, vault")
    .maybeSingle()
  if (!job || job.org_id !== host.org_id || !SOURCES.has(job.source)) return NextResponse.json({ job: null })

  const { data: connector } = await admin
    .from("workspace_connectors")
    .select("ciphertext, iv, tag, org_id, source, status")
    .eq("id", job.connector_id)
    .maybeSingle()
  if (!connector || connector.org_id !== host.org_id || connector.source !== job.source || connector.status !== "active") {
    await admin.from("desktop_secret_jobs").update({ status: "failed", error: "Connector is not available", finished_at: new Date().toISOString() }).eq("id", job.id)
    return NextResponse.json({ job: null })
  }
  let token = ""
  try {
    token = decryptSecret({ ciphertext: connector.ciphertext, iv: connector.iv, tag: connector.tag }, getKek())
  } catch {
    await admin.from("desktop_secret_jobs").update({ status: "failed", error: "Could not read the saved key", finished_at: new Date().toISOString() }).eq("id", job.id)
    return NextResponse.json({ job: null })
  }
  return NextResponse.json({
    job: { id: job.id, source: job.source, action: job.action, query: job.query, vault: job.vault, token },
  })
}
