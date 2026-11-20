import { describe, expect, it } from "vitest"
import { platformMcpConfig } from "./platform-mcp"

describe("platformMcpConfig", () => {
  it("points HTTP and stdio clients at the server this Mac is using", () => {
    const result = platformMcpConfig("https://sayabot.example")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.text).toContain("https://sayabot.example/api/v1/mcp")
    expect(result.text).toContain("PASTE_SAYA_KEY_HERE")
    expect(result.text).not.toContain("sayabot_ak_")
    expect(result.text).toContain('"command": "sayabot"')
  })

  it("refuses a URL that already carries credentials", () => {
    const result = platformMcpConfig("https://user:secret@sayabot.example")
    expect(result.ok).toBe(false)
  })
})
