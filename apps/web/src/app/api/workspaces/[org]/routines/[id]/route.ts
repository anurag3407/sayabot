import { NextResponse } from "next/server"
import { getNextCronRun, humanReadableCron, isValidCron, normalizeCronExpression } from "@sayabot/core"
import { getOrgAccess } from "@/lib/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET(
  _request: Request,
  context: { params: Promise<{ org: string; id: string }> },
) {
  const { org, id } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const supabase = await createSupabaseServerClient()
  const [routineRes, runsRes] = await Promise.all([
    supabase
      .from("routines")
      .select(`
        *,
        agents ( id, handle, display_name, avatar_url, model ),
        rooms ( id, name, kind )
      `)
      .eq("id", id)
      .eq("org_id", access.org.id)
      .maybeSingle(),
    supabase
      .from("routine_runs")
      .select("*")
      .eq("routine_id", id)
      .order("started_at", { ascending: false })
      .limit(20),
  ])

  if (routineRes.error) {
    return NextResponse.json({ error: routineRes.error.message }, { status: 500 })
  }
  if (!routineRes.data) {
    return NextResponse.json({ error: "Routine not found" }, { status: 404 })
  }

  return NextResponse.json({
    routine: {
      ...routineRes.data,
      human_schedule: humanReadableCron(routineRes.data.schedule_expr),
    },
    runs: runsRes.data || [],
  })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ org: string; id: string }> },
) {
  const { org, id } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const supabase = await createSupabaseServerClient()
  const { data: existing, error: fetchErr } = await supabase
    .from("routines")
    .select("*")
    .eq("id", id)
    .eq("org_id", access.org.id)
    .maybeSingle()

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Routine not found" }, { status: 404 })
  }

  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  }

  if (typeof body.name === "string" && body.name.trim()) {
    updates.name = body.name.trim()
  }
  if (body.description !== undefined) {
    updates.description = body.description ? String(body.description).trim() : null
  }
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    updates.prompt = body.prompt.trim()
  }
  if (typeof body.agent_id === "string" && body.agent_id) {
    updates.agent_id = body.agent_id
  }
  if (body.room_id !== undefined) {
    updates.room_id = body.room_id || null
  }
  if (typeof body.enabled === "boolean") {
    updates.enabled = body.enabled
  }
  if (body.metadata && typeof body.metadata === "object") {
    updates.metadata = { ...((existing.metadata as object) || {}), ...body.metadata }
  }

  let expr = existing.schedule_expr
  if (typeof body.schedule_expr === "string" && body.schedule_expr.trim()) {
    const norm = normalizeCronExpression(body.schedule_expr)
    if (!isValidCron(norm)) {
      return NextResponse.json(
        { error: `Invalid cron schedule '${body.schedule_expr}'` },
        { status: 400 },
      )
    }
    expr = norm
    updates.schedule_expr = norm
  }

  if (typeof body.timezone === "string" && body.timezone.trim()) {
    updates.timezone = body.timezone.trim()
  }

  if (body.schedule_expr || body.timezone || body.enabled !== undefined) {
    const tz = updates.timezone || existing.timezone
    const isEnabled = updates.enabled !== undefined ? updates.enabled : existing.enabled
    updates.next_run_at = isEnabled ? getNextCronRun(expr, new Date(), tz)?.toISOString() : null
  }

  const { data, error } = await supabase
    .from("routines")
    .update(updates)
    .eq("id", id)
    .select(`
      *,
      agents ( id, handle, display_name, avatar_url, model ),
      rooms ( id, name, kind )
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    routine: {
      ...data,
      human_schedule: humanReadableCron(data.schedule_expr),
    },
  })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ org: string; id: string }> },
) {
  const { org, id } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase
    .from("routines")
    .delete()
    .eq("id", id)
    .eq("org_id", access.org.id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
