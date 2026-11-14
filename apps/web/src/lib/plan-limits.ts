import "server-only"
import {
  checkLimit,
  effectivePlan,
  isPlanId,
  limitMessage,
  PLANS,
  upgradeFor,
  usageMonth,
  type LimitKind,
  type PlanId,
} from "@sayabot/core"
import { edition } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Sayabot Cloud plan limits for things a workspace creates (agents, people, agent computers).
 * On a self-hosted server (the default) every check passes without touching the database.
 */

export interface WorkspaceUsage {
  serverTurns: number
  agents: number
  members: number
  computers: number
}

export async function workspacePlan(orgId: string): Promise<{
  plan: PlanId
  status: string
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  customerId: string | null
}> {
  const { data } = await createAdminClient()
    .from("org_plans")
    .select("plan, status, current_period_end, cancel_at_period_end, customer_id")
    .eq("org_id", orgId)
    .maybeSingle()
  const status = (data?.status as string | undefined) ?? "active"
  return {
    plan: effectivePlan(isPlanId(data?.plan) ? data.plan : "free", status),
    status,
    currentPeriodEnd: (data?.current_period_end as string | null) ?? null,
    cancelAtPeriodEnd: data?.cancel_at_period_end === true,
    customerId: (data?.customer_id as string | null) ?? null,
  }
}

export async function workspaceUsage(orgId: string): Promise<WorkspaceUsage> {
  const admin = createAdminClient()
  const [turns, agents, members, computers] = await Promise.all([
    admin
      .from("org_usage_monthly")
      .select("server_turns")
      .eq("org_id", orgId)
      .eq("month", usageMonth())
      .maybeSingle(),
    admin.from("agents").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    admin.from("org_members").select("user_id", { count: "exact", head: true }).eq("org_id", orgId),
    admin
      .from("agent_computers")
      .select("agent_id", { count: "exact", head: true })
      .eq("org_id", orgId),
  ])
  return {
    serverTurns: (turns.data?.server_turns as number | undefined) ?? 0,
    agents: agents.count ?? 0,
    members: members.count ?? 0,
    computers: computers.count ?? 0,
  }
}

const USAGE_KEY: Record<LimitKind, keyof WorkspaceUsage> = {
  serverTurnsPerMonth: "serverTurns",
  agents: "agents",
  members: "members",
  computers: "computers",
}

export type PlanGate =
  { ok: true } | { ok: false; message: string; plan: PlanId; upgradeTo: PlanId | null }

/**
 * Whether the workspace can add one more `kind`. The message is ready to show: what the plan
 * includes and what to do about it.
 */
export async function planGate(orgId: string, kind: LimitKind): Promise<PlanGate> {
  if (edition() !== "cloud") return { ok: true }
  const [{ plan }, usage] = await Promise.all([workspacePlan(orgId), workspaceUsage(orgId)])
  const used = usage[USAGE_KEY[kind]]
  const check = checkLimit("cloud", plan, kind, used)
  if (check.allowed || check.limit === null) return { ok: true }
  const upgradeTo = upgradeFor(plan, kind, used + 1)
  const tail = upgradeTo
    ? ` Upgrade to ${PLANS[upgradeTo].name} in Settings → Plan & billing.`
    : " This is the largest plan; contact us for more."
  return { ok: false, message: `${limitMessage(kind, plan, check.limit)}${tail}`, plan, upgradeTo }
}
