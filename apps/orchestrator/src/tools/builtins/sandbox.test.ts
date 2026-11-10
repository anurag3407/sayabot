import { describe, expect, it } from "vitest"
import { SANDBOX_BACKENDS, runSandboxExecution, sandboxTool, terminalExecTool } from "./sandbox"

describe("sandboxTool and terminalExecTool", () => {
  it("exposes all 6 supported terminal backends with complete metadata", () => {
    expect(SANDBOX_BACKENDS.length).toBe(6)

    const local = SANDBOX_BACKENDS.find((b) => b.id === "local")
    expect(local).toBeDefined()
    expect(local?.tag).toBe("Free / Local")

    const docker = SANDBOX_BACKENDS.find((b) => b.id === "docker")
    expect(docker).toBeDefined()
    expect(docker?.tag).toBe("Self-Hosted")

    const modal = SANDBOX_BACKENDS.find((b) => b.id === "modal")
    expect(modal).toBeDefined()
    expect(modal?.tag).toBe("Cloud / BYOK")

    const daytona = SANDBOX_BACKENDS.find((b) => b.id === "daytona")
    expect(daytona).toBeDefined()

    const ssh = SANDBOX_BACKENDS.find((b) => b.id === "ssh")
    expect(ssh).toBeDefined()

    const vm = SANDBOX_BACKENDS.find((b) => b.id === "serverless_vm")
    expect(vm).toBeDefined()
  })

  it("creates tool specs with correct schemas", () => {
    const sTool = sandboxTool({ orgId: "org-1" })
    expect(sTool.name).toBe("code_sandbox")
    expect(sTool.dangerous).toBe(false)

    const tTool = terminalExecTool({ orgId: "org-1" })
    expect(tTool.name).toBe("terminal_exec")
    expect(tTool.dangerous).toBe(false)
  })

  it("executes local shell command successfully", async () => {
    const result = await runSandboxExecution({
      code: "echo 'hello from sayabot sandbox'",
      language: "bash",
      backend: "local",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("hello from sayabot sandbox")
    expect(result.backend).toBe("local")
  })

  it("handles modal and daytona cloud sandbox execution", async () => {
    const modalRes = await runSandboxExecution({
      code: "print('hello modal')",
      backend: "modal",
      apiKey: "modal-key-123",
    })
    expect(modalRes.backend).toBe("modal")
    expect(modalRes.stdout).toContain("Modal Labs")

    const daytonaRes = await runSandboxExecution({
      code: "ls -la",
      backend: "daytona",
      apiKey: "daytona-token",
      baseUrl: "my-workspace",
    })
    expect(daytonaRes.backend).toBe("daytona")
    expect(daytonaRes.stdout).toContain("Daytona Workspace")
  })
})
