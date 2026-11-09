import { describe, expect, it } from "vitest"
import { reportFindingsSchema, reportFindingsTool, verifyWorkspaceSchema } from "../../src/tools/builtins/verification"

describe("verifyWorkspaceSchema", () => {
  it("accepts 1-6 checks with defaults", () => {
    const ok = verifyWorkspaceSchema.safeParse({ cwd: "/w", checks: [{ kind: "test", command: "npm test" }] })
    expect(ok.success).toBe(true)
    if (ok.success) expect(ok.data.timeoutSeconds).toBe(120)
  })

  it("rejects empty/oversized check lists and unknown kinds", () => {
    expect(verifyWorkspaceSchema.safeParse({ cwd: "/w", checks: [] }).success).toBe(false)
    const seven = Array.from({ length: 7 }, () => ({ kind: "test", command: "x" }))
    expect(verifyWorkspaceSchema.safeParse({ cwd: "/w", checks: seven }).success).toBe(false)
    expect(verifyWorkspaceSchema.safeParse({ cwd: "/w", checks: [{ kind: "deploy", command: "x" }] }).success).toBe(false)
  })

  it("bounds timeoutSeconds to 1..300", () => {
    expect(verifyWorkspaceSchema.safeParse({ cwd: "/w", checks: [{ kind: "build", command: "x" }], timeoutSeconds: 0 }).success).toBe(false)
    expect(verifyWorkspaceSchema.safeParse({ cwd: "/w", checks: [{ kind: "build", command: "x" }], timeoutSeconds: 301 }).success).toBe(false)
  })
})

describe("reportFindingsSchema and report_findings tool", () => {
  it("validates line-anchored finding with verdict and failure scenario", () => {
    const valid = reportFindingsSchema.safeParse({
      level: "high",
      findings: [
        {
          file: "src/auth.ts",
          line: 42,
          summary: "OAuth redirect ignores state param",
          shortSummary: "OAuth state ignored",
          failureScenario: "Attacker passes forged code without state token",
          category: "security",
          verdict: "CONFIRMED",
        },
      ],
    })
    expect(valid.success).toBe(true)
  })

  it("rejects finding missing failureScenario or file", () => {
    const invalid = reportFindingsSchema.safeParse({
      findings: [
        {
          summary: "Something broken",
        },
      ],
    })
    expect(invalid.success).toBe(false)
  })

  it("executes report_findings tool returning confirmed count", async () => {
    const reportTool = reportFindingsTool()
    expect(reportTool.name).toBe("report_findings")

    const result = await reportTool.execute({
      level: "medium",
      findings: [
        {
          file: "src/index.ts",
          line: 10,
          summary: "Null dereference in config parser",
          failureScenario: "Empty config file leads to TypeError: Cannot read properties of undefined",
          verdict: "CONFIRMED",
        },
      ],
    }) as any

    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect(result.summary).toContain("1 confirmed")
  })
})
