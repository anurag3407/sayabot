import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/ee/billing/actions", () => ({
  startCheckoutAction: vi.fn(),
  openBillingPortalAction: vi.fn(),
}))

const { BillingView } = await import("@/ee/billing/billing-view")

const usage = [
  {
    label: "Server replies this month",
    used: 250,
    limit: 300,
    hint: "Replies from agents running on your Mac don't count.",
  },
  { label: "Agents", used: 2, limit: 3 },
  { label: "Agent computers", used: 0, limit: null },
]
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")

describe("Plan & billing page", () => {
  it("on Free: usage, Mac note, and an obvious upgrade path", () => {
    const html = renderToStaticMarkup(
      createElement(BillingView, {
        orgSlug: "acme",
        plan: "free",
        paying: false,
        configured: true,
        usage,
      }),
    )
    const t = text(html)
    expect(t).toContain("250 of 300")
    expect(t).toContain("Replies from agents running on your Mac don't count.")
    expect(t).toContain("0 · unlimited")
    expect(t).toContain("Current plan")
    expect(t).toContain("Upgrade to Pro")
    expect(t).toContain("Upgrade to Team")
    expect(t).not.toContain("Manage billing")
    // 250/300 is past 80%: the bar warns.
    expect(html).toContain("bg-warn")
    expect(html).toContain('aria-valuenow="250"')
  })

  it("when paying: switch plans and manage billing in the portal", () => {
    const t = text(
      renderToStaticMarkup(
        createElement(BillingView, {
          orgSlug: "acme",
          plan: "pro",
          paying: true,
          configured: true,
          usage,
        }),
      ),
    )
    expect(t).toContain("Switch to Free")
    expect(t).toContain("Upgrade to Team")
    expect(t).toContain("Manage billing")
  })

  it("explains when the server has no Stripe keys yet", () => {
    const t = text(
      renderToStaticMarkup(
        createElement(BillingView, {
          orgSlug: "acme",
          plan: "free",
          paying: false,
          configured: false,
          usage,
        }),
      ),
    )
    expect(t).toContain("Billing isn't set up on this server yet")
  })
})
