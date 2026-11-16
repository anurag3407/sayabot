import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import {
  canReplaceWin,
  installTargetWin,
  normalizeProductVersion,
  psSingleQuote,
  winUpdateInstallScript,
} from "./win-install"

describe("installTargetWin", () => {
  it("replaces the folder that contains the running Sayabot.exe", () => {
    expect(installTargetWin("C:\\Users\\me\\AppData\\Local\\Programs\\Sayabot\\Sayabot.exe")).toBe(
      "C:\\Users\\me\\AppData\\Local\\Programs\\Sayabot",
    )
  })

  it("uses the per-user Programs folder when the running binary is not Sayabot", () => {
    const target = installTargetWin("C:\\dev\\electron\\electron.exe")
    expect(target.replace(/\\/g, "/")).toMatch(/AppData\/Local\/Programs\/Sayabot$/)
  })
})

describe("winUpdateInstallScript", () => {
  const text = winUpdateInstallScript({
    zipPath: "C:\\Temp\\Sayabot-1.2.3.zip",
    pid: 42,
    target: "C:\\Users\\me\\AppData\\Local\\Programs\\Sayabot",
    version: "1.2.3",
  })

  it("quotes paths and waits for this process to exit", () => {
    expect(text).toContain("$PidToWait = 42")
    expect(text).toContain("'C:\\Temp\\Sayabot-1.2.3.zip'")
    expect(psSingleQuote("o'brien")).toBe("'o''brien'")
  })

  it("swaps the folder and puts the old app back if the swap fails", () => {
    expect(text).toContain("Expand-Archive")
    expect(text).toContain("Rename-Item -LiteralPath $OldDir -NewName $Leaf")
    expect(text).toContain("Start-Process -FilePath (Join-Path $Target 'Sayabot.exe')")
    expect(text).not.toContain("Remove-Item -LiteralPath $Target -Recurse -Force\n")
  })
})

describe("normalizeProductVersion", () => {
  it("drops the fourth component electron-builder writes", () => {
    expect(normalizeProductVersion("1.2.3.0")).toBe("1.2.3")
    expect(normalizeProductVersion("1.2.3")).toBe("1.2.3")
    expect(normalizeProductVersion("not a version")).toBeNull()
  })
})

describe("canReplaceWin", () => {
  it("rejects a missing parent folder", () => {
    expect(canReplaceWin(path.join(os.tmpdir(), "no-such-sayabot-parent", "Sayabot"))).toBe(false)
  })
})
