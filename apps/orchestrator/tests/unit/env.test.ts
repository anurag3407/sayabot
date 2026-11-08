import { afterEach, describe, expect, it, vi } from "vitest"

const BASE = {
  DATABASE_URL: "postgres://u:p@h/db",
  MESH_KEK: "k",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "svc",
  ORCHESTRATOR_INTERNAL_SECRET: "0123456789abcdef",
}

async function loadEnv(env: Record<string, string>) {
  vi.resetModules()
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
  const mod = await import("../../src/env")
  return mod
}

describe("orchestrator env", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it("parses the minimum required env and applies defaults", async () => {
    const { getEnv } = await loadEnv(BASE)
    const env = getEnv()
    expect(env.PORT).toBe(4000)
    expect(env.COMPUTERD_URL).toBe("http://localhost:4100")
    expect(env.EGRESS_URL).toBe("http://localhost:8081")
    expect(env.COMPUTE_ENABLED).toBe(false)
  })

  it("accepts SAYABOT_KEK / SAYABOT_* aliases over MESH_*", async () => {
    const { getEnv } = await loadEnv({ ...BASE, SAYABOT_KEK: "sayabot-kek" })
    expect(getEnv().MESH_KEK).toBe("sayabot-kek")
  })

  it("falls back to NEXT_PUBLIC_SUPABASE_URL", async () => {
    const { DATABASE_URL, MESH_KEK, SUPABASE_SERVICE_ROLE_KEY, ORCHESTRATOR_INTERNAL_SECRET } = BASE
    const { getEnv } = await loadEnv({ DATABASE_URL, MESH_KEK, SUPABASE_SERVICE_ROLE_KEY, ORCHESTRATOR_INTERNAL_SECRET, NEXT_PUBLIC_SUPABASE_URL: "https://next.supabase.co" })
    expect(getEnv().SUPABASE_URL).toBe("https://next.supabase.co")
  })

  it("throws a readable error listing every missing field", async () => {
    const { getEnv } = await loadEnv({ DATABASE_URL: "x" })
    expect(() => getEnv()).toThrow(/Invalid orchestrator environment/)
    expect(() => getEnv()).toThrow(/MESH_KEK/)
  })

  it("requires a >=16 char internal secret", async () => {
    const { getEnv } = await loadEnv({ ...BASE, ORCHESTRATOR_INTERNAL_SECRET: "short" })
    expect(() => getEnv()).toThrow(/ORCHESTRATOR_INTERNAL_SECRET/)
  })

  it("caches until resetEnvCache is called", async () => {
    const { getEnv, resetEnvCache } = await loadEnv(BASE)
    const a = getEnv()
    vi.stubEnv("PORT", "9999")
    expect(getEnv()).toBe(a)
    resetEnvCache()
    expect(getEnv().PORT).toBe(9999)
  })

  it("coerces string booleans strictly (only 'true' is true)", async () => {
    const { getEnv } = await loadEnv({ ...BASE, COMPUTE_ENABLED: "1", MESH_ALLOW_PRIVATE_WEBHOOKS: "TRUE" })
    expect(getEnv().COMPUTE_ENABLED).toBe(false)
    expect(getEnv().MESH_ALLOW_PRIVATE_WEBHOOKS).toBe(false)
  })
})
