import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { macAllowRuleFor, readMacMarker } from "@/lib/mac-runner-shared"

export { macAllowRuleFor, readMacMarker, type MacMarker } from "@/lib/mac-runner-shared"

/**
 * Agents running on their owner's Mac (Sayabot for Mac): what the Mac may do without asking,
 * and who may answer when it does ask.
 */

const MAX_RULES = 50
const RULE = /^[A-Za-z][\w-]{0,80}(\([^()\n]{1,200}\))?$/

/** The agent's saved "always allow" rules, in Claude Code's --allowedTools syntax. */
export function macAllowRules(params: Record<string, unknown> | null | undefined): string[] {
  const raw = params?.localAllow
  if (!Array.isArray(raw)) return []
  return raw
    .filter((rule): rule is string => typeof rule === "string" && RULE.test(rule))
    .slice(0, MAX_RULES)
}

/**
 * Only the person whose Mac it is can answer an approval from a Mac run: an admin of a shared
 * room must not be able to run commands on someone else's computer. Not a Mac card: null.
 */
export async function macApprovalBlock(args: unknown, userId: string): Promise<string | null> {
  const mark = readMacMarker(args)
  if (!mark) return null
  const { data: host } = await createAdminClient()
    .from("desktop_hosts")
    .select("user_id, name, revoked_at")
    .eq("id", mark.hostId)
    .maybeSingle()
  if (!host || host.revoked_at) return "That computer was removed from Sayabot"
  if (host.user_id !== userId) {
    return `Only the owner of ${host.name} can allow what runs on it`
  }
  return null
}

/** "Always allow": saves the narrowest rule for this kind of step on the agent. */
export async function rememberMacAllow(
  args: unknown,
  toolName: string,
): Promise<{ ok: true; rule: string } | { ok: false; error: string }> {
  const mark = readMacMarker(args)
  if (!mark) return { ok: false, error: "Not a step from a Mac" }
  const rule = macAllowRuleFor(toolName, args)
  if (!rule) return { ok: false, error: "This step can only be allowed once" }
  const admin = createAdminClient()
  const { data: agent } = await admin
    .from("agents")
    .select("id, params")
    .eq("id", mark.agentId)
    .maybeSingle()
  if (!agent) return { ok: false, error: "Agent not found" }
  const params = { ...((agent.params as Record<string, unknown> | null) ?? {}) }
  const rules = macAllowRules(params)
  if (!rules.includes(rule)) params.localAllow = [...rules, rule].slice(-MAX_RULES)
  const { error } = await admin.from("agents").update({ params }).eq("id", agent.id)
  return error ? { ok: false, error: error.message } : { ok: true, rule }
}
