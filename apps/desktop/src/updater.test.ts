import { describe, expect, it, vi } from "vitest"
import { DesktopUpdater, NotPublishedError, dmgUrlFor, isNewer, type UpdaterDeps } from "./updater"

function deps(over: Partial<UpdaterDeps> = {}): UpdaterDeps {
  return {
    currentVersion: "1.0.9",
    arch: "arm64",
    fetchVersion: async () => ({ latestDesktopVersion: "1.0.10" }),
    download: async (_url, _dest, onProgress) => {
      onProgress(50)
      onProgress(100)
    },
    inspect: async () => "1.0.10",
    install: async () => {},
    dmgPath: (v) => `/tmp/Sayabot-${v}.dmg`,
    ...over,
  }
}

describe("isNewer", () => {
  it("compares numerically, not as text", () => {
    expect(isNewer("1.0.9", "1.0.10")).toBe(true)
    expect(isNewer("1.0.10", "1.0.9")).toBe(false)
    expect(isNewer("1.0.10", "1.0.10")).toBe(false)
    expect(isNewer("1.0.10", "v1.1.0")).toBe(true)
  })

  it("never claims an update from a version it cannot read", () => {
    expect(isNewer("1.0.9", "")).toBe(false)
    expect(isNewer("1.0.9", "latest")).toBe(false)
  })
})

describe("dmgUrlFor", () => {
  it("pins the download to the version that was checked, per chip", () => {
    expect(dmgUrlFor({}, "1.0.10", "arm64")).toBe(
      "https://github.com/anurag3407/sayabot/releases/download/v1.0.10/Sayabot-arm64.dmg",
    )
    expect(dmgUrlFor({ dmgUrl: "https://github.com/x/releases/latest/download/Sayabot-arm64.dmg" }, "1.0.10", "x64")).toBe(
      "https://github.com/anurag3407/sayabot/releases/download/v1.0.10/Sayabot-x64.dmg",
    )
    expect(dmgUrlFor({ dmgUrls: { x64: "https://mirror/x.dmg" } }, "1.0.10", "x64")).toBe("https://mirror/x.dmg")
  })
})

describe("DesktopUpdater", () => {
  it("finds an update, then downloads, verifies and installs it", async () => {
    const install = vi.fn(async () => {})
    const updater = new DesktopUpdater(deps({ install }))
    const seen: string[] = []
    updater.onChange((s) => seen.push(s.status === "downloading" ? `downloading:${s.percent}` : s.status))
    expect((await updater.check()).status).toBe("available")
    await updater.install()
    expect(install).toHaveBeenCalledWith("/tmp/Sayabot-1.0.10.dmg", "1.0.10")
    expect(seen).toEqual(["checking", "available", "downloading:0", "downloading:50", "downloading:100", "installing"])
  })

  it("says up to date when the server's version is not newer", async () => {
    const updater = new DesktopUpdater(deps({ fetchVersion: async () => ({ latestDesktopVersion: "1.0.9" }) }))
    expect(await updater.check()).toMatchObject({ status: "idle", latest: "1.0.9" })
  })

  it("keeps quiet when an automatic check fails, but reports a manual one", async () => {
    const fail = deps({ fetchVersion: async () => Promise.reject(new Error("offline")) })
    expect((await new DesktopUpdater(fail).check(false)).status).toBe("idle")
    expect(await new DesktopUpdater(fail).check(true)).toMatchObject({ status: "error" })
  })

  it("refuses a download that is not the version it expected, and installs nothing", async () => {
    const install = vi.fn(async () => {})
    const updater = new DesktopUpdater(deps({ inspect: async () => "1.0.8", install }))
    await updater.check()
    await updater.install()
    expect(install).not.toHaveBeenCalled()
    expect(updater.current).toMatchObject({ status: "error", latest: "1.0.10" })
    expect(updater.current.status === "error" && updater.current.message).toContain("1.0.8")
  })

  it("explains a release that is still uploading", async () => {
    const updater = new DesktopUpdater(
      deps({ download: async () => Promise.reject(new NotPublishedError("404")) }),
    )
    await updater.check()
    await updater.install()
    expect(updater.current.status === "error" && updater.current.message).toContain("still being published")
  })

  it("does not start a second download while one runs", async () => {
    let release: () => void = () => {}
    const download = vi.fn(() => new Promise<void>((resolve) => (release = resolve)))
    const updater = new DesktopUpdater(deps({ download }))
    await updater.check()
    const first = updater.install()
    await Promise.resolve()
    await updater.install()
    expect(download).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it("shares one check between overlapping callers", async () => {
    const fetchVersion = vi.fn(async () => ({ latestDesktopVersion: "1.0.10" }))
    const updater = new DesktopUpdater(deps({ fetchVersion }))
    await Promise.all([updater.check(), updater.check(true)])
    expect(fetchVersion).toHaveBeenCalledTimes(1)
  })
})
