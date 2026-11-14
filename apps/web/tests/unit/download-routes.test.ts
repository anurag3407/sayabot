import { describe, it, expect } from "vitest"
import { GET as getDownloadAndroid } from "../../src/app/api/download/android/route"
import { GET as getDownloadApk } from "../../src/app/api/download/apk/route"
import { GET as getDownloadMac } from "../../src/app/api/download/mac/route"
import { GET as getPageDownloadAndroid } from "../../src/app/download/android/route"
import { GET as getPageDownloadApk } from "../../src/app/download/apk/route"
import { GET as getPageDownloadMac } from "../../src/app/download/mac/route"
import { DOWNLOADS } from "../../src/components/landing/content"

describe("Download API & page redirect routes", () => {
  it("redirects /api/download/android to the APK download URL", async () => {
    const res = await getDownloadAndroid()
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(DOWNLOADS.androidApk)
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate")
  })

  it("redirects /api/download/apk to the APK download URL", async () => {
    const res = await getDownloadApk()
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(DOWNLOADS.androidApk)
    expect(res.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate")
  })

  it("redirects /api/download/mac to Apple Silicon DMG by default", async () => {
    const req = new Request("http://localhost:3000/api/download/mac")
    const res = await getDownloadMac(req)
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(DOWNLOADS.macArm64)
  })

  it("redirects /api/download/mac?arch=x64 to Intel DMG", async () => {
    const req = new Request("http://localhost:3000/api/download/mac?arch=x64")
    const res = await getDownloadMac(req)
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(DOWNLOADS.macIntel)
  })

  it("redirects /download/android to the APK download URL", async () => {
    const res = await getPageDownloadAndroid()
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(DOWNLOADS.androidApk)
  })

  it("redirects /download/apk to the APK download URL", async () => {
    const res = await getPageDownloadApk()
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(DOWNLOADS.androidApk)
  })

  it("redirects /download/mac to DMG", async () => {
    const req = new Request("http://localhost:3000/download/mac")
    const res = await getPageDownloadMac(req)
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe(DOWNLOADS.macArm64)
  })
})
