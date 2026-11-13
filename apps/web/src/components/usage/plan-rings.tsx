"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { cn } from "@/lib/format"
import { ProviderIcon } from "@/components/room/model-picker/provider-icons"
import {
  canReadPlanLimits,
  readPlanLimits,
  resetsIn,
  type PlanLimits,
  type PlanWindow,
} from "@/lib/desktop-bridge"

const POLL_MS = 5 * 60_000

/** Plan limits from the Mac app, refreshed every few minutes and whenever the window regains focus. */
export function usePlanLimits() {
  const [supported, setSupported] = useState(false)
  const [limits, setLimits] = useState<PlanLimits[] | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    try {
      const next = await readPlanLimits(force)
      if (next) setLimits(next)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!canReadPlanLimits()) return
    setSupported(true)
    void refresh()
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [refresh])

  return { supported, limits, loading, refresh }
}

const left = (window: PlanWindow) => Math.max(0, Math.min(100, 100 - window.usedPercent))

/** Green while there's room, amber when it's getting low, red when nearly out. Always labelled. */
function toneColor(remaining: number): string {
  if (remaining <= 10) return "var(--color-danger)"
  if (remaining <= 25) return "var(--color-warn)"
  return "var(--color-ok)"
}

/** The window with the least room left decides how a provider is doing overall. */
export function tightest(limits: PlanLimits): PlanWindow | null {
  return limits.windows.reduce<PlanWindow | null>(
    (worst, window) => (!worst || left(window) < left(worst) ? window : worst),
    null,
  )
}

export function describeLimits(limits: PlanLimits): string {
  if (limits.error || !limits.windows.length) return `${limits.label}: ${limits.error ?? "no reading"}`
  return `${limits.label}: ${limits.windows
    .map((window) => {
      const reset = resetsIn(window.resetsAt)
      return `${Math.round(left(window))}% left of ${window.label.toLowerCase()}${reset ? `, resets ${reset}` : ""}`
    })
    .join("; ")}`
}

const providerIconId = (provider: PlanLimits["provider"]) =>
  provider === "claude" ? "claude" : provider === "codex" ? "codex" : "antigravity"

/**
 * One ring per window, nested: the outer ring is the first window (usually 5-hour), the inner
 * one the second (usually weekly). The coloured arc is what's left.
 */
export function PlanRing({ limits, size = 44 }: { limits: PlanLimits; size?: number }) {
  const windows = limits.windows.slice(0, 2)
  const stroke = Math.max(3, Math.round(size / 13))
  const gap = 2
  const center = size / 2

  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        {windows.length ? (
          windows.map((window, index) => {
            const radius = center - stroke / 2 - index * (stroke + gap)
            const circumference = 2 * Math.PI * radius
            const remaining = left(window)
            return (
              <g key={window.label}>
                <circle cx={center} cy={center} r={radius} fill="none" stroke="var(--color-raised)" strokeWidth={stroke} />
                <circle
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={toneColor(remaining)}
                  strokeWidth={stroke}
                  strokeLinecap="round"
                  strokeDasharray={`${(remaining / 100) * circumference} ${circumference}`}
                  className="transition-[stroke-dasharray] duration-700 ease-out"
                />
              </g>
            )
          })
        ) : (
          <circle
            cx={center}
            cy={center}
            r={center - stroke / 2}
            fill="none"
            stroke="var(--color-line-strong)"
            strokeWidth={stroke}
            strokeDasharray="3 4"
          />
        )}
      </svg>
      <span className={cn("absolute grid place-items-center text-text", !windows.length && "opacity-50")}>
        <ProviderIcon provider={providerIconId(limits.provider)} size={Math.round(size * 0.36)} />
      </span>
    </span>
  )
}

/** The little rings above the account menu, like a fuel gauge for each plan. */
export function SidebarPlanRings({ usageHref, onNavigate }: { usageHref: string; onNavigate?: () => void }) {
  const { supported, limits } = usePlanLimits()
  const shown = (limits ?? []).filter((item) => item.windows.length > 0)
  if (!supported || !shown.length) return null
  return (
    <Link
      href={usageHref}
      onClick={onNavigate}
      aria-label={`Plan limits. ${shown.map(describeLimits).join(". ")}`}
      title={shown.map(describeLimits).join("\n")}
      className="flex items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors hover:bg-panel"
    >
      {shown.map((item) => (
        <PlanRing key={item.provider} limits={item} size={36} />
      ))}
      <span className="ml-1 min-w-0 truncate text-[12.5px] text-faint">
        {(() => {
          const worst = shown
            .map((item) => ({ item, window: tightest(item) }))
            .filter((entry): entry is { item: PlanLimits; window: PlanWindow } => entry.window !== null)
            .sort((a, b) => left(a.window) - left(b.window))[0]
          return worst ? `${worst.item.label} ${Math.round(left(worst.window))}% left` : null
        })()}
      </span>
    </Link>
  )
}

/** The same rings stacked in the icon rail: no words, just the gauges. */
export function RailPlanRings({ usageHref }: { usageHref: string }) {
  const { supported, limits } = usePlanLimits()
  const shown = (limits ?? []).filter((item) => item.windows.length > 0)
  if (!supported || !shown.length) return null
  return (
    <Link
      href={usageHref}
      aria-label={`Plan limits. ${shown.map(describeLimits).join(". ")}`}
      title={shown.map(describeLimits).join("\n")}
      className="flex flex-col items-center gap-2.5 rounded-2xl py-1.5 transition-opacity hover:opacity-80"
    >
      {shown.map((item) => (
        <PlanRing key={item.provider} limits={item} size={38} />
      ))}
    </Link>
  )
}

function minutesAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (!Number.isFinite(minutes) || minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)} days ago`
}

/** Plan limits on the Usage page: one card per tool, every number straight from the provider. */
export function PlanLimitsSection() {
  const { supported, limits, loading, refresh } = usePlanLimits()
  if (!supported) return null

  return (
    <section className="rounded-[22px] bg-panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-text">Plan limits</h2>
          <p className="mt-0.5 text-[12.5px] text-faint">
            How much of your Claude, Codex and Antigravity plans is left, read with this Mac&apos;s sign-ins.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh(true)}
          disabled={loading}
          aria-label="Check plan limits again"
          title="Check again"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-raised hover:text-text disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </button>
      </div>

      <div className="mt-4 grid gap-2.5 md:grid-cols-3">
        {(limits ?? []).map((item) => (
          <div key={item.provider} className="flex gap-3.5 rounded-2xl bg-raised/60 p-4">
            <PlanRing limits={item} size={52} />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-text">
                {item.label}
                {item.plan ? <span className="ml-1.5 text-[12px] font-normal capitalize text-faint">{item.plan}</span> : null}
              </p>
              {item.windows.length ? (
                <ul className="mt-1 space-y-1">
                  {item.windows.map((window) => {
                    const reset = resetsIn(window.resetsAt)
                    return (
                      <li key={window.label} className="text-[12.5px] leading-snug">
                        <span className="font-medium text-text tabular-nums">{Math.round(left(window))}% left</span>
                        <span className="text-muted"> · {window.label}</span>
                        {reset ? <span className="text-faint"> · resets {reset}</span> : null}
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="mt-1 text-[12.5px] leading-snug text-faint">{item.error ?? "No reading yet."}</p>
              )}
              {item.windows.length && item.provider === "codex" ? (
                <p className="mt-1.5 text-[11.5px] text-faint">As Codex last saw it, {minutesAgo(item.observedAt)}.</p>
              ) : null}
            </div>
          </div>
        ))}
        {limits === null ? <p className="text-[13px] text-faint">Checking…</p> : null}
      </div>
    </section>
  )
}
