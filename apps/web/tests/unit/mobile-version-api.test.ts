import { describe, it, expect } from "vitest"
import { GET } from "../../src/app/api/mobile/version/route"

describe("Mobile Version API Route", () => {
  it("returns latest version info and download details with CORS headers", async () => {
    const response = await GET()
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty("latestVersion")
    expect(data).toHaveProperty("minSupportedVersion")
    expect(data).toHaveProperty("apkUrl")
    expect(data).toHaveProperty("releaseNotes")
    expect(data).toHaveProperty("publishedAt")

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*")
  })
})
