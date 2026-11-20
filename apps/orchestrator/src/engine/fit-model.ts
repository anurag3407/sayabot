import { agents, messages } from "@sayabot/db"
import { eq, sql } from "drizzle-orm"
import { getDb } from "../db"
import { broadcast } from "../realtime"
import type { RunLlmTurnArgs, TurnResult } from "../runner/llm"
import { nextLeanLimit } from "./lean"

/**
 * When a provider refuses a reply as too large for its plan, the bot learns that model's limit,
 * the failed attempt disappears from the chat, and the same turn runs again lean (see lean.ts).
 * Later turns with that model stay lean. One retry per turn; a second refusal is shown in plain
 * words with what to do.
 */
export async function runFittingTheModel(
  args: RunLlmTurnArgs,
  run: (args: RunLlmTurnArgs) => Promise<TurnResult>,
): Promise<TurnResult> {
  const first = await run(args)
  if (first.errorKind !== "request_too_large" || !first.modelKey) return first
  const next = nextLeanLimit(first.errorLimitTokens, first.leanLimit ?? null)
  if (!next) return first

  const key = first.modelKey
  const db = getDb()
  await db
    .update(agents)
    .set({
      params: sql`jsonb_set(coalesce(${agents.params}, '{}'::jsonb), '{requestLimits}', coalesce(${agents.params} -> 'requestLimits', '{}'::jsonb) || jsonb_build_object(${key}::text, ${next}::int))`,
    })
    .where(eq(agents.id, args.agent.id))
    .catch((error: unknown) => console.warn("[fit-model] could not remember the limit", error))
  try {
    await db.delete(messages).where(eq(messages.id, first.messageId))
    await broadcast(args.room.id, { type: "message.removed", messageId: first.messageId })
  } catch (error) {
    console.warn("[fit-model] could not remove the failed attempt", error)
  }

  const params = { ...((args.agent.params as Record<string, unknown> | null) ?? {}) }
  const limits =
    params.requestLimits && typeof params.requestLimits === "object" ? params.requestLimits : {}
  params.requestLimits = { ...(limits as Record<string, unknown>), [key]: next }
  return run({ ...args, agent: { ...args.agent, params } })
}
