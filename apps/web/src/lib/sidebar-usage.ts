import "server-only"
import { PLANS } from "@sayabot/core"
import { edition } from "@/lib/env"
import { workspacePlan, workspaceUsage } from "@/lib/plan-limits"
import { loadUsageRollup } from "@/lib/usage"

/** This month at a glance, for the sidebar's Usage row. Never throws: null hides the numbers. */
export interface SidebarUsage {
  replies: number
  tokens: number
  costUsd: number
  /** Sayabot Cloud: server replies used of the plan's monthly allowance. */
  plan: { name: string; used: number; limit: number } | null
}

export async function loadSidebarUsage(orgId: string): Promise<SidebarUsage | null> {
  try {
    const now = new Date()
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
    const cloud = edition() === "cloud"
    const [rows, planInfo] = await Promise.all([
      loadUsageRollup(orgId, monthStart),
      cloud
        ? Promise.all([workspacePlan(orgId), workspaceUsage(orgId)]).catch(() => null)
        : Promise.resolve(null),
    ])
    let replies = 0
    let tokens = 0
    let costUsd = 0
    for (const row of rows ?? []) {
      if (row.kind === "llm") replies += row.requests
      tokens += row.input_tokens + row.output_tokens
      costUsd += row.cost_usd
    }
    let plan: SidebarUsage["plan"] = null
    if (planInfo) {
      const [{ plan: planId }, usage] = planInfo
      const limit = PLANS[planId].limits.serverTurnsPerMonth
      if (limit !== null) plan = { name: PLANS[planId].name, used: usage.serverTurns, limit }
    }
    return { replies, tokens, costUsd, plan }
  } catch {
    return null
  }
}
