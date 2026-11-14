import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Billing end to end through Sayabot's own code: the Upgrade action, Stripe Checkout, the signed
 * webhook and the plan it saves. Only Stripe's HTTP API is faked (fetch), plus the database.
 */

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "sayabot.sayalabs.in", "x-forwarded-proto": "https" }),
}))
vi.mock("@/lib/actions/shared", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/actions/shared")>("@/lib/actions/shared")
  return {
    ...actual,
    adminOrgAccess: async (slug: string) =>
      slug === "acme"
        ? {
            access: {
              org: { id: "org-1", slug: "acme" },
              user: { id: "u1", email: "owner@acme.dev" },
            },
          }
        : { error: "Only organization admins can do this" },
  }
})

const planRows = new Map<string, Record<string, unknown>>()
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {}
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => ((filters[col] = v), q),
        maybeSingle: async () => ({
          data:
            (filters.org_id && planRows.get(String(filters.org_id))) ||
            [...planRows.values()].find((r) => r.customer_id === filters.customer_id) ||
            null,
        }),
        upsert: async (row: Record<string, unknown>) => (
          planRows.set(String(row.org_id), row),
          { error: null }
        ),
      }
      return q
    },
  }),
}))

const stripeCalls: Array<{ url: string; method: string; body: URLSearchParams | null }> = []
const SUBSCRIPTION = {
  id: "sub_1",
  customer: "cus_1",
  status: "active",
  cancel_at_period_end: false,
  metadata: { org_id: "org-1", plan: "pro" },
  items: { data: [{ price: { id: "price_pro" }, current_period_end: 1_900_000_000 }] },
}

beforeEach(() => {
  planRows.clear()
  stripeCalls.length = 0
  vi.stubEnv("SAYABOT_EDITION", "cloud")
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123")
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test")
  vi.stubEnv("STRIPE_PRICE_PRO", "price_pro")
  vi.stubEnv("STRIPE_PRICE_TEAM", "price_team")
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const url = String(input)
    stripeCalls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? new URLSearchParams(String(init.body)) : null,
    })
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk_test_123")
    if (url.endsWith("/checkout/sessions"))
      return Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_1" })
    if (url.endsWith("/billing_portal/sessions"))
      return Response.json({ url: "https://billing.stripe.com/p/session_1" })
    if (url.endsWith("/subscriptions/sub_1")) return Response.json(SUBSCRIPTION)
    return Response.json({ error: { message: "unexpected" } }, { status: 404 })
  })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const { startCheckoutAction, openBillingPortalAction } = await import("@/ee/billing/actions")
const { POST: webhook } = await import("../../src/app/api/billing/webhook/route")

function signedRequest(event: unknown, secret = "whsec_test") {
  const payload = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")
  return new Request("https://sayabot.sayalabs.in/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": `t=${t},v1=${v1}` },
    body: payload,
  })
}

describe("upgrading a workspace", () => {
  it("Upgrade to Pro opens Stripe Checkout for this workspace", async () => {
    const result = await startCheckoutAction({ orgSlug: "acme", plan: "pro" })
    expect(result).toMatchObject({
      ok: true,
      data: { url: "https://checkout.stripe.com/c/pay/cs_test_1" },
    })
    const call = stripeCalls[0]
    expect(call?.url).toBe("https://api.stripe.com/v1/checkout/sessions")
    const body = call?.body
    expect(body?.get("mode")).toBe("subscription")
    expect(body?.get("line_items[0][price]")).toBe("price_pro")
    expect(body?.get("client_reference_id")).toBe("org-1")
    expect(body?.get("metadata[org_id]")).toBe("org-1")
    expect(body?.get("subscription_data[metadata][org_id]")).toBe("org-1")
    expect(body?.get("customer_email")).toBe("owner@acme.dev")
    expect(body?.get("success_url")).toBe(
      "https://sayabot.sayalabs.in/acme/settings/billing?upgraded=pro",
    )
    expect(body?.get("cancel_url")).toBe(
      "https://sayabot.sayalabs.in/acme/settings/billing?canceled=1",
    )
  })

  it("the signed checkout webhook moves the workspace to Pro", async () => {
    const res = await webhook(
      signedRequest({
        id: "evt_1",
        type: "checkout.session.completed",
        data: {
          object: {
            client_reference_id: "org-1",
            subscription: "sub_1",
            metadata: { org_id: "org-1" },
          },
        },
      }),
    )
    expect(res.status).toBe(200)
    expect(stripeCalls.map((c) => c.url)).toContain("https://api.stripe.com/v1/subscriptions/sub_1")
    expect(planRows.get("org-1")).toMatchObject({
      plan: "pro",
      status: "active",
      customer_id: "cus_1",
      subscription_id: "sub_1",
      current_period_end: new Date(1_900_000_000 * 1000).toISOString(),
    })
  })

  it("once paying, Upgrade and Manage billing open the customer portal", async () => {
    planRows.set("org-1", { org_id: "org-1", plan: "pro", status: "active", customer_id: "cus_1" })
    expect(await startCheckoutAction({ orgSlug: "acme", plan: "team" })).toMatchObject({
      ok: true,
      data: { url: "https://billing.stripe.com/p/session_1" },
    })
    expect(await openBillingPortalAction({ orgSlug: "acme" })).toMatchObject({ ok: true })
    expect(stripeCalls.every((c) => c.url.endsWith("/billing_portal/sessions"))).toBe(true)
    expect(stripeCalls[0]?.body?.get("customer")).toBe("cus_1")
  })

  it("a forged webhook changes nothing", async () => {
    const res = await webhook(
      signedRequest(
        { id: "evt_x", type: "customer.subscription.updated", data: { object: SUBSCRIPTION } },
        "whsec_attacker",
      ),
    )
    expect(res.status).toBe(400)
    expect(planRows.size).toBe(0)
  })

  it("only admins of the workspace can start checkout; self-hosted servers have no billing", async () => {
    expect(await startCheckoutAction({ orgSlug: "other", plan: "pro" })).toMatchObject({
      ok: false,
    })
    vi.stubEnv("SAYABOT_EDITION", "self-hosted")
    expect(await startCheckoutAction({ orgSlug: "acme", plan: "pro" })).toMatchObject({
      ok: false,
      error: "Plans are only on Sayabot Cloud.",
    })
    const res = await webhook(signedRequest({ id: "e", type: "x", data: { object: {} } }))
    expect(res.status).toBe(404)
    expect(stripeCalls).toHaveLength(0)
  })
})
