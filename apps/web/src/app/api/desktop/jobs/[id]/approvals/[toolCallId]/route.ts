import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { readMacMarker } from "@/lib/mac-runner"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * The computer asks whether its owner answered: pending, approved (with whether they chose
 * "always allow"), or rejected. Only for this host's own job.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; toolCallId: string }> },
) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const { id, toolCallId } = await params
  const { data: call } = await createAdminClient()
    .from("tool_calls")
    .select("id, status, args, error")
    .eq("id", toolCallId)
    .maybeSingle()
  const mark = readMacMarker(call?.args)
  if (!call || !mark || mark.jobId !== id || mark.hostId !== host.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }
  const decided = call.status !== "pending_approval"
  const allowed = decided && call.status !== "rejected"
  return NextResponse.json({
    status: decided ? (allowed ? "approved" : "rejected") : "pending",
    remembered: allowed && (call.args as Record<string, unknown>)._remembered === true,
    message: call.status === "rejected" ? (call.error ?? "Refused") : null,
  })
}
