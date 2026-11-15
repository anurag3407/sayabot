import { describe, expect, it } from "vitest"
import { pickLatestApk, repoFromGithubUrl } from "./mobile-release"

const asset = (name: string) => ({ name, browser_download_url: `https://dl/${name}` })

describe("pickLatestApk", () => {
  it("picks the highest versioned APK and ignores other files", () => {
    const apk = pickLatestApk([
      asset("Sayabot-arm64.dmg"),
      asset("Sayabot.apk"),
      asset("Sayabot-1.1.0.apk"),
      asset("Sayabot-1.10.0.apk"),
      asset("Sayabot-1.2.0.apk"),
    ])
    expect(apk).toEqual({ version: "1.10.0", url: "https://dl/Sayabot-1.10.0.apk" })
  })

  it("returns null when no versioned APK exists", () => {
    expect(pickLatestApk([asset("Sayabot.apk"), asset("Sayabot-x64.dmg")])).toBeNull()
  })
})

describe("repoFromGithubUrl", () => {
  it("extracts owner/repo", () => {
    expect(repoFromGithubUrl("https://github.com/acme/sayabot")).toBe("acme/sayabot")
    expect(repoFromGithubUrl("https://github.com/acme/sayabot.git")).toBe("acme/sayabot")
    expect(repoFromGithubUrl("https://example.com/x")).toBeNull()
  })
})
