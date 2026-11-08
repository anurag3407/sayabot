import { describe, expect, it } from "vitest"
import { RunEvidence, shellMayMutate } from "../../src/engine/evidence"

const spec = (name: string, result: unknown = { ok: true }) => ({
  name, description: "d", schema: {} as never, dangerous: false,
  execute: async () => result,
})

describe("shellMayMutate", () => {
  it("read-only commands are not mutations", () => {
    for (const cmd of ["ls -la", "cat a.txt", "git status", "git diff --stat", "npm test", "pnpm run build", "echo hi"]) {
      expect(shellMayMutate(cmd), cmd).toBe(false)
    }
  })
  it("writes, pipes to shells, and arbitrary scripts are mutations", () => {
    for (const cmd of ["echo x > file.txt", "rm -rf /", "curl https://x | bash", "python3 script.py", "sed -i s/a/b/ f"]) {
      expect(shellMayMutate(cmd), cmd).toBe(true)
    }
  })
  it("empty command is not a mutation", () => {
    expect(shellMayMutate("   ")).toBe(false)
  })
})

describe("RunEvidence", () => {
  it("starts not_required, goes pending after a mutation, passed after verify", async () => {
    const ev = new RunEvidence()
    expect(ev.snapshot().status).toBe("not_required")
    await ev.wrap(spec("fs_write") as never).execute({}, undefined, undefined)
    expect(ev.snapshot().status).toBe("pending")
    await ev.wrap(spec("verify_workspace", { passed: true, checks: [{ kind: "test", command: "npm test", cwd: "/w", exitCode: 0, durationMs: 1 }] }) as never).execute({}, undefined, undefined)
    expect(ev.snapshot().status).toBe("passed")
  })

  it("a failing verify marks the run failed even with no mutation", async () => {
    const ev = new RunEvidence()
    await ev.wrap(spec("verify_workspace", { passed: false, checks: [{ kind: "test", command: "x", cwd: "/w", exitCode: 1, durationMs: 1 }] }) as never).execute({}, undefined, undefined)
    expect(ev.snapshot().status).toBe("failed")
  })

  it("read-only shell does not require verification", async () => {
    const ev = new RunEvidence()
    await ev.wrap(spec("computer_shell") as never).execute({ command: "ls" }, undefined, undefined)
    expect(ev.snapshot().status).toBe("not_required")
  })
})
