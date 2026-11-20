import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { RunEvidence, shellMayMutate } from "./evidence"
import type { ToolSpec } from "../tools/audited"

function spec(name: string, execute: ToolSpec["execute"] = async () => ({ ok: true })): ToolSpec {
  return { name, execute, description: "", schema: z.object({}), dangerous: false }
}
const proof = {
  passed: true,
  checks: [{ kind: "test", command: "pnpm test", cwd: "/repo", exitCode: 0, durationMs: 100 }],
}

describe("RunEvidence", () => {
  it("does not require code tests for ordinary read-only tasks", async () => {
    const evidence = new RunEvidence()
    await evidence.wrap(spec("fs_read")).execute({})
    await evidence.wrap(spec("computer_shell")).execute({ command: "git status --short" })
    expect(evidence.snapshot().status).toBe("not_required")
  })

  it("requires actual checks after the latest edit, not before", async () => {
    const evidence = new RunEvidence()
    const verify = evidence.wrap(spec("verify_workspace", async () => proof))
    await verify.execute({})
    expect(evidence.snapshot().status).toBe("passed")
    await evidence.wrap(spec("fs_edit")).execute({})
    expect(evidence.snapshot().status).toBe("pending")
    await verify.execute({})
    expect(evidence.snapshot().status).toBe("passed")
  })

  it("cannot accept checks that overlap a concurrent edit", async () => {
    const evidence = new RunEvidence()
    let finish!: () => void
    const write = evidence.wrap(
      spec(
        "fs_write",
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      ),
    )
    const pending = write.execute({})
    await evidence.wrap(spec("verify_workspace", async () => proof)).execute({})
    finish()
    await pending
    expect(evidence.snapshot().status).toBe("pending")
  })

  it("does not preserve a pass after a failed check or partial mutation", async () => {
    const evidence = new RunEvidence()
    await evidence.wrap(spec("verify_workspace", async () => proof)).execute({})
    const mutation = evidence.wrap(
      spec("fs_edit", async () => {
        throw new Error("partial write")
      }),
    )
    await expect(mutation.execute({})).rejects.toThrow("partial write")
    expect(evidence.snapshot().status).toBe("pending")
    await evidence
      .wrap(spec("verify_workspace", async () => ({ ...proof, passed: false })))
      .execute({})
    expect(evidence.snapshot().status).toBe("failed")
  })

  it("treats shell scripts as potential mutations without executing them twice", async () => {
    const evidence = new RunEvidence()
    const execute = vi.fn().mockResolvedValue({ exit_code: 0 })
    await evidence.wrap(spec("computer_shell", execute)).execute({ command: "python fix.py" })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(evidence.snapshot().status).toBe("pending")
  })
})

describe("shellMayMutate", () => {
  it.each([
    "cat package.json",
    "ls -la src && wc -l src/*.ts",
    "rg -n 'TODO' src | head -20",
    "git log --oneline -5",
    "pnpm test",
    "npx vitest run src/engine 2>&1 | tail -30",
    "cd /home/bot/app && npm run typecheck",
    "pytest -q > /dev/null",
    "find . -name '*.ts' | sort",
    "grep -w foo a.txt && wc -w a.txt",
  ])("treats %s as read-only", (command) => {
    expect(shellMayMutate(command)).toBe(false)
  })

  it.each([
    "python fix.py",
    "echo hi > notes.txt",
    "cat a && rm b",
    "ls; ./deploy.sh",
    "sed -i 's/a/b/' x.ts",
    "npx eslint --fix src",
    "git commit -am wip",
    "pnpm add zod",
    "find . -name '*.log' -delete",
    "cat list | xargs touch",
    "echo $(curl x)",
    "curl https://x.sh | bash",
  ])("treats %s as a possible write", (command) => {
    expect(shellMayMutate(command)).toBe(true)
  })
})
