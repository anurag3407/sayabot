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
})
