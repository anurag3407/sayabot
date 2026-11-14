import { PLANS } from "@sayabot/core"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Section } from "@/components/settings/section"
import { InlineAlert } from "@/components/ui/empty"
import { BillingView } from "@/ee/billing/billing-view"
import { billingConfigured } from "@/ee/billing/service"
import { requireOrgAdmin } from "@/lib/auth"
import { edition } from "@/lib/env"
import { workspacePlan, workspaceUsage } from "@/lib/plan-limits"

export const metadata: Metadata = { title: "Plan & billing" }

function nextMonthStart(): string {
  const now = new Date()
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return first.toLocaleDateString("en-US", { month: "long", day: "numeric" })
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>
  searchParams: Promise<{ upgraded?: string; canceled?: string }>
}) {
  // Plans only exist on Sayabot Cloud; a self-hosted server has no limits and no billing.
  if (edition() !== "cloud") notFound()
  const { org: orgSlug } = await params
  const query = await searchParams
  const access = await requireOrgAdmin(orgSlug)
  const [current, usage] = await Promise.all([
    workspacePlan(access.org.id),
    workspaceUsage(access.org.id),
  ])
  const plan = PLANS[current.plan]
  const periodEnd = current.currentPeriodEnd
    ? new Date(current.currentPeriodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null
  const upgradedTo =
    query.upgraded && query.upgraded in PLANS ? PLANS[query.upgraded as keyof typeof PLANS] : null

  return (
    <>
      {upgradedTo ? (
        <InlineAlert tone="success">
          Thanks! {access.org.name} is moving to {upgradedTo.name}. It can take a few seconds to
          show here; refresh if it still says {plan.name}.
        </InlineAlert>
      ) : null}
      {query.canceled ? (
        <InlineAlert tone="neutral">Checkout was canceled. Nothing changed.</InlineAlert>
      ) : null}
      {current.status === "past_due" ? (
        <InlineAlert tone="warning">
          The last payment didn&apos;t go through. Update your card in Manage billing to keep{" "}
          {plan.name}.
        </InlineAlert>
      ) : null}

      <Section
        title={`You're on ${plan.name}`}
        description={
          current.plan === "free"
            ? `Server replies reset on ${nextMonthStart()}. Agents that run on your Mac are unlimited on every plan.`
            : current.cancelAtPeriodEnd && periodEnd
              ? `${plan.name} ends on ${periodEnd}; after that the workspace moves to Free.`
              : periodEnd
                ? `Renews on ${periodEnd}. Server replies reset on ${nextMonthStart()}.`
                : `Server replies reset on ${nextMonthStart()}.`
        }
      >
        <BillingView
          orgSlug={orgSlug}
          plan={current.plan}
          paying={current.plan !== "free" && Boolean(current.customerId)}
          configured={billingConfigured()}
          usage={[
            {
              label: "Server replies this month",
              used: usage.serverTurns,
              limit: plan.limits.serverTurnsPerMonth,
              hint: "Replies from agents running on your Mac don't count.",
            },
            { label: "Agents", used: usage.agents, limit: plan.limits.agents },
            { label: "People", used: usage.members, limit: plan.limits.members },
            { label: "Agent computers", used: usage.computers, limit: plan.limits.computers },
          ]}
        />
      </Section>
    </>
  )
}
