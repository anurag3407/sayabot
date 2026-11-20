import { describe, expect, it } from "vitest"
import type { PlanItem } from "@sayabot/core"
import { isPlanFinished, shouldNudgePlan } from "./plan-tool"

describe("Planning Tool (E8)", () => {
  it("nudges for a plan after 8 steps when no plan exists", () => {
    expect(shouldNudgePlan(5, [])).toBe(false)
    expect(shouldNudgePlan(8, null)).toBe(false)
    expect(shouldNudgePlan(9, null)).toBe(true)
    expect(shouldNudgePlan(9, [])).toBe(true)
  })

  it("does not nudge when a plan already exists", () => {
    const plan: PlanItem[] = [{ id: "1", title: "Write tests", status: "in_progress" }]
    expect(shouldNudgePlan(12, plan)).toBe(false)
  })

  it("determines when a plan is completely finished", () => {
    expect(isPlanFinished(null)).toBe(false)
    expect(isPlanFinished([])).toBe(false)

    const ongoing: PlanItem[] = [
      { id: "1", title: "Step 1", status: "done" },
      { id: "2", title: "Step 2", status: "in_progress" },
    ]
    expect(isPlanFinished(ongoing)).toBe(false)

    const allDone: PlanItem[] = [
      { id: "1", title: "Step 1", status: "done" },
      { id: "2", title: "Step 2", status: "done" },
    ]
    expect(isPlanFinished(allDone)).toBe(true)
  })
})
