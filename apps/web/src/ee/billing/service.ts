import "server-only"
import { isPlanId, type PlanId } from "@sayabot/core"
import { createAdminClient } from "@/lib/supabase/admin"
import { stripe } from "./stripe"

/**
 * Sayabot Cloud billing: checkout, the billing portal, and keeping org_plans in step with
 * Stripe's webhooks. Sayabot Commercial License: see ../LICENSE.
 */

export function priceFor(plan: PlanId): string | null {
  if (plan === "pro") return process.env.STRIPE_PRICE_PRO || null
  if (plan === "team") return process.env.STRIPE_PRICE_TEAM || null
  return null
}

export function planForPrice(priceId: string | null | undefined): PlanId | null {
  if (!priceId) return null
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro"
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team"
  return null
}

/** Billing is usable once the secret key, the webhook secret and both prices are set. */
export function billingConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.STRIPE_PRICE_PRO &&
    process.env.STRIPE_PRICE_TEAM,
  )
}

export async function createCheckout(input: {
  orgId: string
  orgSlug: string
  plan: PlanId
  email: string | null
  customerId: string | null
  origin: string
}): Promise<string> {
  const price = priceFor(input.plan)
  if (!price) throw new Error("That plan can't be bought here.")
  const back = `${input.origin}/${input.orgSlug}/settings/billing`
  const session = await stripe<{ url: string }>("/checkout/sessions", {
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: input.orgId,
    ...(input.customerId
      ? { customer: input.customerId }
      : input.email
        ? { customer_email: input.email }
        : {}),
    metadata: { org_id: input.orgId, plan: input.plan },
    subscription_data: { metadata: { org_id: input.orgId, plan: input.plan } },
    allow_promotion_codes: true,
    success_url: `${back}?upgraded=${input.plan}`,
    cancel_url: `${back}?canceled=1`,
  })
  return session.url
}

export async function createPortal(customerId: string, returnUrl: string): Promise<string> {
  const session = await stripe<{ url: string }>("/billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  })
  return session.url
}

interface StripeSubscription {
  id: string
  customer: string
  status: string
  cancel_at_period_end?: boolean
  current_period_end?: number
  metadata?: Record<string, string>
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> }
}

interface StripeEvent {
  id: string
  type: string
  data: { object: Record<string, unknown> }
}

async function orgForCustomer(customerId: string): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("org_plans")
    .select("org_id")
    .eq("customer_id", customerId)
    .maybeSingle()
  return (data?.org_id as string | undefined) ?? null
}

async function savePlan(orgId: string, sub: StripeSubscription, ended = false): Promise<void> {
  const item = sub.items?.data?.[0]
  const fromPrice = planForPrice(item?.price?.id)
  const fromMeta = isPlanId(sub.metadata?.plan) ? sub.metadata?.plan : null
  const plan: PlanId = ended ? "free" : (fromPrice ?? fromMeta ?? "free")
  const periodEnd = item?.current_period_end ?? sub.current_period_end
  const { error } = await createAdminClient()
    .from("org_plans")
    .upsert(
      {
        org_id: orgId,
        plan,
        status: ended ? "canceled" : sub.status,
        provider: "stripe",
        customer_id: sub.customer,
        subscription_id: ended ? null : sub.id,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: Boolean(sub.cancel_at_period_end),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    )
  if (error) throw new Error(`could not save the plan: ${error.message}`)
}

/** Applies one verified Stripe event. Unknown event types are ignored. */
export async function applyStripeEvent(event: StripeEvent): Promise<string> {
  const object = event.data.object
  if (event.type === "checkout.session.completed") {
    const meta = (object.metadata ?? {}) as Record<string, string>
    const orgId = meta.org_id || (object.client_reference_id as string | undefined)
    const subscriptionId = object.subscription as string | undefined
    if (!orgId || !subscriptionId) return "ignored: no workspace or subscription"
    const sub = await stripe<StripeSubscription>(
      `/subscriptions/${subscriptionId}`,
      undefined,
      "GET",
    )
    await savePlan(orgId, sub)
    return `plan saved for ${orgId}`
  }
  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = object as unknown as StripeSubscription
    const orgId = sub.metadata?.org_id || (await orgForCustomer(sub.customer))
    if (!orgId) return "ignored: unknown customer"
    await savePlan(orgId, sub, event.type === "customer.subscription.deleted")
    return `plan updated for ${orgId}`
  }
  return `ignored: ${event.type}`
}
