import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

// A tiny in-memory stand-in for the admin client: org_plans rows and table counts.
const planRows = new Map<string, Record<string, unknown>>()
const counts: Record<string, number> = { agents: 0, org_members: 0, agent_computers: 0 }
let monthTurns = 0
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      const q = {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => {
          if (opts?.head) return { eq: () => Promise.resolve({ count: counts[table] ?? 0 }) }
          return q
        },
        eq: (col: string, value: unknown) => {
          filters[col] = value
          return q
        },
        maybeSingle: () => {
          if (table === "org_plans") {
            const row =
              (filters.org_id && planRows.get(String(filters.org_id))) ||
              [...planRows.values()].find((r) => r.customer_id === filters.customer_id)
            return Promise.resolve({ data: row ?? null })
          }
          if (table === "org_usage_monthly")
            return Promise.resolve({ data: { server_turns: monthTurns } })
          return Promise.resolve({ data: null })
        },
        upsert: (row: Record<string, unknown>) => {
          planRows.set(String(row.org_id), row)
          return Promise.resolve({ error: null })
        },
      }
      return q
    },
  }),
}))

const { stripeForm, verifyStripeSignature } = await import("@/ee/billing/stripe")
const { applyStripeEvent, planForPrice } = await import("@/ee/billing/service")
const { planGate } = await import("@/lib/plan-limits")

const SECRET = "whsec_test"
const sign = (payload: string, t: number, secret = SECRET) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`

describe("Stripe webhook signatures", () => {
  const now = 1_800_000_000
  const payload = '{"id":"evt_1"}'

  it("accepts a correctly signed, fresh event", () => {
    expect(verifyStripeSignature(payload, sign(payload, now), SECRET, now)).toBe(true)
  })

  it("refuses tampered, stale, unsigned or wrongly signed events", () => {
    expect(verifyStripeSignature('{"id":"evt_2"}', sign(payload, now), SECRET, now)).toBe(false)
    expect(verifyStripeSignature(payload, sign(payload, now - 3_600), SECRET, now)).toBe(false)
    expect(verifyStripeSignature(payload, null, SECRET, now)).toBe(false)
    expect(verifyStripeSignature(payload, sign(payload, now, "whsec_other"), SECRET, now)).toBe(
      false,
    )
    expect(verifyStripeSignature(payload, sign(payload, now), "", now)).toBe(false)
  })
})

describe("stripeForm", () => {
  it("encodes nested params the way Stripe expects", () => {
    const form = stripeForm({
      line_items: [{ price: "price_1", quantity: 1 }],
      metadata: { org_id: "o1" },
      skip: undefined,
    })
    expect(form.toString()).toBe(
      "line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&metadata%5Borg_id%5D=o1",
    )
  })
})

describe("applying Stripe events", () => {
  beforeEach(() => {
    planRows.clear()
    vi.stubEnv("STRIPE_PRICE_PRO", "price_pro")
    vi.stubEnv("STRIPE_PRICE_TEAM", "price_team")
  })
  afterEach(() => vi.unstubAllEnvs())

  const subscription = (over: Record<string, unknown> = {}) => ({
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: { org_id: "org-1" },
    items: { data: [{ price: { id: "price_pro" }, current_period_end: 1_800_000_000 }] },
    ...over,
  })

  it("maps prices to plans", () => {
    expect(planForPrice("price_pro")).toBe("pro")
    expect(planForPrice("price_team")).toBe("team")
    expect(planForPrice("price_other")).toBeNull()
  })

  it("an active subscription puts the workspace on its plan", async () => {
    await applyStripeEvent({
      id: "e1",
      type: "customer.subscription.updated",
      data: { object: subscription() },
    })
    expect(planRows.get("org-1")).toMatchObject({
      plan: "pro",
      status: "active",
      customer_id: "cus_1",
    })
  })

  it("finds the workspace by customer when metadata is missing", async () => {
    planRows.set("org-1", { org_id: "org-1", customer_id: "cus_1", plan: "pro" })
    await applyStripeEvent({
      id: "e2",
      type: "customer.subscription.updated",
      data: {
        object: subscription({ metadata: {}, items: { data: [{ price: { id: "price_team" } }] } }),
      },
    })
    expect(planRows.get("org-1")).toMatchObject({ plan: "team" })
  })

  it("a deleted subscription moves the workspace back to Free", async () => {
    await applyStripeEvent({
      id: "e3",
      type: "customer.subscription.deleted",
      data: { object: subscription() },
    })
    expect(planRows.get("org-1")).toMatchObject({
      plan: "free",
      status: "canceled",
      subscription_id: null,
    })
  })

  it("ignores events it doesn't handle", async () => {
    expect(await applyStripeEvent({ id: "e4", type: "invoice.paid", data: { object: {} } })).toBe(
      "ignored: invoice.paid",
    )
  })
})

describe("planGate", () => {
  beforeEach(() => {
    planRows.clear()
    counts.agents = 3
    counts.org_members = 1
    counts.agent_computers = 0
  })
  afterEach(() => vi.unstubAllEnvs())

  it("self-hosted servers have no limits", async () => {
    counts.agents = 10_000
    expect(await planGate("org-1", "agents")).toEqual({ ok: true })
  })

  it("on Sayabot Cloud, Free stops at 3 agents and points at Pro", async () => {
    vi.stubEnv("SAYABOT_EDITION", "cloud")
    const gate = await planGate("org-1", "agents")
    expect(gate.ok).toBe(false)
    if (gate.ok) return
    expect(gate.upgradeTo).toBe("pro")
    expect(gate.message).toBe(
      "The Free plan includes 3 agents. Upgrade to Pro in Settings → Plan & billing.",
    )
  })

  it("a paid plan lifts the limit", async () => {
    vi.stubEnv("SAYABOT_EDITION", "cloud")
    planRows.set("org-1", { org_id: "org-1", plan: "pro", status: "active" })
    expect(await planGate("org-1", "agents")).toEqual({ ok: true })
  })

  it("agent computers are paid-only", async () => {
    vi.stubEnv("SAYABOT_EDITION", "cloud")
    const gate = await planGate("org-1", "computers")
    expect(!gate.ok && gate.message).toContain("Agent computers are part of the paid plans.")
  })
})
