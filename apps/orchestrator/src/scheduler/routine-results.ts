import { routineRuns, routines } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { notifyRoutineFinished } from "../push"

const MAX_OUTPUT = 20_000

export interface RoutineTrigger {
  routineId: string
  routineRunId: string
  routineName: string
}

/** The routine behind a trigger message, when runRoutineNow posted it. */
export function readRoutineTrigger(metadata: unknown): RoutineTrigger | null {
  if (!metadata || typeof metadata !== "object") return null
  const row = metadata as Record<string, unknown>
  if (row.kind !== "routine") return null
  if (typeof row.routineId !== "string" || typeof row.routineRunId !== "string") return null
  return {
    routineId: row.routineId,
    routineRunId: row.routineRunId,
    routineName:
      typeof row.routineName === "string" && row.routineName ? row.routineName : "Routine",
  }
}

/**
 * Called when the agent turn a routine started has finished. Stores what the agent actually
 * said (runRoutineNow only knows the prompt was queued) and alerts the person who set it up.
 * `reply` and `error` must already be redacted.
 */
export async function recordRoutineResult(args: {
  metadata: unknown
  roomId: string
  agentId: string
  reply: string | null
  error: string | null
}): Promise<void> {
  const trigger = readRoutineTrigger(args.metadata)
  if (!trigger) return
  const db = getDb()
  const failed = Boolean(args.error) || !args.reply
  const errorText = args.error ?? (args.reply ? null : "The agent finished without a reply")
  await db
    .update(routineRuns)
    .set({
      status: failed ? "failed" : "success",
      finishedAt: new Date(),
      output: args.reply ? args.reply.slice(0, MAX_OUTPUT) : null,
      error: errorText,
    })
    .where(eq(routineRuns.id, trigger.routineRunId))
  const [routine] = await db
    .select({ createdByUserId: routines.createdByUserId })
    .from(routines)
    .where(eq(routines.id, trigger.routineId))
    .limit(1)
  if (!routine) return
  if (failed) {
    await db
      .update(routines)
      .set({ lastStatus: "failed", lastError: errorText, updatedAt: new Date() })
      .where(eq(routines.id, trigger.routineId))
  }
  notifyRoutineFinished({
    roomId: args.roomId,
    agentId: args.agentId,
    routineName: trigger.routineName,
    ownerUserId: routine.createdByUserId,
    summary: failed ? (errorText ?? "It didn't finish") : (args.reply ?? ""),
    failed,
  })
}
