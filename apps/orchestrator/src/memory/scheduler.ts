import { redactSecrets } from "@sayabot/core"
import { memories } from "@sayabot/db"
import { getDb, getPool } from "../db"
import { getMemoryService } from "./service"

/**
 * Memory maintenance ("dream cycle") on a timer: prunes decayed episodes, flags overdue
 * open loops, purges long-withdrawn memories and backfills embeddings, for every org that
 * has memories. One orchestrator instance runs it at a time (session advisory lock on a
 * dedicated connection, same pattern as the routine scheduler).
 */

const SCAN_MS = 6 * 60 * 60 * 1000
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000
const LOCK_KEY = "mesh:memory:consolidate"
const MAX_ORGS_PER_RUN = 1000

let interval: ReturnType<typeof setInterval> | null = null
let firstRun: ReturnType<typeof setTimeout> | null = null

export interface MaintenanceSummary {
  orgs: number
  expiredEpisodes: number
  loopsFlagged: number
  withdrawnCleaned: number
  embedded: number
}

export async function runMemoryMaintenanceOnce(): Promise<MaintenanceSummary> {
  const service = getMemoryService()
  const orgs = await getDb()
    .selectDistinct({ orgId: memories.orgId })
    .from(memories)
    .limit(MAX_ORGS_PER_RUN)

  const summary: MaintenanceSummary = {
    orgs: orgs.length,
    expiredEpisodes: 0,
    loopsFlagged: 0,
    withdrawnCleaned: 0,
    embedded: 0,
  }
  for (const { orgId } of orgs) {
    try {
      const r = await service.consolidate(orgId)
      summary.expiredEpisodes += r.expiredEpisodes
      summary.loopsFlagged += r.loopsUpdated
      summary.withdrawnCleaned += r.withdrawnCleaned
      summary.embedded += r.embedded
    } catch (error) {
      console.warn(
        `[memory] consolidation failed for org ${orgId}:`,
        redactSecrets(String(error)).text,
      )
    }
  }
  return summary
}

async function guardedRun(): Promise<void> {
  const client = await getPool().connect()
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as locked",
      [LOCK_KEY],
    )
    if (!rows[0]?.locked) return
    try {
      const s = await runMemoryMaintenanceOnce()
      if (s.expiredEpisodes || s.loopsFlagged || s.withdrawnCleaned || s.embedded) {
        console.log(
          `[memory] maintenance: ${s.orgs} orgs, ${s.expiredEpisodes} episodes pruned, ${s.loopsFlagged} loops flagged, ${s.withdrawnCleaned} withdrawn purged, ${s.embedded} embedded`,
        )
      }
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [LOCK_KEY])
    }
  } finally {
    client.release()
  }
}

export function startMemoryScheduler(): void {
  if (interval || firstRun) return
  const run = () => {
    void guardedRun().catch((error) =>
      console.error("[memory] maintenance run failed", redactSecrets(String(error)).text),
    )
  }
  firstRun = setTimeout(run, FIRST_RUN_DELAY_MS)
  firstRun.unref?.()
  interval = setInterval(run, SCAN_MS)
  interval.unref?.()
  console.log("[memory] maintenance scheduler online")
}

export function stopMemoryScheduler(): void {
  if (firstRun) clearTimeout(firstRun)
  if (interval) clearInterval(interval)
  firstRun = null
  interval = null
}
