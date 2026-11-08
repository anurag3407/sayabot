import { describe, expect, it } from "vitest"
import { workspaceScopeSchema, WORKTREE_ROOT } from "../../src/tools/builtins/workspace"

const SHA = "a".repeat(40)
const WT = WORKTREE_ROOT + "/" + "123e4567-e89b-12d3-a456-426614174000"
const valid = { repo: "/home/bot/repo", worktree: WT, baseSha: SHA }

describe("workspaceScopeSchema", () => {
  it("accepts a canonical scope", () => {
    expect(workspaceScopeSchema.safeParse(valid).success).toBe(true)
    expect(workspaceScopeSchema.safeParse({ ...valid, baseSha: "b".repeat(64) }).success).toBe(true)
  })

  it("rejects relative paths, control chars and unknown keys", () => {
    expect(workspaceScopeSchema.safeParse({ ...valid, repo: "relative" }).success).toBe(false)
    expect(workspaceScopeSchema.safeParse({ ...valid, repo: "/a\tb" }).success).toBe(false)
    expect(workspaceScopeSchema.safeParse({ ...valid, extra: 1 }).success).toBe(false)
  })

  it("rejects worktrees outside the generated root and bad SHAs", () => {
    expect(workspaceScopeSchema.safeParse({ ...valid, worktree: "/home/bot/other" }).success).toBe(false)
    expect(workspaceScopeSchema.safeParse({ ...valid, worktree: "/home/bot/.saaya/worktrees/not-a-uuid" }).success).toBe(false)
    expect(workspaceScopeSchema.safeParse({ ...valid, baseSha: "zz" }).success).toBe(false)
  })
})
