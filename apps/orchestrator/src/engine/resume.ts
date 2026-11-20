import { agentRuns } from "@sayabot/db"
import { and, eq, isNull, lt, or } from "drizzle-orm"
import { getDb } from "../db"
import { enqueueRunResume } from "../jobs"
import { broadcast } from "../realtime"

export interface StaleRecoveryResult {
  recoveredCount: number
  runIds: string[]
}

/**
 * Builds a deterministic idempotency key for a tool call within a run step.
 */
export function buildToolIdempotencyKey(runId: string, stepIdx: number, callIdx: number): string {
  return `${runId}:${stepIdx}:${callIdx}`
}

/**
 * Parks a running Engine v2 turn when waiting on external input (approvals > 30s, ask cards).
 * Frees worker resources and sets agent_runs.status = 'waiting'.
 */
export async function parkRun(
  runId: string,
  reason: "approval" | "ask_card" | "quota",
): Promise<void> {
  const db = getDb()

  const [run] = await db
    .select({ roomId: agentRuns.roomId })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .limit(1)

  await db
    .update(agentRuns)
    .set({
      status: "waiting",
      waitingReason: reason,
      heartbeatAt: new Date(),
    })
    .where(eq(agentRuns.id, runId))

  if (run?.roomId) {
    const statusType = reason === "approval" ? "waiting:approval" : "waiting:answer"
    await broadcast(run.roomId, {
      type: "run.status",
      runId,
      status: statusType,
    })
  }
}

/**
 * Resumes a parked or recovered Engine v2 run.
 */
export async function resumeRun(runId: string): Promise<boolean> {
  const db = getDb()

  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1)

  if (!run || (run.status !== "waiting" && run.status !== "running")) {
    return false
  }

  await db
    .update(agentRuns)
    .set({
      status: "running",
      waitingReason: null,
      heartbeatAt: new Date(),
    })
    .where(eq(agentRuns.id, runId))

  await broadcast(run.roomId, {
    type: "run.status",
    runId,
    status: "thinking",
  })

  return true
}

/**
 * Called on boot to discover any Engine v2 runs left in 'running' state whose
 * heartbeat is older than 60 seconds (or null). Rescues them via pg-boss run.resume.
 */
export async function recoverStaleRuns(olderThanSeconds = 60): Promise<StaleRecoveryResult> {
  const db = getDb()
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000)

  const staleRuns = await db
    .select({ id: agentRuns.id, roomId: agentRuns.roomId })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.engine, "v2"),
        eq(agentRuns.status, "running"),
        or(lt(agentRuns.heartbeatAt, cutoff), isNull(agentRuns.heartbeatAt)),
      ),
    )

  const runIds: string[] = []

  for (const r of staleRuns) {
    try {
      await db
        .update(agentRuns)
        .set({
          status: "waiting",
          waitingReason: "stale_heartbeat",
          heartbeatAt: new Date(),
        })
        .where(eq(agentRuns.id, r.id))

      await enqueueRunResume(r.id, "stale_recovery")
      runIds.push(r.id)
    } catch (err) {
      console.error(`[recovery] failed to rescue run ${r.id}`, err)
    }
  }

  return {
    recoveredCount: runIds.length,
    runIds,
  }
}
