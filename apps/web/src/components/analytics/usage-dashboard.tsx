"use client"

import Link from "next/link"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { computeCacheSavingsUsd, pickModelPrice } from "@sayabot/core"
import { cn, formatMs, formatNumber, formatPercent, formatTokens } from "@/lib/format"
import type { UsageRollupRow } from "@/lib/usage-math"
import {
  providerLabel,
  rowFromEvent,
  rowFromRollup,
  speed,
  summarize,
  timeSeries,
  type Bucket,
  type ModelBucket,
  type RawEvent,
  type UsageRow,
} from "@/lib/usage-summary"
import { Mascot } from "@/components/ui/mascot"
import { UsageBars, seriesColor } from "./usage-bars"

export type UsageEventRow = RawEvent

export interface ModelPricingInfo {
  provider: string
  model: string
  inputPerMtok: number
  outputPerMtok: number
}

type Source = "sayabot" | "local"
type Metric = "tokens" | "cost"
type GroupBy = "agent" | "model"

const PERIODS = [
  { days: 1, label: "24 hours" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
]

/** Money for people: no six-decimal fractions of a cent. */
export function money(value: number): string {
  if (value <= 0) return "$0"
  if (value < 0.01) return "< $0.01"
  if (value < 1000) return `$${value.toFixed(2)}`
  return `$${Math.round(value).toLocaleString()}`
}

/** A token is roughly three quarters of an English word. */
function words(tokens: number): string {
  return `≈ ${formatTokens(Math.round(tokens * 0.75))} words`
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-panel p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "h-8 rounded-full px-3.5 text-[13px] transition-colors",
            value === option.value ? "bg-raised font-medium text-text" : "text-muted hover:text-text",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function Stat({
  label,
  value,
  note,
  children,
}: {
  label: string
  value: string
  note: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="rounded-[22px] bg-panel p-5">
      <p className="text-[13px] text-muted">{label}</p>
      <p className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.02em] text-text tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[12.5px] leading-snug text-faint">{note}</p>
      {children}
    </div>
  )
}

function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  return (
    <p
      className={cn(
        "rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed",
        tone === "warn" ? "bg-warn/10 text-text" : "bg-panel text-muted",
      )}
    >
      {children}
    </p>
  )
}

function ShareBar({ share, color }: { share: number; color: string }) {
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-raised" aria-hidden="true">
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(2, Math.round(share * 100))}%`, backgroundColor: color }}
      />
    </div>
  )
}

function ListCard({
  title,
  empty,
  children,
}: {
  title: string
  empty: string
  children: ReactNode[]
}) {
  return (
    <section className="rounded-[22px] bg-panel p-5">
      <h2 className="text-[15px] font-semibold text-text">{title}</h2>
      {children.length ? (
        <ul className="mt-3 space-y-3.5">{children}</ul>
      ) : (
        <p className="mt-3 text-[13px] text-faint">{empty}</p>
      )}
    </section>
  )
}

function DetailTile({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl bg-raised/60 p-4">
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="mt-1 text-[19px] font-semibold text-text tabular-nums">{value}</p>
      <p className="mt-1 text-[12px] leading-snug text-faint">{note}</p>
    </div>
  )
}

export function UsageDashboard({
  events,
  eventsComplete,
  rollup,
  agents,
  rooms,
  pricing,
  orgSlug,
  days,
  sinceIso,
  canEditPrices,
}: {
  /** Newest raw calls in the period (up to the sample cap), for charts and speed. */
  events: UsageEventRow[]
  /** False when the period had more calls than the sample holds. */
  eventsComplete: boolean
  /** Exact totals from the database; null if that function isn't installed yet. */
  rollup: UsageRollupRow[] | null
  agents: { id: string; handle: string; displayName: string }[]
  rooms: { id: string; name: string; kind: "public" | "private" | "dm" }[]
  pricing: ModelPricingInfo[]
  orgSlug: string
  days: number
  sinceIso: string
  canEditPrices: boolean
}) {
  const [source, setSource] = useState<Source>("sayabot")
  const [metric, setMetric] = useState<Metric>("tokens")
  const [groupBy, setGroupBy] = useState<GroupBy>("agent")
  const [local, setLocal] = useState<{ available: boolean; loading: boolean; events: UsageEventRow[] }>({
    available: false,
    loading: true,
    events: [],
  })

  // Reading coding-tool logs only works when Sayabot runs on this computer; the route says so.
  useEffect(() => {
    let cancelled = false
    setLocal((state) => ({ ...state, loading: true }))
    fetch(`/api/usage/local?days=${days}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { available?: boolean; events?: UsageEventRow[] } | null) => {
        if (cancelled) return
        setLocal({
          available: Boolean(data?.available),
          loading: false,
          events: Array.isArray(data?.events) ? data.events : [],
        })
      })
      .catch(() => {
        if (!cancelled) setLocal({ available: false, loading: false, events: [] })
      })
    return () => {
      cancelled = true
    }
  }, [days])

  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const roomsById = useMemo(() => new Map(rooms.map((room) => [room.id, room])), [rooms])
  const isLocal = source === "local"

  // Totals use exact database sums when we have them; charts and speed use real calls.
  const { exactRows, sampleRows } = useMemo(() => {
    if (isLocal) {
      const rows = local.events.map(rowFromEvent)
      return { exactRows: rows, sampleRows: rows }
    }
    const sample = events.map(rowFromEvent)
    return { exactRows: rollup ? rollup.map(rowFromRollup) : sample, sampleRows: sample }
  }, [isLocal, local.events, events, rollup])

  const names = useMemo(
    () => ({
      agent: (id: string | null) => {
        if (isLocal) return "Coding tools"
        if (!id) return "Behind the scenes"
        return agentsById.get(id)?.displayName ?? "Removed agent"
      },
      room: (id: string | null) => {
        if (isLocal) return "Coding session"
        if (!id) return "Outside a chat"
        const room = roomsById.get(id)
        if (!room) return "Private or deleted chat"
        return room.kind === "public" ? `#${room.name}` : room.name
      },
    }),
    [isLocal, agentsById, roomsById],
  )

  const summary = useMemo(() => summarize(exactRows, pricing, names), [exactRows, pricing, names])
  const timing = useMemo(() => speed(sampleRows), [sampleRows])

  const cacheSavings = useMemo(
    () =>
      exactRows.reduce((sum, row) => {
        const price = pickModelPrice(pricing, row.provider, row.model)
        return sum + computeCacheSavingsUsd({ cachedInputTokens: row.cached }, price)
      }, 0),
    [exactRows, pricing],
  )

  const effectiveGroup: GroupBy = isLocal ? "model" : groupBy
  const keep = useMemo(
    () => (effectiveGroup === "agent" ? summary.byAgent : summary.byModel).map((bucket) => bucket.key),
    [effectiveGroup, summary],
  )
  const chart = useMemo(
    () =>
      timeSeries(sampleRows, {
        sinceIso,
        hourly: days === 1,
        metric,
        keep,
        groupBy: (row: UsageRow) =>
          effectiveGroup === "agent"
            ? { id: row.agentId ?? "none", label: names.agent(row.agentId) }
            : {
                id: `${row.provider}:${row.model}`,
                label: summary.byModel.find((m) => m.key === `${row.provider}:${row.model}`)?.label ?? row.model,
              },
      }),
    [sampleRows, sinceIso, days, metric, keep, effectiveGroup, names, summary.byModel],
  )

  // Colours follow the entity, so a list row and its bar always match.
  const colorFor = (bucket: Bucket, kind: GroupBy) => {
    if (kind !== effectiveGroup) return "var(--color-line-strong)"
    const index = chart.series.findIndex((item) => item.id === bucket.key)
    return index === -1 ? seriesColor(99, "other") : seriesColor(index, chart.series[index]?.id ?? "")
  }

  const show = (bucket: Bucket) => (metric === "cost" ? money(bucket.cost) : formatTokens(bucket.tokens))
  const shareOf = (bucket: Bucket) => (metric === "cost" ? bucket.costShare : bucket.share)
  const unpricedModels = summary.byModel.filter((model) => model.price === "unpriced")
  const nothing = summary.tokens === 0
  const periodLabel = PERIODS.find((period) => period.days === days)?.label ?? `${days} days`

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em] text-text">Usage</h1>
          <p className="mt-1 text-[14.5px] text-muted">
            How much your agents worked and what it cost, over the last {periodLabel}.
          </p>
        </div>
        <nav aria-label="Time period" className="flex self-start rounded-full bg-panel p-1 sm:self-auto">
          {PERIODS.map((period) => (
            <Link
              key={period.days}
              href={`/${orgSlug}/analytics?days=${period.days}`}
              aria-current={days === period.days ? "page" : undefined}
              className={cn(
                "flex h-8 items-center rounded-full px-3.5 text-[13px] transition-colors",
                days === period.days ? "bg-raised font-medium text-text" : "text-muted hover:text-text",
              )}
            >
              {period.label}
            </Link>
          ))}
        </nav>
      </header>

      {local.available ? (
        <Segmented
          label="Whose usage"
          value={source}
          onChange={setSource}
          options={[
            { value: "sayabot", label: "Agents in Sayabot" },
            {
              value: "local",
              label: local.loading ? "Coding tools on this computer…" : "Coding tools on this computer",
            },
          ]}
        />
      ) : null}

      {!isLocal && !eventsComplete ? (
        <Notice>
          {rollup
            ? "A busy stretch! Totals count every call. The chart and speed use the newest 20,000 calls."
            : "The chart and totals only include the newest 20,000 calls. Ask your admin to apply the latest database update for exact totals."}
        </Notice>
      ) : null}

      {nothing ? (
        <div className="flex flex-col items-center rounded-[28px] bg-panel px-6 py-14 text-center">
          <Mascot seed="Usage" figure blink mood="sleep" className="h-[110px] w-auto" />
          <h2 className="mt-4 text-[18px] font-semibold text-text">Nothing to count yet</h2>
          <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted">
            {isLocal
              ? "No Claude Code, Codex or Antigravity sessions on this computer in this period."
              : `No agent has replied in the last ${periodLabel}. Say hi to one and it will show up here.`}
          </p>
          {!isLocal ? (
            <Link
              href={`/${orgSlug}`}
              className="mt-5 rounded-full bg-text px-4 py-2 text-[14px] font-medium text-void hover:bg-accent"
            >
              Go to chats
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          {!isLocal && unpricedModels.length ? (
            <Notice tone="warn">
              {unpricedModels.length === 1
                ? `${unpricedModels[0]?.label} has no price set,`
                : `${unpricedModels.length} models have no price set,`}{" "}
              so {formatTokens(summary.unpricedTokens)} tokens are counted as free and the real spend is
              higher than shown.{" "}
              {canEditPrices ? (
                <Link href={`/${orgSlug}/settings/pricing`} className="font-medium text-accent underline underline-offset-4">
                  Set prices
                </Link>
              ) : (
                "Ask an admin to set prices."
              )}
            </Notice>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label={isLocal ? "Would cost at API prices" : "Spent"}
              value={money(summary.cost)}
              note={
                isLocal
                  ? "What these sessions would cost if paid per token. Plans like Claude Max are billed separately."
                  : summary.subscriptionTokens > 0
                    ? `Estimated from model prices. ${formatTokens(summary.subscriptionTokens)} tokens ran on your own coding plan at no extra cost.`
                    : "Estimated from each model's price per token."
              }
            />
            <Stat
              label={isLocal ? "Requests" : "Replies"}
              value={formatNumber(summary.replies)}
              note={
                isLocal
                  ? `Across ${formatNumber(summary.sessions)} coding ${summary.sessions === 1 ? "session" : "sessions"}.`
                  : summary.backgroundCalls > 0
                    ? `Plus ${formatNumber(summary.backgroundCalls)} behind-the-scenes ${summary.backgroundCalls === 1 ? "step" : "steps"} like summaries and checks.`
                    : `In ${formatNumber(summary.sessions)} ${summary.sessions === 1 ? "chat" : "chats"}.`
              }
            />
            <Stat
              label="Tokens"
              value={formatTokens(summary.tokens)}
              note={
                <>
                  {words(summary.tokens)} read and written.{" "}
                  <span title="Models read and write text in small pieces called tokens. One token is about three quarters of a word.">
                    What&apos;s a token?
                  </span>
                </>
              }
            />
          </div>

          <section className="rounded-[22px] bg-panel p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[15px] font-semibold text-text">
                {metric === "cost" ? "Spend" : "Tokens"} {days === 1 ? "by hour" : "by day"}
              </h2>
              <div className="flex flex-wrap gap-2">
                <Segmented
                  label="Show"
                  value={metric}
                  onChange={setMetric}
                  options={[
                    { value: "tokens", label: "Tokens" },
                    { value: "cost", label: "Spend" },
                  ]}
                />
                {!isLocal ? (
                  <Segmented
                    label="Colour by"
                    value={groupBy}
                    onChange={setGroupBy}
                    options={[
                      { value: "agent", label: "Agents" },
                      { value: "model", label: "Models" },
                    ]}
                  />
                ) : null}
              </div>
            </div>
            <UsageBars
              points={chart.points}
              series={chart.series}
              hourly={days === 1}
              format={metric === "cost" ? money : formatTokens}
              label={`${metric === "cost" ? "Spend" : "Tokens"} ${days === 1 ? "per hour" : "per day"}, last ${periodLabel}`}
            />
          </section>

          <div className={cn("grid gap-3", !isLocal && "md:grid-cols-2")}>
            {!isLocal ? (
              <ListCard title="Agents" empty="No agent activity.">
                {summary.byAgent.slice(0, 8).map((bucket) => {
                  const agent = agentsById.get(bucket.key)
                  return (
                    <li key={bucket.key} className="flex items-center gap-3">
                      {agent ? (
                        <Mascot seed={agent.displayName} className="h-9 w-9 shrink-0" />
                      ) : (
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-raised text-[13px] text-faint">
                          ·
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="truncate text-[14px] font-medium text-text">{bucket.label}</span>
                          <span className="shrink-0 text-[14px] text-text tabular-nums">{show(bucket)}</span>
                        </div>
                        <p className="text-[12.5px] text-faint">
                          {formatNumber(bucket.calls)} {bucket.calls === 1 ? "call" : "calls"} ·{" "}
                          {formatPercent(shareOf(bucket), 0)} of the total
                        </p>
                        <ShareBar share={shareOf(bucket)} color={colorFor(bucket, "agent")} />
                      </div>
                    </li>
                  )
                })}
              </ListCard>
            ) : null}

            <ListCard title="Models" empty="No model activity.">
              {summary.byModel.slice(0, 8).map((bucket: ModelBucket) => (
                <li key={bucket.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[14px] font-medium text-text" title={bucket.model}>
                      {bucket.label}
                    </span>
                    <span className="shrink-0 text-[14px] text-text tabular-nums">
                      {metric === "cost" && bucket.price !== "priced" ? (
                        <span className="text-faint">{bucket.price === "subscription" ? "In your plan" : "No price"}</span>
                      ) : (
                        show(bucket)
                      )}
                    </span>
                  </div>
                  <p className="flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-faint">
                    <span>{providerLabel(bucket.provider)}</span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {formatNumber(bucket.calls)} {bucket.calls === 1 ? "call" : "calls"}
                    </span>
                    {bucket.price === "unpriced" && !isLocal ? (
                      <span className="rounded-full bg-warn/15 px-2 py-px text-[11.5px] text-warn">No price set</span>
                    ) : null}
                    {bucket.price === "subscription" ? (
                      <span className="rounded-full bg-raised px-2 py-px text-[11.5px] text-muted">Your plan</span>
                    ) : null}
                  </p>
                  <ShareBar share={shareOf(bucket)} color={colorFor(bucket, "model")} />
                </li>
              ))}
            </ListCard>
          </div>

          {!isLocal ? (
            <ListCard title="Chats" empty="No chat activity.">
              {summary.byRoom.slice(0, 6).map((bucket) => {
                const room = roomsById.get(bucket.key)
                const inner = (
                  <>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px] font-medium text-text">{bucket.label}</span>
                      <span className="shrink-0 text-[14px] text-text tabular-nums">{show(bucket)}</span>
                    </div>
                    <p className="text-[12.5px] text-faint">
                      {formatNumber(bucket.calls)} {bucket.calls === 1 ? "call" : "calls"} ·{" "}
                      {formatPercent(shareOf(bucket), 0)} of the total
                    </p>
                  </>
                )
                return (
                  <li key={bucket.key}>
                    {room ? (
                      <Link href={`/${orgSlug}/r/${room.id}`} className="block rounded-xl hover:opacity-80">
                        {inner}
                      </Link>
                    ) : (
                      inner
                    )}
                  </li>
                )
              })}
            </ListCard>
          ) : null}

          <details className="group rounded-[22px] bg-panel p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-text">
              The details
              <span className="text-[13px] font-normal text-faint group-open:hidden">
                Tokens by type, caching and speed
              </span>
            </summary>
            <div className="mt-4 space-y-5">
              <div>
                <p className="mb-2 text-[13px] text-muted">Where the tokens went</p>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
                  <DetailTile label="Read fresh" value={formatTokens(summary.fresh)} note="Prompt text the model read in full." />
                  <DetailTile
                    label="Read from cache"
                    value={formatTokens(summary.cached)}
                    note={`${formatPercent(summary.cacheHitRate, 0)} of prompts, at a big discount.`}
                  />
                  {summary.cacheWrite > 0 ? (
                    <DetailTile label="Saved to cache" value={formatTokens(summary.cacheWrite)} note="Stored so later turns read it cheaply." />
                  ) : null}
                  <DetailTile label="Written" value={formatTokens(summary.output)} note="Replies the model wrote." />
                </div>
                {cacheSavings >= 0.01 ? (
                  <p className="mt-2.5 text-[13px] text-muted">
                    Caching saved about <span className="font-medium text-text">{money(cacheSavings)}</span> compared with
                    reading every prompt fresh.
                  </p>
                ) : null}
              </div>
              {!isLocal ? (
                <div>
                  <p className="mb-2 text-[13px] text-muted">
                    How fast agents replied
                    {timing.measured ? ` (from ${formatNumber(timing.measured)} replies)` : ""}
                  </p>
                  {timing.measured ? (
                    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                      <DetailTile label="First words" value={formatMs(timing.medianFirstWordMs)} note="Typical wait before a reply starts." />
                      <DetailTile label="Whole reply" value={formatMs(timing.medianReplyMs)} note="Typical time to finish, tools included." />
                      <DetailTile label="Slowest replies" value={formatMs(timing.slowReplyMs)} note="1 in 20 replies took this long or more." />
                    </div>
                  ) : (
                    <p className="text-[13px] text-faint">No timing recorded for this period.</p>
                  )}
                </div>
              ) : null}
            </div>
          </details>
        </>
      )}
    </div>
  )
}
