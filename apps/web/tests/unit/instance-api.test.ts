import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const { GET } = await import("../../src/app/api/instance/route")

describe("GET /api/instance", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("says it's Sayabot, self-hosted by default, with its own public Supabase config", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://own.example")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    vi.stubEnv("SAYABOT_INSTANCE_NAME", "Acme's Sayabot")
    const res = GET(
      new Request("https://sayabot.acme.com/api/instance", {
        headers: { host: "sayabot.acme.com", "x-forwarded-proto": "https" },
      }),
    )
    const body = await res.json()
    expect(body).toMatchObject({
      sayabot: true,
      name: "Acme's Sayabot",
      edition: "self-hosted",
      url: "https://sayabot.acme.com",
      supabase: { url: "https://own.example", anonKey: "anon-key" },
    })
    expect(JSON.stringify(body)).not.toMatch(/service|secret|kek/i)
    expect(res.headers.get("access-control-allow-origin")).toBe("*")
  })

  it("reports the cloud edition when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "k")
    vi.stubEnv("SAYABOT_EDITION", "cloud")
    const body = await GET(new Request("https://x/api/instance")).json()
    expect(body.edition).toBe("cloud")
    expect(body.name).toBe("Sayabot")
  })
})
