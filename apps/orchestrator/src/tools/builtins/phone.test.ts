import { describe, expect, it, vi } from "vitest"
import { phoneTools } from "./phone"

// Mock computer client
vi.mock("../../computer/client", () => ({
  getComputerClient: () => ({
    phone: async (_agentId: string, action: string, params: any = {}) => {
      if (action === "list") {
        return {
          ok: true,
          count: 1,
          devices: [{ serial: "emulator-5554", state: "device", model: "Pixel_8" }],
        }
      }
      if (action === "screenshot") {
        return { ok: true, screenshot: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=" }
      }
      if (action === "tap" || action === "touch" || action === "swipe") {
        return { ok: true, touched: true }
      }
      if (action === "key") {
        return { ok: true, key: params.key }
      }
      if (action === "text") {
        return { ok: true, text: params.text }
      }
      if (action === "launch") {
        return { ok: true, launched: params.packageName }
      }
      return { ok: true }
    },
  }),
}))

describe("phone tools", () => {
  const tools = phoneTools({
    orgId: "org-1",
    agentId: "agent-1",
    roomId: "room-1",
  })
  const phoneTool = tools.find((t) => t.name === "android_device_control")!

  it("evaluates dangerous flags accurately based on mutation vs read-only", () => {
    const isDangerous =
      typeof phoneTool.dangerous === "function" ? phoneTool.dangerous : () => phoneTool.dangerous

    expect(isDangerous({ action: "list_devices" })).toBe(false)
    expect(isDangerous({ action: "screenshot" })).toBe(false)
    expect(isDangerous({ action: "get_info" })).toBe(false)
    expect(isDangerous({ action: "tap", x: 100, y: 100 })).toBe(true)
    expect(isDangerous({ action: "swipe", x: 100, y: 100, end_x: 100, end_y: 500 })).toBe(true)
    expect(isDangerous({ action: "key", key: "HOME" })).toBe(true)
    expect(isDangerous({ action: "launch_app", package_name: "com.android.chrome" })).toBe(true)
  })

  it("lists connected android devices", async () => {
    const res = (await phoneTool.execute({ action: "list_devices" })) as any
    expect(res.ok).toBe(true)
    expect(res.count).toBe(1)
    expect(res.devices[0]?.serial).toBe("emulator-5554")
  })

  it("captures mobile screenshot", async () => {
    const res = (await phoneTool.execute({ action: "screenshot" })) as any
    expect(res.ok).toBe(true)
    expect(res.screenshot).toContain("data:image/png;base64")
  })

  it("executes tap and key events", async () => {
    const tapRes = (await phoneTool.execute({ action: "tap", x: 200, y: 400 })) as any
    expect(tapRes.ok).toBe(true)
    expect(tapRes.action).toBe("tap")

    const keyRes = (await phoneTool.execute({ action: "key", key: "BACK" })) as any
    expect(keyRes.ok).toBe(true)
    expect(keyRes.key).toBe("BACK")
  })
})
