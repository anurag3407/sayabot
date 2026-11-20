import { describe, expect, it } from "vitest"
import { DesktopGuiManager } from "../agentd/desktop-gui"

describe("DesktopGuiManager", () => {
  const manager = new DesktopGuiManager(":99")

  it("retrieves screen resolution with safe fallback", async () => {
    const info = await manager.getScreenInfo()
    expect(info.width).toBeGreaterThan(0)
    expect(info.height).toBeGreaterThan(0)
    expect(info.display).toBe(":99")
  })

  it("handles mouse operations gracefully without hanging", async () => {
    const moveRes = await manager.handleMouse({ action: "move", x: 100, y: 150 })
    expect(moveRes.ok).toBe(true)
    expect(moveRes.x).toBe(100)
    expect(moveRes.y).toBe(150)

    const clickRes = await manager.handleMouse({ action: "click", x: 200, y: 250, button: 1 })
    expect(clickRes.ok).toBe(true)

    const dragRes = await manager.handleMouse({ action: "drag", x: 10, y: 20, endX: 50, endY: 60 })
    expect(dragRes.ok).toBe(true)
  })

  it("handles keyboard operations gracefully", async () => {
    const typeRes = await manager.handleKeyboard({ action: "type", text: "Hello World" })
    expect(typeRes.ok).toBe(true)

    const pressRes = await manager.handleKeyboard({ action: "press", key: "Return" })
    expect(pressRes.ok).toBe(true)
  })

  it("captures screenshot returning a valid data URI base64 string", async () => {
    const screenshot = await manager.captureScreenshotBase64()
    expect(screenshot).toMatch(/^data:image\/png;base64,/)
  })
})
