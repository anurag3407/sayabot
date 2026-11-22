import type { PlanLimits } from "@sayabot/core/scanner"
import type { PickerGroup } from "@/lib/model-catalog"

/** Which plan reading belongs to which app signed in on the Mac. */
const PLAN_FOR_APP: Record<string, PlanLimits["provider"]> = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
  pi: "pi",
  omp: "pi",
  cursor: "cursor",
  copilot: "copilot",
  zcode: "zcode",
}

/**
 * Adds the plan limits the Mac app read on this computer to that computer's Claude and Codex
 * groups in the model picker, so you see how much is left before you pick. The server cannot
 * read these (the sign-ins stay on the Mac), so they only show inside the Mac app. With more than
 * one Mac in the workspace we can't tell which group is this one, so nothing is added.
 */
export function withMacPlans(groups: PickerGroup[], limits: PlanLimits[] | null): PickerGroup[] {
  if (!limits?.length) return groups
  const macHosts = new Set(groups.filter((g) => g.section === "mac").map((g) => g.hostId))
  if (macHosts.size !== 1) return groups
  return groups.map((group) => {
    if (group.section !== "mac" || group.plan || !group.keyId) return group
    const app = group.keyId.split(":").pop() ?? ""
    const provider = PLAN_FOR_APP[app]
    const reading = provider ? limits.find((item) => item.provider === provider) : undefined
    if (!reading || (!reading.windows.length && !reading.error)) return group
    return {
      ...group,
      plan: {
        plan: reading.plan,
        windows: reading.windows.map((w) => ({
          label: w.label,
          usedPercent: w.usedPercent,
          resetsAt: w.resetsAt,
        })),
        ...(reading.error && !reading.windows.length ? { error: reading.error } : {}),
      },
    }
  })
}
