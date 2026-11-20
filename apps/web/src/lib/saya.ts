import "server-only"

import {
  SAYA_CAPABILITIES,
  SAYA_DISPLAY_NAME,
  SAYA_HANDLE,
  SAYA_SYSTEM_PROMPT,
} from "@sayabot/core"
import { createAdminClient } from "@/lib/supabase/admin"

type AdminClient = ReturnType<typeof createAdminClient>

/**
 * Every workspace gets the same orchestrator agent. This makes `saya` idempotent: the row is
 * created once, then re-used by later calls (a new room, a second workspace, a retried action).
 *
 * Saya is an ordinary `agents` row, so it appears in the roster, takes turns through the normal
 * coordinator, and its tools go through the same audit and approval pipeline. The only extra is
 * the `orchestrator` capability that unlocks the `sayabot_*` admin tools.
 */
export async function ensureSayaAgent(
  input: { orgId: string; userId?: string | null; roomId?: string | null },
  client?: AdminClient,
): Promise<{ id: string; created: boolean }> {
  const admin = client ?? createAdminClient()

  const { data: existing } = await admin
    .from("agents")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("handle", SAYA_HANDLE)
    .maybeSingle()

  let agentId = (existing?.id as string | undefined) ?? undefined
  let created = false

  if (!agentId) {
    const { data, error } = await admin
      .from("agents")
      .insert({
        org_id: input.orgId,
        handle: SAYA_HANDLE,
        display_name: SAYA_DISPLAY_NAME,
        kind: "llm",
        system_prompt: SAYA_SYSTEM_PROMPT,
        params: {},
        capabilities: SAYA_CAPABILITIES,
        visibility: "org",
        owner_user_id: input.userId ?? null,
      })
      .select("id")
      .single()
    if (error || !data) {
      throw new Error(error?.message ?? "Could not create the workspace orchestrator")
    }
    agentId = data.id as string
    created = true
  }

  if (input.roomId) {
    await admin
      .from("room_agents")
      .upsert(
        { room_id: input.roomId, agent_id: agentId, position: 0 },
        { onConflict: "room_id,agent_id" },
      )
  }

  return { id: agentId, created }
}
