import { describe, expect, it, vi } from "vitest"
import { fetchWithRetry } from "../../src/connectors/rate-limiter"

describe("fetchWithRetry", () => {
  it("returns response directly when status is 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("success", { status: 200 }))

    const res = await fetchWithRetry("https://api.example.com/test", {}, {
      maxRetries: 3,
      fetchFn: mockFetch,
    })

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it("retries on HTTP 429 and succeeds on retry", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("Rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(new Response("OK", { status: 200 }))

    const res = await fetchWithRetry("https://api.example.com/test", {}, {
      maxRetries: 2,
      baseDelayMs: 1,
      fetchFn: mockFetch,
    })

    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it("retries on HTTP 503 and respects maxRetries exhaustion", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("Service Unavailable", { status: 503 }))

    const res = await fetchWithRetry("https://api.example.com/test", {}, {
      maxRetries: 2,
      baseDelayMs: 1,
      fetchFn: mockFetch,
    })

    expect(res.status).toBe(503)
    expect(mockFetch).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it("does not retry on client error 404", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValue(new Response("Not Found", { status: 404 }))

    const res = await fetchWithRetry("https://api.example.com/test", {}, {
      maxRetries: 3,
      baseDelayMs: 1,
      fetchFn: mockFetch,
    })

    expect(res.status).toBe(404)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })
})
