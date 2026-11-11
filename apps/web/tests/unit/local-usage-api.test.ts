import { describe, it, expect } from "vitest"
import { GET } from "../../src/app/api/usage/local/route"

describe("Local Usage Scanner API Route", () => {
  it("returns scanned local agent usage with summary and events", async () => {
    const request = new Request("http://localhost:3000/api/usage/local?days=7")
    const response = await GET(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.days).toBe(7)
    expect(Array.isArray(data.records)).toBe(true)
    expect(data.summary).toBeDefined()
    expect(typeof data.summary.totalTokens).toBe("number")
    expect(typeof data.summary.costUsd).toBe("number")
    expect(typeof data.summary.cacheSavingsUsd).toBe("number")
    expect(Array.isArray(data.events)).toBe(true)

    // Check header
    expect(response.headers.get("Cache-Control")).toContain("no-cache")
  }, 20000)

  it("handles custom provider filters", async () => {
    const request = new Request("http://localhost:3000/api/usage/local?providers=antigravity")
    const response = await GET(request)
    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.providersScanned).toEqual(["antigravity"])
  }, 20000)
})
