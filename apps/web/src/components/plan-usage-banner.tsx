"use client"

import Link from "next/link"
import { useState } from "react"

/**
 * Sayabot Cloud: a heads-up for admins before (and when) the month's server replies run out,
 * so nobody finds out from an agent's reply. Dismissible for the session.
 */
export function PlanUsageBanner({
  orgSlug,
  used,
  limit,
  planName,
}: {
  orgSlug: string
  used: number
  limit: number
  planName: string
}) {
  const [hidden, setHidden] = useState(false)
  if (hidden) return null
  const out = used >= limit
  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 border-b border-line bg-raised px-4 py-2 text-[13px] md:mx-2 md:mb-2 md:rounded-xl md:border"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${out ? "bg-danger" : "bg-warn"}`}
        aria-hidden="true"
      />
      <p className="min-w-0 flex-1 truncate text-muted">
        <span className="text-text">
          {out
            ? `This month's ${limit.toLocaleString("en-US")} server replies are used up.`
            : `${used.toLocaleString("en-US")} of ${limit.toLocaleString("en-US")} server replies used this month.`}
        </span>{" "}
        Agents on your Mac keep working on {planName}.
      </p>
      <Link
        href={`/${orgSlug}/settings/billing`}
        className="shrink-0 rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-void hover:bg-[var(--color-accent-strong)]"
      >
        {out ? "Upgrade" : "See plans"}
      </Link>
      <button
        type="button"
        onClick={() => setHidden(true)}
        className="shrink-0 text-[12px] text-faint hover:text-text"
        aria-label="Hide for now"
      >
        ✕
      </button>
    </div>
  )
}
