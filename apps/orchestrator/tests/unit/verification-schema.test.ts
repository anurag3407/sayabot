import { describe, expect, it } from "vitest"
import { verifyWorkspaceSchema } from "../../src/tools/builtins/verification"

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
