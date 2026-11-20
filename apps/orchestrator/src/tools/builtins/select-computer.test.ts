import { describe, expect, it } from "vitest"
import { selectComputerTool } from "./select-computer"

const sleeping = {
  thisComputer: false,
  localVmReady: false,
  boatConfigured: true,
  boatState: "sleeping" as const,
  vpsReady: false,
  startVpsAutomatically: false,
  e2bConfigured: false,
  e2bReady: false,
}

describe("select_computer", () => {
  it("wakes a Boat when the bot asks and leaves Auto idle until then", async () => {
    const tool = selectComputerTool({ worksOn: "auto", available: sleeping })
    const woke = (await tool.execute({ surface: "boat" })) as { ok: boolean; action: string }
    expect(woke).toEqual({ ok: true, surface: "boat", action: "wake" })
  })

  it("records the woken Boat on the shared turn so the next command can use it", async () => {
    const available = { ...sleeping }
    const params: Record<string, unknown> = {}
    const tool = selectComputerTool({
      worksOn: "auto",
      available,
      params,
      apply: async () => ({ ok: true, boatId: "box-9" }),
    })
    const woke = (await tool.execute({ surface: "boat" })) as { ok: boolean; boatId: string }
    expect(woke.ok).toBe(true)
    expect(woke.boatId).toBe("box-9")
    expect(available.boatState).toBe("running")
    expect((params.computer as { boatId: string }).boatId).toBe("box-9")
  })

  it("creates an E2B sandbox for a bot pinned to e2b and shares it with the next tool", async () => {
    const available = { ...sleeping, e2bConfigured: true }
    const params: Record<string, unknown> = {}
    const tool = selectComputerTool({
      worksOn: "e2b",
      available,
      params,
      apply: async (decision) => ({ ok: true, e2bId: `sbx-${decision.action}` }),
    })
    const opened = (await tool.execute({ surface: "e2b" })) as {
      ok: boolean
      e2bId: string
      action: string
    }
    expect(opened).toMatchObject({ ok: true, action: "provision", e2bId: "sbx-provision" })
    expect(available.e2bReady).toBe(true)
    expect((params.computer as { e2bId: string }).e2bId).toBe("sbx-provision")
  })
})
