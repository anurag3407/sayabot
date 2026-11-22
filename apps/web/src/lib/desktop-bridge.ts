"use client"

import type { PlanLimits } from "@sayabot/core/scanner"
import type { RawEvent } from "@/lib/usage-summary"

export type { PlanLimits, PlanWindow } from "@sayabot/core/scanner"

/**
 * What the Sayabot Mac app adds to the page. Older app versions lack the usage calls, so every
 * caller checks before using them; in a normal browser the bridge is absent.
 */
interface DesktopUsageBridge {
  getHostId?: () => Promise<string | null>
  getPlanLimits?: (force?: boolean) => Promise<unknown[]>
  getLocalUsage?: (days: number) => Promise<{ available: boolean; events: unknown[] }>
  signInAgentStart?: (
    appId: string,
  ) => Promise<{ ok: true; url: string } | { ok: false; error: string }>
  signInAgentSubmit?: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>
  signInAgentCancel?: () => Promise<void>
}

function bridge(): DesktopUsageBridge | null {
  if (typeof window === "undefined") return null
  const candidate = (window as unknown as { sayabotDesktop?: DesktopUsageBridge }).sayabotDesktop
  return candidate ?? null
}

export function canReadPlanLimits(): boolean {
  return typeof bridge()?.getPlanLimits === "function"
}

export function canReadLocalUsage(): boolean {
  return typeof bridge()?.getLocalUsage === "function"
}

function isPlanLimits(value: unknown): value is PlanLimits {
  if (typeof value !== "object" || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.provider === "string" &&
    typeof item.label === "string" &&
    Array.isArray(item.windows)
  )
}

export async function readPlanLimits(force = false): Promise<PlanLimits[] | null> {
  const read = bridge()?.getPlanLimits
  if (!read) return null
  try {
    const result = await read(force)
    return Array.isArray(result) ? result.filter(isPlanLimits) : []
  } catch {
    return []
  }
}

export async function readDesktopLocalUsage(days: number): Promise<RawEvent[] | null> {
  const read = bridge()?.getLocalUsage
  if (!read) return null
  try {
    const result = await read(days)
    return result?.available && Array.isArray(result.events) ? (result.events as RawEvent[]) : []
  } catch {
    return []
  }
}

/** "in 2h 14m", "in 3 days", "soon". */
export function resetsIn(iso: string | null, now = Date.now()): string | null {
  if (!iso) return null
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms)) return null
  if (ms <= 60_000) return "soon"
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`
  const days = Math.round(hours / 24)
  return `in ${days} ${days === 1 ? "day" : "days"}`
}

/** The registered host id of the Mac running this desktop window, or null in a browser. */
export async function getDesktopHostId(): Promise<string | null> {
  const get = bridge()?.getHostId
  if (!get) return null
  try {
    return (await get()) ?? null
  } catch {
    return null
  }
}

/** Whether this window is the Mac app with the agent sign-in calls (1.0.32+). */
export function canSignInAgents(): boolean {
  return typeof bridge()?.signInAgentStart === "function"
}

/**
 * Starts an agent app's own sign-in on this Mac (Antigravity's Google login); the Mac app opens
 * the Google page. Finish with `finishAgentSignIn(code)`.
 */
export async function startAgentSignIn(
  appId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const start = bridge()?.signInAgentStart
  if (!start) return { ok: false, error: "Open this page in Sayabot for Mac to sign in." }
  return start(appId).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : "The sign-in couldn't start.",
  }))
}

export async function finishAgentSignIn(
  code: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const submit = bridge()?.signInAgentSubmit
  if (!submit) return { ok: false, error: "Open this page in Sayabot for Mac to sign in." }
  return submit(code).catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : "The sign-in didn't finish.",
  }))
}

export function cancelAgentSignIn(): void {
  void bridge()
    ?.signInAgentCancel?.()
    .catch(() => undefined)
}
