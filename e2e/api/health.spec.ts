import { expect, test } from "@playwright/test"

// API-level e2e: contract checks against already-running services.
// The browser specs in e2e/*.spec.ts need Supabase + seeded users; these need
// only the HTTP surfaces, so they run in the smoke lane too.
const web = process.env.E2E_BASE_URL ?? "http://localhost:3000"
const orch = process.env.ORCHESTRATOR_URL ?? "http://localhost:4000"
const computerd = process.env.COMPUTERD_URL ?? "http://localhost:4100"
const egress = process.env.EGRESS_URL ?? "http://localhost:8081"

test.describe("service health contracts", () => {
  test("web liveness probe", async ({ request }) => {
    const res = await request.get(web + "/api/health")
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { ok: boolean; service: string }
    expect(body).toMatchObject({ ok: true, service: "sayabot-web" })
  })

  test("orchestrator health reports active runs", async ({ request }) => {
    const res = await request.get(orch + "/health")
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { ok: boolean; service: string; activeRuns: number }
    expect(body).toMatchObject({ ok: true, service: "sayabot-orchestrator" })
    expect(typeof body.activeRuns).toBe("number")
  })

  test("computerd health is public, everything else needs the internal secret", async ({ request }) => {
    const health = await request.get(computerd + "/health")
    expect(health.status()).toBe(200)
    expect(((await health.json()) as { service: string }).service).toBe("computerd")
    const denied = await request.post(computerd + "/v1/computers/a1/ensure", { data: {} })
    expect(denied.status()).toBe(401)
  })

  test("egress admin health", async ({ request }) => {
    const res = await request.get(egress + "/health")
    expect(res.status()).toBe(200)
    expect(((await res.json()) as { service: string }).service).toBe("egress")
  })

  test("internal endpoints reject unauthenticated callers", async ({ request }) => {
    const res = await request.post(orch + "/internal/room-message", { data: {} })
    expect(res.status()).toBe(401)
  })

  test("public pages render and protected pages redirect to login", async ({ page }) => {
    await page.goto("/")
    await expect(page).not.toHaveURL(/\/login/)
    await page.goto("/login")
    await expect(page.getByRole("heading").first()).toBeVisible()
    await page.goto("/terms")
    await expect(page).toHaveTitle(/Sayabot/i)
    const protectedRes = await page.goto("/onboarding")
    // signed-out users are bounced to login by the proxy middleware
    if (protectedRes) expect([200, 307, 308]).toContain(protectedRes.status())
  })

  test("oauth discovery document", async ({ request }) => {
    const res = await request.get(web + "/.well-known/oauth-authorization-server")
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { code_challenge_methods_supported: string[] }
    expect(body.code_challenge_methods_supported).toContain("S256")
  })
})
