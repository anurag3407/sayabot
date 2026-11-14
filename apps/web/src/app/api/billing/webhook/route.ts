import { NextResponse } from "next/server"
import { applyStripeEvent } from "@/ee/billing/service"
import { verifyStripeSignature } from "@/ee/billing/stripe"
import { edition } from "@/lib/env"

export const dynamic = "force-dynamic"

/**
 * Stripe → Sayabot Cloud: plan changes, renewals, cancellations. Verified with the endpoint's
 * signing secret; anything unsigned is refused. Not present on self-hosted servers.
 */
export async function POST(request: Request) {
  if (edition() !== "cloud") return NextResponse.json({ error: "not found" }, { status: 404 })
  const secret = process.env.STRIPE_WEBHOOK_SECRET ?? ""
  const payload = await request.text()
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 })
  }
  let event: { id: string; type: string; data: { object: Record<string, unknown> } }
  try {
    event = JSON.parse(payload)
  } catch {
    return NextResponse.json({ error: "invalid payload" }, { status: 400 })
  }
  try {
    const outcome = await applyStripeEvent(event)
    console.log("[billing] stripe event", event.type, event.id, outcome)
    return NextResponse.json({ received: true })
  } catch (error) {
    // 500 makes Stripe retry later, so a brief database hiccup doesn't lose a payment.
    console.error("[billing] could not apply stripe event", event.type, event.id, error)
    return NextResponse.json({ error: "could not apply event" }, { status: 500 })
  }
}
