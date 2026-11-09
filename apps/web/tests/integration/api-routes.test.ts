import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

// Route handlers that need no auth/DB: health, oauth discovery, manifest.
import { GET as health } from "../../src/app/api/health/route"
import { GET as oauthDiscovery } from "../../src/app/.well-known/oauth-authorization-server/route"
import manifest from "../../src/app/manifest"

describe("web API routes (no auth required)", () => {
  it("GET /api/health is a no-store liveness probe", async () => {
    const res = health()
    expect(res.status).toBe(200)
    expect(res.headers.get("cache-control")).toBe("no-store")
    const body = (await res.json()) as any
    expect(body).toMatchObject({ ok: true, service: "sayabot-web" })
    expect("commit" in body).toBe(true)
    expect(body.commit).toBe(process.env.GIT_COMMIT_SHA ?? null)
  })

  it("GET /.well-known/oauth-authorization-server advertises S256 + code flow", async () => {
    const res = await oauthDiscovery()
    expect(res.status).toBe(200)
    const body = (await res.json()) as any
    expect(body.response_types_supported).toEqual(["code"])
    expect(body.grant_types_supported).toEqual(expect.arrayContaining(["authorization_code", "refresh_token"]))
    expect(body.code_challenge_methods_supported).toEqual(["S256"])
    expect(body.token_endpoint_auth_methods_supported).toEqual(["none"])
    expect(body.scopes_supported).toEqual(expect.arrayContaining(["room:read", "tasks:write", "secrets:use"]))
    expect(body.issuer).toMatch(/^https?:\/\//)
    expect(body.authorization_endpoint).toBe(body.issuer + "/oauth/authorize")
  })

  it("PWA manifest is well-formed", () => {
    const m = manifest()
    expect(m.name).toBe("Sayabot")
    expect(m.start_url).toBe("/")
    expect(m.display).toBe("standalone")
    expect(m.icons?.length).toBeGreaterThan(0)
  })
})

describe("POST /api/push + /api/messages auth gates", () => {
  it("rejects unauthenticated push subscriptions with 401 (no DB hit)", async () => {
    vi.resetModules()
    vi.doMock("../../src/lib/supabase/server", () => ({
      createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    }))
    const { POST } = await import("../../src/app/api/push/route")
    const res = await POST(new Request("http://x/api/push", { method: "POST", body: "{}" }))
    expect(res.status).toBe(401)
  })

  it("rejects unauthenticated /api/v1/computers/:agentId/exec with 401", async () => {
    vi.resetModules()
    vi.doMock("../../src/lib/supabase/server", () => ({
      createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
    }))
    const { POST } = await import("../../src/app/api/v1/[...path]/route")
    const res = await POST(
      new Request("http://x/api/v1/computers/agent-1/exec", {
        method: "POST",
        body: JSON.stringify({ cmd: "whoami" }),
      }),
      { params: Promise.resolve({ path: ["computers", "agent-1", "exec"] }) },
    )
    expect(res.status).toBe(401)
    const data = await res.json()
    expect(data.error).toBe("unauthorized")
  })

  it("rejects unauthorized /api/v1/tools/raw endpoints with 403", async () => {
    const { POST } = await import("../../src/app/api/v1/[...path]/route")
    const res = await POST(
      new Request("http://x/api/v1/tools/arbitrary", { method: "POST" }),
      { params: Promise.resolve({ path: ["tools", "arbitrary"] }) },
    )
    expect(res.status).toBe(403)
  })
})
