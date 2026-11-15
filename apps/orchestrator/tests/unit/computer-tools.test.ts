import { describe, expect, it, vi } from "vitest"
import { computerTools, replaceLiteral, shellQuote } from "../../src/tools/builtins/computer"
import * as clientModule from "../../src/computer/client"

describe("shellQuote", () => {
  it("wraps in single quotes and escapes embedded quotes", () => {
    expect(shellQuote("abc")).toBe("'abc'")
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
    expect(shellQuote("")).toBe("''")
  })
})

describe("replaceLiteral", () => {
  it("replaces the first occurrence by default, all with the flag", () => {
    expect(replaceLiteral("a-a-a", "a", "b", false)).toBe("b-a-a")
    expect(replaceLiteral("a-a-a", "a", "b", true)).toBe("b-b-b")
  })
  it("is literal: $ and regex chars have no special meaning", () => {
    expect(replaceLiteral("cost: $5 and $5", "$5", "$9", false)).toBe("cost: $9 and $5")
    expect(replaceLiteral("a.b", ".", "X", true)).toBe("aXb")
  })
  it("no match returns the input unchanged", () => {
    expect(replaceLiteral("hello", "z", "q", true)).toBe("hello")
  })
})

describe("computerTools fs_patch and fs_edit", () => {
  const fakeClient = {
    ensure: vi.fn().mockResolvedValue({ status: "running" }),
    applyPatch: vi.fn().mockResolvedValue({
      ok: true,
      summary: "Applied patch to 1 file(s)",
      files: [{ path: "/home/bot/a.txt", action: "update", additions: 1, deletions: 1 }],
    }),
    editFile: vi.fn().mockResolvedValue({ ok: true }),
    readFile: vi.fn().mockResolvedValue({ content: "hi" }),
  }

  it("includes fs_patch in standardTools and validates its schema", () => {
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue(fakeClient as any)
    const tools = computerTools({
      agentId: "agent-1",
      orgId: "org-1",
      roomId: "room-1",
      profile: "standard",
      worksOn: "local_vm",
      available: {
        thisComputer: false,
        localVmReady: true,
        boatConfigured: false,
        boatState: "absent",
        vpsReady: false,
        startVpsAutomatically: false,
      },
      params: null,
    })
    const patchTool = tools.find((t) => t.name === "fs_patch")
    expect(patchTool).toBeDefined()
    expect(patchTool?.dangerous).toBe(false)

    const valid = patchTool?.schema.safeParse({
      patchText: "*** Begin Patch\n*** End Patch",
    })
    expect(valid?.success).toBe(true)
  })

  it("permits fs_edit without expectedHash while still allowing it", () => {
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue(fakeClient as any)
    const tools = computerTools({
      agentId: "agent-1",
      orgId: "org-1",
      roomId: "room-1",
      profile: "standard",
      worksOn: "local_vm",
      available: {
        thisComputer: false,
        localVmReady: true,
        boatConfigured: false,
        boatState: "absent",
        vpsReady: false,
        startVpsAutomatically: false,
      },
      params: null,
    })
    const editTool = tools.find((t) => t.name === "fs_edit")
    expect(editTool).toBeDefined()

    // Without expectedHash
    const withoutHash = editTool?.schema.safeParse({
      path: "/home/bot/app.ts",
      oldString: "const x = 1",
      newString: "const x = 2",
    })
    expect(withoutHash?.success).toBe(true)

    // With valid expectedHash
    const withHash = editTool?.schema.safeParse({
      path: "/home/bot/app.ts",
      oldString: "const x = 1",
      newString: "const x = 2",
      expectedHash: "a".repeat(64),
    })
    expect(withHash?.success).toBe(true)
  })

  it("delegates fs_patch execution to ComputerClient.applyPatch", async () => {
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue(fakeClient as any)

    const tools = computerTools({
      agentId: "agent-test",
      orgId: "org-test",
      roomId: "room-test",
      profile: "standard",
      worksOn: "local_vm",
      available: {
        thisComputer: false,
        localVmReady: true,
        boatConfigured: false,
        boatState: "absent",
        vpsReady: false,
        startVpsAutomatically: false,
      },
      params: null,
    })
    const patchTool = tools.find((t) => t.name === "fs_patch")
    expect(patchTool).toBeDefined()

    const result = await patchTool?.execute(
      { patchText: "*** Begin Patch\n*** End Patch" },
      new AbortController().signal,
    )
    expect(fakeClient.ensure).toHaveBeenCalledWith("agent-test", "org-test", "standard")
    expect(fakeClient.applyPatch).toHaveBeenCalledWith("agent-test", {
      patchText: "*** Begin Patch\n*** End Patch",
    })
    expect(result).toMatchObject({ ok: true, summary: expect.stringContaining("Applied patch") })
  })

  it("validates fs_write schema with optional allowOverwriteLarge", () => {
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue(fakeClient as any)
    const tools = computerTools({
      agentId: "agent-test",
      orgId: "org-test",
      roomId: "room-test",
      profile: "standard",
      worksOn: "local_vm",
      available: {
        thisComputer: false,
        localVmReady: true,
        boatConfigured: false,
        boatState: "absent",
        vpsReady: false,
        startVpsAutomatically: false,
      },
      params: null,
    })
    const writeTool = tools.find((t) => t.name === "fs_write")
    expect(writeTool).toBeDefined()
    const valid = writeTool?.schema.safeParse({
      path: "/home/bot/app.ts",
      content: "const a = 1",
      allowOverwriteLarge: true,
    })
    expect(valid?.success).toBe(true)
  })

  it("exposes Hermes browser automation tools: browser_exec, browser_cdp, browser_dialog, browser_vault", async () => {
    fakeClient.browser = vi.fn().mockImplementation((_agentId, action, params) => {
      if (action === "cdp") return Promise.resolve({ ok: true, result: {} })
      if (action === "exec") return Promise.resolve({ ok: true, stdout: "Done" })
      if (action === "dialog") return Promise.resolve({ ok: true, handled: true })
      if (action === "vault") return Promise.resolve({ ok: true, injected: true, masked: true })
      return Promise.resolve({ ok: true })
    })
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue(fakeClient as any)

    const tools = computerTools({
      agentId: "agent-browser",
      orgId: "org-browser",
      roomId: "room-browser",
      profile: "browser",
      worksOn: "local_vm",
      available: {
        thisComputer: false,
        localVmReady: true,
        boatConfigured: false,
        boatState: "absent",
        vpsReady: false,
        startVpsAutomatically: false,
      },
      params: null,
    })

    const execTool = tools.find((t) => t.name === "browser_exec")
    expect(execTool).toBeDefined()
    const cdpTool = tools.find((t) => t.name === "browser_cdp")
    expect(cdpTool).toBeDefined()
    const dialogTool = tools.find((t) => t.name === "browser_dialog")
    expect(dialogTool).toBeDefined()
    const vaultTool = tools.find((t) => t.name === "browser_vault")
    expect(vaultTool).toBeDefined()

    // Test browser_exec execution
    await execTool?.execute({ code: "page.goto('https://example.com')", language: "python" })
    expect(fakeClient.browser).toHaveBeenCalledWith("agent-browser", "exec", {
      code: "page.goto('https://example.com')",
      language: "python",
    })

    // Test browser_cdp execution
    await cdpTool?.execute({ method: "Network.getCookies", params: {} })
    expect(fakeClient.browser).toHaveBeenCalledWith("agent-browser", "cdp", {
      method: "Network.getCookies",
      params: {},
    })

    // Test browser_dialog execution
    await dialogTool?.execute({ action: "accept", promptText: "yes" })
    expect(fakeClient.browser).toHaveBeenCalledWith("agent-browser", "dialog", {
      action: "accept",
      promptText: "yes",
    })

    // Test browser_vault execution (zero token leakage)
    await vaultTool?.execute({ secretName: "ADMIN_PASSWORD", selector: "#pass", submit: true })
    expect(fakeClient.browser).toHaveBeenCalledWith("agent-browser", "vault", {
      secretName: "ADMIN_PASSWORD",
      selector: "#pass",
      submit: true,
      orgId: "org-browser",
    })
  })
})

const idleDesktop = {
  thisComputer: false,
  localVmReady: false,
  boatConfigured: true,
  boatState: "sleeping" as const,
  vpsReady: false,
  startVpsAutomatically: false,
}

describe("computer_shell placement", () => {
  it("does not create a desktop when Auto has nothing ready", async () => {
    const ensure = vi.fn()
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue({ ensure } as never)
    const shell = computerTools({
      agentId: "agent-1",
      orgId: "org-1",
      roomId: "room-1",
      profile: "standard",
      worksOn: "auto",
      available: idleDesktop,
      params: null,
    }).find((tool) => tool.name === "computer_shell")
    const result = (await shell?.execute({ command: "ls" }, undefined, undefined)) as { ok: boolean; error: string }
    expect(result.ok).toBe(false)
    expect(result.error).toContain("select_computer")
    expect(ensure).not.toHaveBeenCalled()
  })

  it("does not create a local VM when Auto reads a file and none is ready", async () => {
    const ensure = vi.fn()
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue({ ensure, readFile: vi.fn() } as never)
    const read = computerTools({
      agentId: "agent-1",
      orgId: "org-1",
      roomId: "room-1",
      profile: "standard",
      worksOn: "auto",
      available: idleDesktop,
      params: null,
    }).find((tool) => tool.name === "fs_read")
    const result = (await read?.execute({ path: "/home/bot/a.txt" }, undefined, undefined)) as { ok: boolean }
    expect(result.ok).toBe(false)
    expect(ensure).not.toHaveBeenCalled()
  })

  it("uses the local VM that is already ready and keeps its volume", async () => {
    const ensure = vi.fn().mockResolvedValue({ status: "running" })
    const exec = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0, durationMs: 1, truncated: false })
    vi.spyOn(clientModule, "getComputerClient").mockReturnValue({ ensure, exec } as never)
    const shell = computerTools({
      agentId: "agent-1",
      orgId: "org-1",
      roomId: "room-1",
      profile: "standard",
      worksOn: "auto",
      available: { ...idleDesktop, localVmReady: true },
      params: null,
    }).find((tool) => tool.name === "computer_shell")
    const result = (await shell?.execute({ command: "ls" }, undefined, undefined)) as { stdout: string }
    expect(result.stdout).toBe("ok")
    expect(ensure).toHaveBeenCalledWith("agent-1", "org-1", "standard")
  })
})
