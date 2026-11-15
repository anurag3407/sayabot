import { parseWorkspaceCopy, planCloudHandoff } from "@sayabot/core"
import { NextResponse } from "next/server"
import { hostFromRequest } from "@/lib/desktop-hosts"
import { edition } from "@/lib/env"
import { workspacePlan } from "@/lib/plan-limits"
import { createAdminClient } from "@/lib/supabase/admin"
import { restoreWorkspaceCopy } from "@/lib/workspace-import"

export const dynamic = "force-dynamic"

async function homeState(userId: string, orgId: string | null) {
  const admin = createAdminClient()
  const { data } = await admin.from("cloud_home_copies").select("restored_at").eq("user_id", userId).maybeSingle()
  const copied = Boolean(data) && !data?.restored_at
  const cloudReady = edition() === "cloud" && Boolean(orgId)
  let planActive = false
  if (cloudReady && orgId) {
    const plan = await workspacePlan(orgId)
    planActive = plan.plan !== "free" && (plan.status === "active" || plan.status === "trialing")
  }
  return { cloudReady, planActive, copied }
}

/** Whether this Mac should copy up, copy back, or leave the Cloud copy alone. */
export async function GET(request: Request) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  return NextResponse.json(await homeState(host.user_id, host.org_id))
}

/** Stores this Mac's bots, chats, routines, and keys once. A second copy while one is held is refused. */
export async function POST(request: Request) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const state = await homeState(host.user_id, host.org_id)
  if (planCloudHandoff(state) !== "copy_to_cloud") {
    return NextResponse.json({ error: "Nothing to copy" }, { status: 409 })
  }
  const body = (await request.json().catch(() => null)) as { snapshot?: unknown } | null
  const snapshot = parseWorkspaceCopy(body?.snapshot)
  const { error } = await createAdminClient().from("cloud_home_copies").upsert({
    user_id: host.user_id,
    org_id: host.org_id,
    snapshot,
    copied_at: new Date().toISOString(),
    restored_at: null,
  })
  if (error) return NextResponse.json({ error: "Could not keep the copy" }, { status: 500 })
  if (host.org_id) {
    await restoreWorkspaceCopy(host.org_id, snapshot).catch(() => {})
  }
  return NextResponse.json({ ok: true })
}

/** Hands the Cloud copy back to the Mac and marks it restored, so a later plan can copy again. */
export async function DELETE(request: Request) {
  const host = await hostFromRequest(request)
  if (!host) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const state = await homeState(host.user_id, host.org_id)
  if (planCloudHandoff(state) !== "copy_back") {
    return NextResponse.json({ error: "Nothing to copy back" }, { status: 409 })
  }
  const admin = createAdminClient()
  const { data } = await admin.from("cloud_home_copies").select("snapshot").eq("user_id", host.user_id).maybeSingle()
  await admin.from("cloud_home_copies").update({ restored_at: new Date().toISOString() }).eq("user_id", host.user_id)
  return NextResponse.json({ snapshot: parseWorkspaceCopy(data?.snapshot) })
}
