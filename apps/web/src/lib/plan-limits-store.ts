import type { PlanLimits } from "@sayabot/core/scanner"

/** A good reading stays on screen this long when later reads fail (rate limits, token refresh). */
export const STALE_READING_MS = 12 * 60 * 60_000

/**
 * Folds a fresh read into what is on screen. A failed read never erases a good one:
 * - an empty list means the app could not be asked at all, so nothing changes;
 * - a provider that came back without windows keeps its last good windows while they are
 *   younger than `STALE_READING_MS` (Claude's usage endpoint rate-limits and its sign-in
 *   token expires between Claude Code runs, both of which used to make the ring vanish).
 */
export function mergePlanLimits(
  previous: PlanLimits[] | null,
  next: PlanLimits[],
  now = Date.now(),
): PlanLimits[] {
  if (!next.length) return previous ?? []
  const last = new Map((previous ?? []).map((item) => [item.provider, item]))
  return next.map((item) => {
    if (item.windows.length) return item
    const kept = last.get(item.provider)
    if (!kept?.windows.length) return item
    const age = now - Date.parse(kept.observedAt)
    return Number.isFinite(age) && age < STALE_READING_MS ? kept : item
  })
}
