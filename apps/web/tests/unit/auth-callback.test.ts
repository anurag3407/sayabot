import { describe, expect, it, vi, beforeEach } from "vitest"
import { GET } from "../../src/app/auth/callback/route"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  listUserOrgs: vi.fn().mockResolvedValue([{ slug: "my-workspace" }]),
}))

describe("Auth Callback Route (GET /auth/callback)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("redirects to /login if error query parameter is present", async () => {
    const req = new Request("https://sayabot.sayalabs.in/auth/callback?error=access_denied&error_description=User%20declined")
    const res = await GET(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login?error=User%20declined")
  })

  it("handles successful exchangeCodeForSession and redirects to user workspace", async () => {
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: { user: { id: "user-123", email: "test@example.com", user_metadata: {} } },
          error: null,
        }),
      },
    }
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-123" } }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({}),
        }),
      }),
    }

    vi.mocked(createSupabaseServerClient).mockResolvedValue(mockSupabase as any)
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as any)

    const req = new Request("https://sayabot.sayalabs.in/auth/callback?code=valid-auth-code")
    const res = await GET(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("https://sayabot.sayalabs.in/my-workspace")
  })

  it("formats user-friendly error when code exchange fails with PKCE missing verifier and cannot recover", async () => {
    const mockSupabase = {
      auth: {
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: "PKCE code verifier not found in storage. This can happen if..." },
        }),
      },
    }

    vi.mocked(createSupabaseServerClient).mockResolvedValue(mockSupabase as any)

    const req = new Request("https://sayabot.sayalabs.in/auth/callback?code=invalid-code")
    const res = await GET(req)
    expect(res.status).toBe(307)
    const location = res.headers.get("location")!
    expect(location).toContain("/login?error=")
    expect(decodeURIComponent(location)).toContain("Your email is verified! Please sign in with your email and password below.")
  })

  it("handles token_hash and type directly for SSR email verification", async () => {
    const mockSupabase = {
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: { user: { id: "user-456", email: "verified@example.com", user_metadata: {} } },
          error: null,
        }),
      },
    }
    const mockAdmin = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: "user-456", display_name: "member" } }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({}),
        }),
      }),
    }

    vi.mocked(createSupabaseServerClient).mockResolvedValue(mockSupabase as any)
    vi.mocked(createAdminClient).mockReturnValue(mockAdmin as any)

    const req = new Request("https://sayabot.sayalabs.in/auth/callback?token_hash=abc123hash&type=signup")
    const res = await GET(req)
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("https://sayabot.sayalabs.in/my-workspace")
  })
})
