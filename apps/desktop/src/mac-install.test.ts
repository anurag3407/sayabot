import { describe, expect, it } from "vitest"
import { bashSingleQuote, installTarget, macUpdateInstallScript } from "./mac-install"

const script = (over: Partial<Parameters<typeof macUpdateInstallScript>[0]> = {}) =>
  macUpdateInstallScript({
    dmgPath: "/tmp/Sayabot update/Sayabot.dmg",
    pid: 4242,
    target: "/Applications/Sayabot.app",
    version: "1.0.10",
    ...over,
  })

describe("mac update install script", () => {
  it("waits for this process, checks the version, and swaps instead of deleting first", () => {
    const text = script()
    expect(text).toContain("PID=4242")
    expect(text).toContain("kill -0")
    expect(text).toContain("'/tmp/Sayabot update/Sayabot.dmg'")
    expect(text).toContain("EXPECTED='1.0.10'")
    expect(text).toContain("CFBundleShortVersionString")
    expect(text).toContain('ditto "$SRC" "$TARGET.new"')
    expect(text).toContain('mv "$TARGET" "$TARGET.old"')
    // The old app is only removed after the new one is in place.
    expect(text.indexOf('rm -rf "$TARGET.old"\nxattr')).toBeGreaterThan(
      text.indexOf('mv "$TARGET.new" "$TARGET"'),
    )
    expect(text).not.toContain("rm -rf /Applications/Sayabot.app")
  })

  it("puts the old app back and reopens it when something fails", () => {
    const text = script()
    expect(text).toContain('mv "$TARGET.old" "$TARGET"')
    expect(text).toMatch(/fail\(\) \{[\s\S]*open "\$TARGET"/)
  })

  it("keeps a quote in the path inside the shell string", () => {
    expect(bashSingleQuote("/tmp/it's.dmg")).toBe("'/tmp/it'\\''s.dmg'")
    expect(script({ dmgPath: "/tmp/it's.dmg" })).toContain("'/tmp/it'\\''s.dmg'")
  })
})

describe("installTarget", () => {
  it("replaces the copy that is running", () => {
    expect(installTarget("/Users/me/Applications/Sayabot.app/Contents/MacOS/Sayabot")).toBe(
      "/Users/me/Applications/Sayabot.app",
    )
  })

  it("installs to /Applications when running from a disk image or App Translocation", () => {
    expect(installTarget("/Volumes/Sayabot/Sayabot.app/Contents/MacOS/Sayabot")).toBe(
      "/Applications/Sayabot.app",
    )
    expect(
      installTarget(
        "/private/var/folders/x/AppTranslocation/ABC/d/Sayabot.app/Contents/MacOS/Sayabot",
      ),
    ).toBe("/Applications/Sayabot.app")
    expect(installTarget("/usr/local/bin/electron")).toBe("/Applications/Sayabot.app")
  })
})
