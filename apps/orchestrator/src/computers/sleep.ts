import { boatCredential, boatShouldSleep } from "@sayabot/core"
import { agents, orgComputerSettings, routines } from "@sayabot/db"
import { decryptSecret } from "@sayabot/llm"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { getEnv } from "../env"
import { BoatClient } from "./boat"

export interface IdleBoat {
  boatId: string
  lastUsedAt: number | null
  nextRoutineAt: number | null
  backgroundStartedAt: number | null
  watching: boolean
}

/**
 * Boats that have been unused for 10 minutes. A missing last-used time is left alone,
 * so a Boat we have never recorded is not stopped. A VPS is never passed in here.
 */
export function idleBoatIds(now: number, rows: IdleBoat[]): string[] {
  return rows
    .filter(
      (row) =>
        row.lastUsedAt !== null &&
        boatShouldSleep({
          now,
          lastUsedAt: row.lastUsedAt,
          nextRoutineAt: row.nextRoutineAt,
          backgroundStartedAt: row.backgroundStartedAt,
          watching: row.watching,
        }),
    )
    .map((row) => row.boatId)
}

function millis(value: unknown): number | null {
  if (typeof value !== "string") return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

/**
 * Stops Boats that have been idle for 10 minutes. Files stay on Boat and wake with the desktop.
 * A VPS is never stopped. Failures here must not stop the routine scan.
 */
export async function sleepIdleBoats(now = Date.now()): Promise<number> {
  const db = getDb()
  const [bots, upcoming, settings] = await Promise.all([
    db.select({ id: agents.id, orgId: agents.orgId, params: agents.params }).from(agents).limit(200),
    db
      .select({ agentId: routines.agentId, nextRunAt: routines.nextRunAt })
      .from(routines)
      .where(eq(routines.enabled, true))
      .limit(200),
    db
      .select({
        orgId: orgComputerSettings.orgId,
        ciphertext: orgComputerSettings.boatCiphertext,
        iv: orgComputerSettings.boatIv,
        tag: orgComputerSettings.boatTag,
      })
      .from(orgComputerSettings),
  ])
  const nextByAgent = new Map<string, number>()
  for (const routine of upcoming) {
    if (!routine.nextRunAt) continue
    const at = routine.nextRunAt.getTime()
    const current = nextByAgent.get(routine.agentId)
    if (current === undefined || at < current) nextByAgent.set(routine.agentId, at)
  }
  const tokens = new Map<string, string>()
  let kek = ""
  try {
    kek = getEnv().MESH_KEK
  } catch {
    kek = ""
  }
  for (const row of settings) {
    let own: string | null = null
    if (kek && row.ciphertext && row.iv && row.tag) {
      try {
        own = decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, kek)
      } catch {
        own = null
      }
    }
    const cred = boatCredential(own, process.env.SAYABOT_BOAT_TOKEN)
    if (cred) tokens.set(row.orgId, cred.token)
  }
  const included = boatCredential(null, process.env.SAYABOT_BOAT_TOKEN)
  let stopped = 0
  for (const bot of bots) {
    const computer =
      bot.params?.computer && typeof bot.params.computer === "object"
        ? (bot.params.computer as Record<string, unknown>)
        : null
    if (!computer || computer.boatState !== "running" || typeof computer.boatId !== "string") continue
    const nextRoutineAt = nextByAgent.get(bot.id) ?? null
    const due = idleBoatIds(now, [
      {
        boatId: computer.boatId,
        lastUsedAt: millis(computer.lastUsedAt),
        nextRoutineAt,
        backgroundStartedAt: millis(computer.backgroundStartedAt),
        watching: computer.watching === true,
      },
    ])
    const boatId = due[0]
    if (!boatId) continue
    const token = tokens.get(bot.orgId) ?? included?.token
    if (!token) continue
    await new BoatClient({ token, api: process.env.SAYABOT_BOAT_API || undefined }).stop(boatId)
    await db
      .update(agents)
      .set({
        params: {
          ...bot.params,
          computer: { ...computer, boatState: "sleeping" },
        },
      })
      .where(eq(agents.id, bot.id))
    stopped += 1
  }
  return stopped
}
