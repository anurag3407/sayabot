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

  it("attaches limits to opencode, pi, cursor, copilot, and zcode", () => {
    const limits: PlanLimits[] = [
      {
        provider: "opencode",
        label: "OpenCode",
        plan: "zen-free",
        windows: [{ label: "5-hour", usedPercent: 15, resetsAt: null, windowMinutes: 300 }],
        observedAt: "2026-11-15T00:00:00Z",
        error: null,
      },
      {
        provider: "pi",
        label: "pi",
        plan: "OpenRouter",
        windows: [{ label: "Credit Limit", usedPercent: 28, resetsAt: null, windowMinutes: null }],
        observedAt: "2026-11-15T00:00:00Z",
        error: null,
      },
      {
        provider: "cursor",
        label: "Cursor",
        plan: "pro",
        windows: [{ label: "Fast Requests", usedPercent: 50, resetsAt: null, windowMinutes: 43200 }],
        observedAt: "2026-11-15T00:00:00Z",
        error: null,
      },
      {
        provider: "copilot",
        label: "Copilot",
        plan: "Individual",
        windows: [{ label: "Hourly Quota", usedPercent: 10, resetsAt: null, windowMinutes: 60 }],
        observedAt: "2026-11-15T00:00:00Z",
        error: null,
      },
      {
        provider: "zcode",
        label: "ZCode",
        plan: "Coding Plan",
        windows: [{ label: "5-hour", usedPercent: 35, resetsAt: null, windowMinutes: 300 }],
        observedAt: "2026-11-15T00:00:00Z",
        error: null,
      },
    ]

    const groups = [
      group("host:h1:opencode", "h1"),
      group("host:h1:pi", "h1"),
      group("host:h1:cursor", "h1"),
      group("host:h1:copilot", "h1"),
      group("host:h1:zcode", "h1"),
    ]

    const out = withMacPlans(groups, limits)
    expect(out[0]?.plan?.plan).toBe("zen-free")
    expect(out[0]?.plan?.windows[0]?.usedPercent).toBe(15)
    expect(out[1]?.plan?.plan).toBe("OpenRouter")
    expect(out[1]?.plan?.windows[0]?.usedPercent).toBe(28)
    expect(out[2]?.plan?.plan).toBe("pro")
    expect(out[2]?.plan?.windows[0]?.usedPercent).toBe(50)
    expect(out[3]?.plan?.plan).toBe("Individual")
    expect(out[3]?.plan?.windows[0]?.usedPercent).toBe(10)
    expect(out[4]?.plan?.plan).toBe("Coding Plan")
    expect(out[4]?.plan?.windows[0]?.usedPercent).toBe(35)
  })

  it("adds nothing when the workspace has more than one Mac", () => {
    const out = withMacPlans(
      [group("host:h1:claude-code", "h1"), group("host:h2:claude-code", "h2")],
      [claude],
    )
    expect(out.every((g) => g.plan === undefined)).toBe(true)
  })
})
