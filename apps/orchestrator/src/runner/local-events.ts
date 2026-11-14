import { redactSecrets } from "@sayabot/core"
import { agents, desktopHosts, localRunnerJobs, toolCalls } from "@sayabot/db"
import { and, eq, sql } from "drizzle-orm"
import { notifyHumansNeeded } from "../push"
import { getDb } from "../db"
import { broadcast } from "../realtime"
import { waitForApproval } from "../tools/approvals"

/**
 * Live tool activity and approvals for agents that run on their owner's Mac. The Mac reports
 * what Claude Code / Codex does (keyed by the app's own tool-use id), and every step shows up as
 * the same tool cards a server run gets. When the app wants to do something that needs a person,
 * the card turns into an approval that the Mac's owner can answer from the web, the phone or the
 * Mac itself.
 */

export const MAC_APPROVAL_TIMEOUT_MS = 5 * 60_000
const MAX_TEXT = 4_000
const MAX_ARG_TEXT = 2_000

export type MacToolEvent =
  | { type: "started"; key: string; toolName: string; args: Record<string, unknown> }
  | { type: "finished"; key: string; ok: boolean; result?: string }

/** Marks a tool card as coming from a Mac run (hidden from the card; used for lookups and rules). */
export interface MacMarker {
  key: string
  jobId: string
  hostId: string
  hostName: string
  /** The Mac's owner: the only person who can answer its approvals. */
  ownerId: string
  agentId: string
}

export class LocalJobError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
  }
}

interface JobContext {
  id: string
  roomId: string
  runId: string | null
  replyMessageId: string | null
  agentId: string
  agentName: string
  hostId: string
  hostName: string
  ownerId: string
}

async function runningJob(jobId: string, hostId: string): Promise<JobContext> {
  const [row] = await getDb()
    .select({
      id: localRunnerJobs.id,
      status: localRunnerJobs.status,
      hostId: localRunnerJobs.hostId,
      roomId: localRunnerJobs.roomId,
      runId: localRunnerJobs.runId,
      replyMessageId: localRunnerJobs.replyMessageId,
      agentId: localRunnerJobs.agentId,
      agentName: agents.displayName,
      hostName: desktopHosts.name,
      ownerId: desktopHosts.userId,
    })
    .from(localRunnerJobs)
    .innerJoin(agents, eq(agents.id, localRunnerJobs.agentId))
    .innerJoin(desktopHosts, eq(desktopHosts.id, localRunnerJobs.hostId))
    .where(eq(localRunnerJobs.id, jobId))
    .limit(1)
  if (!row || row.hostId !== hostId) throw new LocalJobError("job not found", 404)
  if (row.status !== "running") throw new LocalJobError("job is not running", 409)
  return row
}

/** Tool input as stored and shown: secrets scrubbed, long strings cut. */
export function storedArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args ?? {}).slice(0, 30)) {
    if (key.startsWith("_")) continue
    if (typeof value === "string") {
      const clean = redactSecrets(value).text
      out[key] = clean.length > MAX_ARG_TEXT ? `${clean.slice(0, MAX_ARG_TEXT)}…` : clean
    } else {
      const json = JSON.stringify(value ?? null)
      const clean = redactSecrets(json).text
      out[key] = clean.length > MAX_ARG_TEXT ? `${clean.slice(0, MAX_ARG_TEXT)}…` : safeParse(clean)
    }
  }
  return out
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function cleanKey(key: unknown): string {
  const value = typeof key === "string" ? key.trim() : ""
  if (!/^[\w.:-]{1,120}$/.test(value)) throw new LocalJobError("invalid tool key")
  return value
}

function cleanToolName(name: unknown): string {
  const value = typeof name === "string" ? name.trim() : ""
  if (!/^[\w.:-]{1,120}$/.test(value)) throw new LocalJobError("invalid tool name")
  return value
}

async function findByKey(roomId: string, jobId: string, key: string) {
  const [row] = await getDb()
    .select({ id: toolCalls.id, status: toolCalls.status, createdAt: toolCalls.createdAt })
    .from(toolCalls)
    .where(
      and(
        eq(toolCalls.roomId, roomId),
        sql`${toolCalls.args} -> '_mac' ->> 'key' = ${key}`,
        sql`${toolCalls.args} -> '_mac' ->> 'jobId' = ${jobId}`,
      ),
    )
    .limit(1)
  return row ?? null
}

function marker(job: JobContext, key: string): MacMarker {
  return {
    key,
    jobId: job.id,
    hostId: job.hostId,
    hostName: job.hostName,
    ownerId: job.ownerId,
    agentId: job.agentId,
  }
}

async function insertCard(
  job: JobContext,
  key: string,
  toolName: string,
  args: Record<string, unknown>,
  status: "running" | "pending_approval",
) {
  const stored = { ...storedArgs(args), _mac: marker(job, key) }
  const [row] = await getDb()
    .insert(toolCalls)
    .values({
      runId: job.runId,
      roomId: job.roomId,
      messageId: job.replyMessageId,
      toolName,
      args: stored,
      status,
    })
    .returning({ id: toolCalls.id })
  if (!row) throw new LocalJobError("could not record the tool call", 500)
  await broadcast(job.roomId, {
    type: "tool.started",
    toolCallId: row.id,
    agentId: job.agentId,
    toolName,
    args: stored,
  }).catch(() => {})
  return { id: row.id, args: stored }
}

/** What the Mac's app is doing, as tool cards in the room. Returns the card id per key. */
export async function recordMacToolEvents(
  jobId: string,
  hostId: string,
  events: MacToolEvent[],
): Promise<Record<string, string>> {
  const job = await runningJob(jobId, hostId)
  const ids: Record<string, string> = {}
  for (const event of events.slice(0, 50)) {
    const key = cleanKey(event.key)
    const existing = await findByKey(job.roomId, job.id, key)
    if (event.type === "started") {
      if (existing) {
        ids[key] = existing.id
        continue
      }
      const card = await insertCard(
        job,
        key,
        cleanToolName(event.toolName),
        event.args ?? {},
        "running",
      )
      ids[key] = card.id
      continue
    }
    if (!existing) continue
    ids[key] = existing.id
    // A refused approval already closed the card; anything else finishes now.
    if (existing.status !== "running" && existing.status !== "approved") continue
    const status = event.ok ? "done" : "error"
    const result =
      typeof event.result === "string" ? redactSecrets(event.result).text.slice(0, MAX_TEXT) : null
    await getDb()
      .update(toolCalls)
      .set({
        status,
        result: result === null ? null : { output: result },
        error: event.ok ? null : (result ?? "failed").slice(0, 500),
        resolvedAt: new Date(),
      })
      .where(eq(toolCalls.id, existing.id))
    await broadcast(job.roomId, {
      type: "tool.finished",
      toolCallId: existing.id,
      status: event.ok ? "done" : "error",
      durationMs: Date.now() - existing.createdAt.getTime(),
    }).catch(() => {})
  }
  return ids
}

/**
 * The app on the Mac wants to do something that needs a person (run a command, edit a file).
 * The tool card turns into an approval; the Mac polls its status. Unanswered after five
 * minutes, it's refused.
 */
export async function requestMacApproval(
  jobId: string,
  hostId: string,
  input: { key: string; toolName: string; args: Record<string, unknown> },
): Promise<{ toolCallId: string }> {
  const job = await runningJob(jobId, hostId)
  const key = cleanKey(input.key)
  const toolName = cleanToolName(input.toolName)
  const existing = await findByKey(job.roomId, job.id, key)
  let toolCallId: string
  let args: Record<string, unknown>
  if (existing) {
    if (existing.status === "pending_approval") return { toolCallId: existing.id }
    args = { ...storedArgs(input.args ?? {}), _mac: marker(job, key) }
    await getDb()
      .update(toolCalls)
      .set({ status: "pending_approval", args, toolName })
      .where(eq(toolCalls.id, existing.id))
    toolCallId = existing.id
  } else {
    const card = await insertCard(job, key, toolName, input.args ?? {}, "pending_approval")
    toolCallId = card.id
    args = card.args
  }

  await broadcast(job.roomId, {
    type: "tool.approval_requested",
    toolCallId,
    agentId: job.agentId,
    toolName,
    args,
  }).catch(() => {})
  notifyHumansNeeded({
    roomId: job.roomId,
    agentId: job.agentId,
    kind: "approval",
    detail: `${toolName} on ${job.hostName}`,
    refId: toolCallId,
  })

  // Close the card for everyone once it's answered, or refuse it when nobody does.
  void waitForApproval(toolCallId, MAC_APPROVAL_TIMEOUT_MS)
    .then(async (decision) => {
      if (decision === "rejected") {
        await getDb()
          .update(toolCalls)
          .set({
            status: "rejected",
            resolvedAt: new Date(),
            error: "Refused, or nobody answered in time",
          })
          .where(and(eq(toolCalls.id, toolCallId), eq(toolCalls.status, "pending_approval")))
      }
      await broadcast(job.roomId, { type: "tool.approval_resolved", toolCallId, status: decision })
    })
    .catch(() => {})
  return { toolCallId }
}
