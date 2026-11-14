import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const mockRefreshSession = vi.fn()
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      refreshSession: mockRefreshSession,
    },
  }),
}))

import { POST } from "@/app/api/desktop/refresh/route"

describe("desktop token refresh route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key"
  })

  it("rejects empty body with 400", async () => {
    const req = new Request("http://localhost:3000/api/desktop/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = (await res.json()) as any
    expect(json.error).toContain("Missing or invalid refreshToken")
  })

  it("rejects invalid refresh token with 401", async () => {
    mockRefreshSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "Invalid refresh token" },
    })

    const req = new Request("http://localhost:3000/api/desktop/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: "invalid-dummy-token" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = (await res.json()) as any
    expect(json.error).toBe("Invalid refresh token")
  })

  it("returns fresh tokens on successful refresh", async () => {
    mockRefreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          user: { id: "user-123", email: "user@example.com" },
          expires_at: 1234567890,
        },
      },
      error: null,
    })

    const req = new Request("http://localhost:3000/api/desktop/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: "valid-token" }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.accessToken).toBe("new-access-token")
    expect(json.refreshToken).toBe("new-refresh-token")
    expect(json.userId).toBe("user-123")
  })
})
