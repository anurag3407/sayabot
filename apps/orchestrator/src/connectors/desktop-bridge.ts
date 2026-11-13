import { desktopHosts, desktopMcpCalls, desktopSecretJobs } from "@sayabot/db"
import { and, desc, eq, isNull } from "drizzle-orm"
import { openSecret } from "@sayabot/llm"
import { getDb } from "../db"
import { getEnv } from "../env"

const WAIT_MS = 25_000

async function sleep(ms: number, signal?: AbortSignal) {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error("aborted"))
    }
    if (signal?.aborted) onAbort()
    else signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** The desktop app heartbeats every 2.5s; a minute of silence means the lid is shut or it quit. */
export const DESKTOP_OFFLINE_AFTER_MS = 60_000

/**
 * Whether the computer that would serve this org (or the named host) is up right now. Lets a turn
 * skip desktop-only tools instead of waiting on a sleeping laptop, so the agent carries on with its
 * cloud computer.
 */
export async function desktopOnline(orgId: string, preferred?: string | null, now = Date.now()): Promise<boolean> {
  const hostId = await hostForOrg(orgId, preferred)
  if (!hostId) return false
  const [row] = await getDb()
    .select({ lastSeenAt: desktopHosts.lastSeenAt })
    .from(desktopHosts)
    .where(eq(desktopHosts.id, hostId))
    .limit(1)
  const seen = row?.lastSeenAt ? new Date(row.lastSeenAt).getTime() : 0
  return now - seen < DESKTOP_OFFLINE_AFTER_MS
}

/** The computer this org last heard from, unless a connector names one. */
export async function hostForOrg(orgId: string, preferred?: string | null): Promise<string | null> {
  const db = getDb()
  if (preferred) {
    const [row] = await db
      .select({ id: desktopHosts.id })
      .from(desktopHosts)
      .where(and(eq(desktopHosts.id, preferred), eq(desktopHosts.orgId, orgId), isNull(desktopHosts.revokedAt)))
      .limit(1)
    if (row) return row.id
  }
  const [row] = await db
    .select({ id: desktopHosts.id })
    .from(desktopHosts)
    .where(and(eq(desktopHosts.orgId, orgId), isNull(desktopHosts.revokedAt)))
    .orderBy(desc(desktopHosts.lastSeenAt))
    .limit(1)
  return row?.id ?? null
}

async function waitFor<T>(id: string, read: () => Promise<{ status: string; error: string | null; done: T | null }>, signal?: AbortSignal): Promise<T> {
  const started = Date.now()
  while (Date.now() - started < WAIT_MS) {
    signal?.throwIfAborted()
    const row = await read()
    if (row.status === "done" && row.done !== null) return row.done
    if (row.status === "failed") throw new Error(row.error || "The computer couldn't finish that")
    await sleep(400, signal)
  }
  throw new Error("Open the Sayabot app on your computer and try again. It didn't answer in time.")
}

export async function runSecretOnDesktop(args: {
  orgId: string
  connectorId: string
  source: string
  action: "search" | "read"
  query: string
  vault?: string
  hostId?: string | null
  signal?: AbortSignal
}): Promise<unknown> {
  const hostId = await hostForOrg(args.orgId, args.hostId)
  if (!hostId) throw new Error("No computer with the Sayabot app is connected to this workspace.")
  const db = getDb()
  const [job] = await db
    .insert(desktopSecretJobs)
    .values({
      hostId,
      orgId: args.orgId,
      connectorId: args.connectorId,
      source: args.source,
      action: args.action,
      query: args.query,
      vault: args.vault ?? null,
      status: "queued",
    })
    .returning({ id: desktopSecretJobs.id })
  if (!job) throw new Error("Could not ask the computer")
  try {
    return await waitFor(job.id, async () => {
      const [row] = await db
        .select({ status: desktopSecretJobs.status, error: desktopSecretJobs.error, resultEnc: desktopSecretJobs.resultEnc })
        .from(desktopSecretJobs)
        .where(eq(desktopSecretJobs.id, job.id))
        .limit(1)
      if (!row) return { status: "failed", error: "Job disappeared", done: null }
      const done = row.status === "done" && row.resultEnc ? JSON.parse(openSecret(row.resultEnc, getEnv().MESH_KEK)) : null
      return { status: row.status, error: row.error, done }
    }, args.signal)
  } catch (error) {
    await db
      .update(desktopSecretJobs)
      .set({ status: "failed", error: "timed out", finishedAt: new Date() })
      .where(and(eq(desktopSecretJobs.id, job.id), eq(desktopSecretJobs.status, "queued")))
    throw error
  }
}

export async function runMcpOnDesktop(args: {
  orgId: string
  serverId: string
  appId: string
  method: string
  params?: Record<string, unknown>
  hostId?: string | null
  signal?: AbortSignal
}): Promise<unknown> {
  const hostId = await hostForOrg(args.orgId, args.hostId)
  if (!hostId) throw new Error("Open the Sayabot app on the computer that has this app.")
  const db = getDb()
  const [job] = await db
    .insert(desktopMcpCalls)
    .values({
      hostId,
      orgId: args.orgId,
      serverId: args.serverId,
      appId: args.appId,
      method: args.method,
      params: args.params ?? {},
      status: "queued",
    })
    .returning({ id: desktopMcpCalls.id })
  if (!job) throw new Error("Could not ask the computer")
  try {
    return await waitFor(job.id, async () => {
      const [row] = await db
        .select({ status: desktopMcpCalls.status, error: desktopMcpCalls.error, result: desktopMcpCalls.result })
        .from(desktopMcpCalls)
        .where(eq(desktopMcpCalls.id, job.id))
        .limit(1)
      if (!row) return { status: "failed", error: "Call disappeared", done: null }
      return { status: row.status, error: row.error, done: row.status === "done" ? row.result : null }
    }, args.signal)
  } catch (error) {
    await db
      .update(desktopMcpCalls)
      .set({ status: "failed", error: "timed out", finishedAt: new Date() })
      .where(and(eq(desktopMcpCalls.id, job.id), eq(desktopMcpCalls.status, "queued")))
    throw error
  }
}
