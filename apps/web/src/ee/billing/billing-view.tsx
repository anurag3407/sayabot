"use client"

import { PLAN_ORDER, PLANS, type PlanId } from "@sayabot/core"
import { Check } from "lucide-react"
import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"
import { cn } from "@/lib/format"
import { openBillingPortalAction, startCheckoutAction } from "./actions"

/** Sayabot Commercial License: see ../LICENSE. */

export interface UsageRow {
  label: string
  used: number
  limit: number | null
  hint?: string
}

function Meter({ row }: { row: UsageRow }) {
  const ratio = row.limit === null ? 0 : row.limit === 0 ? 1 : Math.min(1, row.used / row.limit)
  const tone =
    row.limit === null
      ? "bg-accent"
      : ratio >= 1
        ? "bg-danger"
        : ratio >= 0.8
          ? "bg-warn"
          : "bg-accent"
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="text-text">{row.label}</span>
        <span className="font-mono text-[12px] text-muted">
          {row.used.toLocaleString("en-US")}
          {row.limit === null ? " · unlimited" : ` of ${row.limit.toLocaleString("en-US")}`}
        </span>
      </div>
      {row.limit === null ? null : (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-label={row.label}
          aria-valuemin={0}
          aria-valuemax={row.limit}
          aria-valuenow={row.used}
        >
          <div
            className={cn("h-full rounded-full transition-all", tone)}
            style={{ width: `${Math.max(ratio * 100, row.used ? 3 : 0)}%` }}
          />
        </div>
      )}
      {row.hint ? <p className="text-[12px] text-faint">{row.hint}</p> : null}
    </div>
  )
}

export function BillingView({
  orgSlug,
  plan,
  paying,
  configured,
  usage,
}: {
  orgSlug: string
  plan: PlanId
  paying: boolean
  configured: boolean
  usage: UsageRow[]
}) {
  const [pending, startTransition] = useTransition()
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const go = (target: PlanId | "portal") => {
    setError(null)
    setBusyPlan(target)
    startTransition(async () => {
      const result =
        target === "portal"
          ? await openBillingPortalAction({ orgSlug })
          : await startCheckoutAction({ orgSlug, plan: target })
      const url = typeof result.data?.url === "string" ? result.data.url : null
      if (!result.ok || !url) {
        setBusyPlan(null)
        setError(result.error ?? "Couldn't open billing. Try again.")
        return
      }
      window.location.assign(url)
    })
  }

  const rank = (id: PlanId) => PLAN_ORDER.indexOf(id)

  return (
    <div className="space-y-8">
      <div className="space-y-4 rounded-sm border border-line bg-panel p-4">
        {usage.map((row) => (
          <Meter key={row.label} row={row} />
        ))}
      </div>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {!configured ? (
        <InlineAlert tone="warning">
          Billing isn&apos;t set up on this server yet (Stripe keys missing), so plans can&apos;t be
          bought here.
        </InlineAlert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const option = PLANS[id]
          const current = id === plan
          const higher = rank(id) > rank(plan)
          return (
            <div
              key={id}
              className={cn(
                "flex flex-col rounded-sm border p-4",
                current ? "border-accent bg-accent/[0.06]" : "border-line bg-panel",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[15px] font-medium">{option.name}</h3>
                {current ? (
                  <span className="font-mono text-[11px] text-accent">your plan</span>
                ) : null}
              </div>
              <p className="mt-1 text-[22px] font-medium tracking-tight">
                {option.priceLabel}
                <span className="ml-1 text-[12px] font-normal text-faint">/ month</span>
              </p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{option.tagline}</p>
              <ul className="mt-3 flex-1 space-y-1.5">
                {option.highlights.map((line) => (
                  <li key={line} className="flex gap-2 text-[12.5px] text-text">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4">
                {current ? (
                  <Button variant="outline" size="md" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : higher ? (
                  <Button
                    variant="primary"
                    size="md"
                    className="w-full"
                    disabled={!configured || pending}
                    onClick={() => go(id)}
                  >
                    {busyPlan === id ? "Opening…" : `Upgrade to ${option.name}`}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="md"
                    className="w-full"
                    disabled={!configured || pending || !paying}
                    onClick={() => go("portal")}
                  >
                    {paying ? `Switch to ${option.name}` : option.name}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {paying ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="text-[13px] text-muted">
            Invoices, payment method, plan changes and cancelling.
          </p>
          <Button
            variant="secondary"
            size="md"
            disabled={!configured || pending}
            onClick={() => go("portal")}
          >
            {busyPlan === "portal" ? "Opening…" : "Manage billing"}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
