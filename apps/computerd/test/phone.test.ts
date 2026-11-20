import { describe, expect, it } from "vitest"
import { AndroidDeviceManager, ANDROID_KEYCODES } from "../agentd/phone"

describe("AndroidDeviceManager", () => {
  const manager = new AndroidDeviceManager("echo")

  it("exports standard Android KeyCodes", () => {
    expect(ANDROID_KEYCODES.HOME).toBe(3)
    expect(ANDROID_KEYCODES.BACK).toBe(4)
    expect(ANDROID_KEYCODES.ENTER).toBe(66)
    expect(ANDROID_KEYCODES.APP_SWITCH).toBe(187)
  })

  it("handles empty device list gracefully when adb returns no devices", async () => {
    const devices = await manager.listDevices()
    expect(Array.isArray(devices)).toBe(true)
  })

  it("returns fallback display size when query fails", async () => {
    const size = await manager.getScreenSize()
    expect(size.width).toBeGreaterThan(0)
    expect(size.height).toBeGreaterThan(0)
  })
})
