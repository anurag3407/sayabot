import { afterEach, describe, expect, it, vi } from "vitest"

async function load() {
  vi.resetModules()
  vi.stubEnv("DATABASE_URL", "postgres://u:p@h/db")
  vi.stubEnv("MESH_KEK", "k")
  vi.stubEnv("SUPABASE_URL", "https://x.supabase.co")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "svc")
  vi.stubEnv("ORCHESTRATOR_INTERNAL_SECRET", "0123456789abcdef")
  return import("../../src/internal-auth")
}

describe("isInternalRequest", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })

  it("accepts the secret via x-internal-secret header", async () => {
    const { isInternalRequest } = await load()
    expect(isInternalRequest(undefined, "0123456789abcdef")).toBe(true)
  })

  it("accepts the secret via Bearer token", async () => {
    const { isInternalRequest } = await load()
    expect(isInternalRequest("Bearer 0123456789abcdef")).toBe(true)
  })

  it("prefers the explicit header over Authorization", async () => {
    const { isInternalRequest } = await load()
    expect(isInternalRequest("Bearer wrong", "0123456789abcdef")).toBe(true)
    expect(isInternalRequest("Bearer 0123456789abcdef", "wrong")).toBe(false)
  })

  it("rejects missing, wrong, and different-length secrets without throwing", async () => {
    const { isInternalRequest } = await load()
    expect(isInternalRequest(undefined)).toBe(false)
    expect(isInternalRequest(undefined, "short")).toBe(false)
    expect(isInternalRequest(undefined, "")).toBe(false)
    expect(isInternalRequest("Bearer ")).toBe(false)
  })
})
