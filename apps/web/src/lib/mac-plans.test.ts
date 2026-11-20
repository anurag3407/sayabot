import { describe, expect, it } from "vitest"
import type { PlanLimits } from "@sayabot/core/scanner"
import type { PickerGroup } from "@/lib/model-catalog"
import { withMacPlans } from "./mac-plans"

const group = (
  keyId: string,
  hostId: string,
  section: PickerGroup["section"] = "mac",
): PickerGroup => ({
  keyId,
  provider: "anthropic",
  label: "Claude",
  detail: "",
  section,
  models: [],
  effortLevels: [],
  hostId,
})

const claude: PlanLimits = {
  provider: "claude",
  label: "Claude",
  plan: "max",
  windows: [{ label: "5-hour", usedPercent: 42, resetsAt: null, windowMinutes: 300 }],
  observedAt: "2026-11-15T00:00:00Z",
  error: null,
}

describe("withMacPlans", () => {
  it("adds this Mac's Claude limits to its Claude group", () => {
    const [out] = withMacPlans([group("host:h1:claude-code", "h1")], [claude])
    expect(out?.plan).toEqual({
      plan: "max",
      windows: [{ label: "5-hour", usedPercent: 42, resetsAt: null }],
    })
  })

  it("leaves groups alone with no reading or another app", () => {
    expect(withMacPlans([group("host:h1:codex", "h1")], [claude])[0]?.plan).toBeUndefined()
    expect(withMacPlans([group("host:h1:claude-code", "h1")], null)[0]?.plan).toBeUndefined()
  })

  it("adds nothing when the workspace has more than one Mac", () => {
    const out = withMacPlans(
      [group("host:h1:claude-code", "h1"), group("host:h2:claude-code", "h2")],
      [claude],
    )
    expect(out.every((g) => g.plan === undefined)).toBe(true)
  })
})
