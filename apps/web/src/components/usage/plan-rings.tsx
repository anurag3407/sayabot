"use client"

import Link from "next/link"
import { useSyncExternalStore } from "react"
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
import { mergePlanLimits } from "@/lib/plan-limits-store"

const POLL_MS = 5 * 60_000

/**
 * One store for every ring on the page (top bar, model picker, Usage page). Readings survive
 * remounts and navigation, and a failed read never wipes a good one (see `mergePlanLimits`).
 */
interface PlanLimitsState {
  supported: boolean
  limits: PlanLimits[] | null
  loading: boolean
}

const SERVER_STATE: PlanLimitsState = { supported: false, limits: null, loading: false }
let state: PlanLimitsState = SERVER_STATE
const listeners = new Set<() => void>()
let stopPolling: (() => void) | null = null
let inflight: Promise<void> | null = null

function setState(next: Partial<PlanLimitsState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

function refreshPlanLimits(force = false): Promise<void> {
  if (inflight && !force) return inflight
  setState({ loading: true })
  const run = readPlanLimits(force)
    .then((next) => {
      if (next) setState({ limits: mergePlanLimits(state.limits, next) })
    })
    .catch(() => {})
    .finally(() => {
      if (inflight === run) inflight = null
      setState({ loading: false })
    })
  inflight = run
  return run
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!stopPolling && canReadPlanLimits()) {
    if (!state.supported) setState({ supported: true })
    void refreshPlanLimits()
    const timer = window.setInterval(() => void refreshPlanLimits(), POLL_MS)
    const onFocus = () => void refreshPlanLimits()
    window.addEventListener("focus", onFocus)
    stopPolling = () => {
      window.clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size && stopPolling) {
      stopPolling()
      stopPolling = null
    }
  }
}

/** Plan limits from the Mac app, refreshed every few minutes and whenever the window regains focus. */
export function usePlanLimits() {
  const snapshot = useSyncExternalStore(
    subscribe,
    () => state,
    () => SERVER_STATE,
  )
  return { ...snapshot, refresh: refreshPlanLimits }
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

/** The fuel gauges in the top-right corner: one small ring per plan, tap for the Usage page. */
export function TopBarPlanRings({ usageHref }: { usageHref: string }) {
  const { supported, limits } = usePlanLimits()
  const shown = (limits ?? []).filter((item) => item.windows.length > 0)
  if (!supported || !shown.length) return null
  const summary = shown.map(describeLimits)
  return (
    <Link
      href={usageHref}
      aria-label={`Plan limits. ${summary.join(". ")}. Open Usage.`}
      title={summary.join("\n")}
      className="fade-in flex h-8 items-center gap-1 rounded-full px-1.5 transition-colors hover:bg-white/[0.06] [-webkit-app-region:no-drag]"
    >
      {shown.map((item) => (
        <PlanRing key={item.provider} limits={item} size={26} />
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
