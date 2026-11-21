import { abortRun, runActivity } from "../active-runs"
import { broadcast } from "../realtime"

/**
 * A turn with nothing to show for itself is stuck, not thinking. The limit is generous for a model
 * call and much larger while one of the turn's own tools is still running, because a build or a
 * test suite can legitimately report nothing for a long time.
 */
export const TURN_STALL_MS = 20 * 60_000
export const TOOL_STALL_MS = 2 * 60 * 60_000

export interface StallInput {
  /** Wall clock, in ms. */
  now: number
  /** When this run last produced a step, a delta, or a tool event. */
  lastActivityAt: number
  /** Tools of this run that have started and not finished. */
  toolsInFlight: number
  /** Override for a caller that configures its own limit. */
  limitMs?: number
}

export interface StallAssessment {
  stalled: boolean
  limitMs: number
  silentForMs: number
  /** Plain words for the room, or null while the turn is healthy. */
  reason: string | null
}

/** The limit a run is held to, given what it is currently doing. */
export function stallLimitFor(toolsInFlight: number, limitMs?: number): number {
  if (typeof limitMs === "number" && Number.isFinite(limitMs) && limitMs > 0) return limitMs
  return toolsInFlight > 0 ? TOOL_STALL_MS : TURN_STALL_MS
}

export function assessStall(input: StallInput): StallAssessment {
  const limitMs = stallLimitFor(input.toolsInFlight, input.limitMs)
  const silentForMs = Math.max(0, input.now - input.lastActivityAt)
  const stalled = silentForMs >= limitMs
  if (!stalled) {
    return { stalled: false, limitMs, silentForMs, reason: null }
  }
  const minutes = Math.max(1, Math.round(silentForMs / 60_000))
  const reason =
    input.toolsInFlight > 0
      ? `A tool reported nothing for ${minutes} minutes, so this step was stopped.`
      : `No activity for ${minutes} minutes, so this step was stopped.`
  return { stalled: true, limitMs, silentForMs, reason }
}

export interface RunWatchdogOptions {
  /** How often to look. Defaults to one minute. */
  intervalMs?: number
  now?: () => number
  /** Injectable for tests. */
  list?: typeof runActivity
  stop?: (runId: string) => boolean
  notify?: typeof broadcast
}

/**
 * Watches the turns this process is running and stops one that has been silent past its limit.
 * Only runs owned by this process are stopped: another instance's turn keeps its own clock, and a
 * run whose row is stale is left to the existing heartbeat recovery.
 */
export function startRunWatchdog(options: RunWatchdogOptions = {}): () => void {
  const intervalMs = options.intervalMs ?? 60_000
  const now = options.now ?? Date.now
  const list = options.list ?? runActivity
  const stop = options.stop ?? ((runId: string) => abortRun(runId))
  const notify = options.notify ?? broadcast
  const timer = setInterval(() => {
    const at = now()
    for (const run of list()) {
      const verdict = assessStall({
        now: at,
        lastActivityAt: run.lastActivityAt,
        toolsInFlight: run.toolsInFlight,
      })
      if (!verdict.stalled || !verdict.reason) continue
      if (!stop(run.runId)) continue
      console.warn(`[watchdog] stopping ${run.runId}: ${verdict.reason}`)
      void notify(run.roomId, {
        type: "run.step",
        runId: run.runId,
        step: 0,
        kind: "watchdog",
        label: verdict.reason,
      }).catch(() => {})
    }
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
