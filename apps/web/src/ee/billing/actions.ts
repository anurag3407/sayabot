"use server"

import { isPlanId } from "@sayabot/core"
import { headers } from "next/headers"
import { adminOrgAccess, fail, ok } from "@/lib/actions/shared"
import { edition } from "@/lib/env"
import { workspacePlan } from "@/lib/plan-limits"
import { getPublicOrigin } from "@/lib/public-origin"
import type { ActionResult } from "@/lib/types"
import { billingConfigured, createCheckout, createPortal } from "./service"
import { StripeError } from "./stripe"

/** Sayabot Commercial License: see ../LICENSE. */

async function origin(): Promise<string> {
  const h = await headers()
  return getPublicOrigin(new Request("http://localhost", { headers: h }))
}

function friendly(error: unknown): string {
  if (error instanceof StripeError) return `Payment provider: ${error.message}`
  return "Couldn't reach the payment provider. Try again in a moment."
}

/** "Upgrade to Pro": a Stripe Checkout page for this workspace. Returns its URL. */
export async function startCheckoutAction(input: {
  orgSlug: string
  plan: string
}): Promise<ActionResult> {
  if (edition() !== "cloud") return fail("Plans are only on Sayabot Cloud.")
  if (!billingConfigured()) return fail("Billing isn't set up on this server yet.")
  if (!isPlanId(input.plan) || input.plan === "free") return fail("Pick Pro or Team.")
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error ?? "Only workspace admins can change the plan")
  const current = await workspacePlan(check.access.org.id)
  // Already paying: plan changes and cancellations happen in the billing portal.
  if (current.plan !== "free" && current.customerId) {
    try {
      const url = await createPortal(
        current.customerId,
        `${await origin()}/${input.orgSlug}/settings/billing`,
      )
      return ok("Opening billing", { url })
    } catch (error) {
      return fail(friendly(error))
    }
  }
  try {
    const url = await createCheckout({
      orgId: check.access.org.id,
      orgSlug: input.orgSlug,
      plan: input.plan,
      email: check.access.user.email ?? null,
      customerId: current.customerId,
      origin: await origin(),
    })
    return ok("Opening checkout", { url })
  } catch (error) {
    return fail(friendly(error))
  }
}

/** "Manage billing": Stripe's portal for invoices, card, plan changes and cancelling. */
export async function openBillingPortalAction(input: { orgSlug: string }): Promise<ActionResult> {
  if (edition() !== "cloud" || !billingConfigured())
    return fail("Billing isn't set up on this server.")
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error ?? "Only workspace admins can manage billing")
  const current = await workspacePlan(check.access.org.id)
  if (!current.customerId) return fail("This workspace hasn't paid for a plan yet.")
  try {
    const url = await createPortal(
      current.customerId,
      `${await origin()}/${input.orgSlug}/settings/billing`,
    )
    return ok("Opening billing", { url })
  } catch (error) {
    return fail(friendly(error))
  }
}
