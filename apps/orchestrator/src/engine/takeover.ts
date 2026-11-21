import { agents, messages } from "@sayabot/db"
import { eq, sql } from "drizzle-orm"
import { getDb } from "../db"
import { broadcast } from "../realtime"
import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"

/**
 * A bot can name a second model to answer with when its first one runs dry. The fallback carries its
 * own provider key, so a spent balance on one account does not stop the room.
 */
export interface FallbackModel {
  providerKeyId: string
  model: string
}

/** How long a model that reported an exhausted balance is skipped before it is tried again. */
export const QUOTA_HOLD_MS = 15 * 60_000

/** A hold never outlives this, so a long provider outage cannot strand a bot on its fallback. */
export const MAX_QUOTA_HOLD_MS = 6 * 60 * 60_000

interface HoldRow {
  until: number
  errorKind?: string
}

function paramsOf(agent: { params: unknown }): Record<string, unknown> {
  return { ...((agent.params as Record<string, unknown> | null) ?? {}) }
}

/** The bot's configured fallback, when it has one that could actually answer. */
export function fallbackFromParams(
  params: Record<string, unknown> | null | undefined,
): FallbackModel | null {
  const raw = (params ?? {}).fallback
  if (!raw || typeof raw !== "object") return null
  const candidate = raw as Record<string, unknown>
  const providerKeyId =
    typeof candidate.providerKeyId === "string" ? candidate.providerKeyId.trim() : ""
  const model = typeof candidate.model === "string" ? candidate.model.trim() : ""
  if (!providerKeyId || !model) return null
  return { providerKeyId, model }
}

/** Holds keyed by "providerKey/model", so two models on one account are tracked apart. */
export function quotaHolds(
  params: Record<string, unknown> | null | undefined,
): Record<string, HoldRow> {
  const raw = (params ?? {}).quotaHolds
  if (!raw || typeof raw !== "object") return {}
  const holds: Record<string, HoldRow> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue
    const row = value as Record<string, unknown>
    const until = typeof row.until === "number" ? row.until : Date.parse(String(row.until ?? ""))
    if (!Number.isFinite(until)) continue
    holds[key] = {
      until,
      ...(typeof row.errorKind === "string" ? { errorKind: row.errorKind } : {}),
    }
  }
  return holds
}

/** Identifies the model a turn would use, independently of the agent row's other fields. */
export function modelKeyOf(agent: { providerKeyId: string | null; model: string | null }): string {
  return `${agent.providerKeyId ?? "server"}/${agent.model ?? ""}`
}

/** When this model is currently held, its release time; otherwise null. */
export function activeHoldUntil(
  params: Record<string, unknown> | null | undefined,
  modelKey: string,
  now = Date.now(),
): number | null {
  const hold = quotaHolds(params)[modelKey]
  if (!hold) return null
  return hold.until > now ? hold.until : null
}

/** Drops holds that have already expired, so the stored params stay small. */
export function pruneHolds(
  holds: Record<string, HoldRow>,
  now = Date.now(),
): Record<string, HoldRow> {
  return Object.fromEntries(Object.entries(holds).filter(([, hold]) => hold.until > now))
}

async function persistHolds(agentId: string, holds: Record<string, HoldRow>): Promise<void> {
  await getDb()
    .update(agents)
    .set({
      params: sql`jsonb_set(coalesce(${agents.params}, '{}'::jsonb), '{quotaHolds}', ${JSON.stringify(holds)}::jsonb)`,
    })
    .where(eq(agents.id, agentId))
}

async function dropFailedAttempt(messageId: string, roomId: string): Promise<void> {
  try {
    await getDb().delete(messages).where(eq(messages.id, messageId))
    await broadcast(roomId, { type: "message.removed", messageId })
  } catch (error) {
    console.warn("[takeover] could not remove the failed attempt", error)
  }
}

function withFallback(
  args: RunLlmTurnArgs,
  params: Record<string, unknown>,
  holds: Record<string, HoldRow>,
  fallback: FallbackModel,
): RunLlmTurnArgs {
  return {
    ...args,
    agent: {
      ...args.agent,
      model: fallback.model,
      providerKeyId: fallback.providerKeyId,
      params: { ...params, quotaHolds: holds },
    },
  }
}

/**
 * Runs a turn on the bot's model, and when that model reports an exhausted balance, records a hold
 * and answers the same turn on the bot's fallback. While the hold lasts, later turns skip the dry
 * model entirely instead of spending a round trip to rediscover it. One takeover per turn: a
 * fallback that is also dry surfaces its own error, in plain words, rather than looping.
 */
export async function runWithQuotaTakeover(
  args: RunLlmTurnArgs,
  run: (args: RunLlmTurnArgs) => Promise<TurnResult>,
): Promise<TurnResult> {
  const params = paramsOf(args.agent)
  const fallback = fallbackFromParams(params)
  if (!fallback) return run(args)

  const modelKey = modelKeyOf(args.agent)
  const held = activeHoldUntil(params, modelKey)
  if (held) return run(withFallback(args, params, quotaHolds(params), fallback))

  const first = await run(args)
  if (first.errorKind !== "quota_exhausted") return first
  // The fallback shares the dry account: nothing to switch to.
  if (fallback.providerKeyId === args.agent.providerKeyId) return first

  const holds = pruneHolds({
    ...quotaHolds(params),
    [modelKey]: {
      until: Date.now() + Math.min(QUOTA_HOLD_MS, MAX_QUOTA_HOLD_MS),
      errorKind: "quota_exhausted",
    },
  })
  await persistHolds(args.agent.id, holds).catch((error: unknown) =>
    console.warn("[takeover] could not remember the hold", error),
  )
  await dropFailedAttempt(first.messageId, args.room.id)
  console.info(`[takeover] ${modelKey} is out of balance; answering on ${fallback.model}`)
  return run(withFallback(args, params, holds, fallback))
}
