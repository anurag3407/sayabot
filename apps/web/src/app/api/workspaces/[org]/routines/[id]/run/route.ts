import { NextResponse } from "next/server"
import { getOrgAccess } from "@/lib/auth"
import { runRoutineInOrchestrator } from "@/lib/orchestrator"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function POST(
  _request: Request,
  context: { params: Promise<{ org: string; id: string }> },
) {
  const { org, id } = await context.params
  const access = await getOrgAccess(org)
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const supabase = await createSupabaseServerClient()
  const { data: routine, error } = await supabase
    .from("routines")
    .select("id, name, org_id")
    .eq("id", id)
    .eq("org_id", access.org.id)
    .maybeSingle()

  if (error || !routine) {
    return NextResponse.json({ error: "Routine not found" }, { status: 404 })
  }

  const result = await runRoutineInOrchestrator(routine.id)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Failed to trigger routine execution in orchestrator" },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true, message: `Routine '${routine.name}' executed.` })
}
