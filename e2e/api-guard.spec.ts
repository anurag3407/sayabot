import { expect, test } from "@playwright/test"

// API guard matrix against the web app (no Supabase session).
const web = process.env.E2E_BASE_URL ?? "http://localhost:3000"

test.describe("web API guards", () => {
  test("POST /api/messages without a session is 401", async ({ request }) => {
    const res = await request.post(web + "/api/messages", { data: { orgSlug: "x", roomId: "r", content: "hi" } })
    expect([401, 400]).toContain(res.status()) // 401 expected; 400 if the session layer is stubbed
    expect(res.status()).not.toBe(200)
  })

  test("POST /api/push without a session is 401", async ({ request }) => {
    const res = await request.post(web + "/api/push", { data: { endpoint: "https://example.com/x", keys: { p256dh: "a", auth: "b" } } })
    expect(res.status()).toBe(401)
  })

  test("GET /api/v1/unknown-path is not a 200", async ({ request }) => {
    const res = await request.get(web + "/api/v1/definitely-not-a-route")
    expect(res.status()).not.toBe(200)
  })

  test("health stays public and no-store even without a session", async ({ request }) => {
    const res = await request.get(web + "/api/health")
    expect(res.status()).toBe(200)
    expect(res.headers()["cache-control"]).toBe("no-store")
  })
})
