import { describe, expect, it } from "vitest"
import { bashSingleQuote, macUpdateInstallScript } from "./mac-install"

describe("mac update install script", () => {
  it("waits for this process, then replaces the app and clears the download flag", () => {
    const script = macUpdateInstallScript({
      dmgPath: "/tmp/Sayabot update/Sayabot.dmg",
      pid: 4242,
    })
    expect(script).toContain("PID=4242")
    expect(script).toContain("kill -0")
    expect(script).toContain("'/tmp/Sayabot update/Sayabot.dmg'")
    expect(script).toContain("xattr -dr com.apple.quarantine /Applications/Sayabot.app")
    expect(script).toContain("open /Applications/Sayabot.app")
  })

  it("keeps a quote in the path inside the shell string", () => {
    expect(bashSingleQuote("/tmp/it's.dmg")).toBe("'/tmp/it'\\''s.dmg'")
    const script = macUpdateInstallScript({ dmgPath: "/tmp/it's.dmg", pid: 1 })
    expect(script).toContain("'/tmp/it'\\''s.dmg'")
  })
})
