import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { GET } from "@/app/api/desktop/guest/route"

describe("desktop guest mode config route", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("is on by default and returns the public Supabase settings", async () => {
    vi.stubEnv("DESKTOP_GUEST_MODE", "")
    const res = await GET()
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json).toEqual({
      enabled: true,
      supabaseUrl: "https://example.supabase.co",
      anonKey: "test-anon-key",
    })
  })

  it.each(["false", "0", "off", "FALSE"])("is off when DESKTOP_GUEST_MODE=%s", async (value) => {
    vi.stubEnv("DESKTOP_GUEST_MODE", value)
    const json = (await (await GET()).json()) as any
    expect(json).toEqual({ enabled: false })
  })

  it("reports off instead of failing when Supabase is not configured", async () => {
    vi.stubEnv("DESKTOP_GUEST_MODE", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    const json = (await (await GET()).json()) as any
    expect(json.enabled).toBe(false)
  })
})
