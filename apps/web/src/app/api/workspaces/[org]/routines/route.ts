import { NextResponse } from "next/server"
import { getNextCronRun, humanReadableCron, isValidCron, normalizeCronExpression } from "@sayabot/core"
import { getOrgAccess } from "@/lib/auth"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function GET(_request: Request, context: { params: Promise<{ org: string }> }) {
  const { org } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const supabase = await createSupabaseServerClient()
  const { data: routinesData, error } = await supabase
    .from("routines")
    .select(`
      id,
      name,
      description,
      schedule_expr,
      schedule_kind,
      timezone,
      prompt,
      enabled,
      next_run_at,
      last_run_at,
      last_status,
      last_error,
      run_count,
      metadata,
      created_at,
      updated_at,
      agents (
        id,
        handle,
        display_name,
        avatar_url,
        model
      ),
      rooms (
        id,
        name,
        kind
      )
    `)
    .eq("org_id", access.org.id)
    .order("created_at", { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const enriched = (routinesData || []).map((r: any) => ({
    ...r,
    human_schedule: humanReadableCron(r.schedule_expr),
  }))

  return NextResponse.json({ routines: enriched })
}

export async function POST(request: Request, context: { params: Promise<{ org: string }> }) {
  const { org } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const { name, description, schedule_expr, timezone, agent_id, room_id, prompt, metadata } = body

  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 })
  }
  if (!schedule_expr || typeof schedule_expr !== "string") {
    return NextResponse.json({ error: "Schedule expression is required" }, { status: 400 })
  }
  if (!agent_id || typeof agent_id !== "string") {
    return NextResponse.json({ error: "Target agent is required" }, { status: 400 })
  }
  if (!prompt || typeof prompt !== "string") {
    return NextResponse.json({ error: "Prompt instruction is required" }, { status: 400 })
  }

  const normExpr = normalizeCronExpression(schedule_expr)
  if (!isValidCron(normExpr)) {
    return NextResponse.json(
      {
        error: `Invalid schedule '${schedule_expr}'. Use standard cron (e.g. '0 9 * * 1-5') or natural shorthand ('daily at 9am', 'every 2h').`,
      },
      { status: 400 },
    )
  }

  const tz = timezone || "UTC"
  const nextRun = getNextCronRun(normExpr, new Date(), tz)

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from("routines")
    .insert({
      org_id: access.org.id,
      name: name.trim(),
      description: description?.trim() || null,
      schedule_expr: normExpr,
      schedule_kind: "cron",
      timezone: tz,
      agent_id,
      room_id: room_id || null,
      prompt: prompt.trim(),
      enabled: true,
      next_run_at: nextRun?.toISOString() || null,
      metadata: metadata || {},
      created_by_user_id: access.user.id,
    })
    .select(`
      id,
      name,
      description,
      schedule_expr,
      timezone,
      prompt,
      enabled,
      next_run_at,
      metadata,
      agents ( id, handle, display_name, avatar_url, model ),
      rooms ( id, name, kind )
    `)
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(
    {
      routine: {
        ...data,
        human_schedule: humanReadableCron(data.schedule_expr),
      },
    },
    { status: 201 },
  )
}
