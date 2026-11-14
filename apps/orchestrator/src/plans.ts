import {
  effectivePlan,
  isPlanId,
  limitMessage,
  PLANS,
  readEdition,
  upgradeFor,
  usageMonth,
  type PlanId,
} from "@sayabot/core"
import { agentRuns, messages, orgPlans, orgs } from "@sayabot/db"
import { eq, sql } from "drizzle-orm"
import { getDb } from "./db"
import { broadcast } from "./realtime"
import type { RunLlmTurnArgs, TurnResult } from "./runner/llm"

/**
 * Sayabot Cloud plan limits for agent replies that run on the server. Self-hosted servers
 * (the default) never count anything. Replies that run on the person's own Mac never count
 * either: they cost the server almost nothing, so they stay unlimited on every plan.
 */

export type TurnAdmission = { allowed: true } | { allowed: false; plan: PlanId; message: string }

export async function workspacePlan(orgId: string): Promise<PlanId> {
  const [row] = await getDb()
    .select({ plan: orgPlans.plan, status: orgPlans.status })
    .from(orgPlans)
    .where(eq(orgPlans.orgId, orgId))
    .limit(1)
  return effectivePlan(isPlanId(row?.plan) ? row.plan : "free", row?.status ?? "active")
}

/** Counts one server reply against the plan; refuses (without counting) when the month is used up. */
export async function admitServerTurn(orgId: string): Promise<TurnAdmission> {
  if (readEdition(process.env) !== "cloud") return { allowed: true }
  const db = getDb()
  const plan = await workspacePlan(orgId)
  const limit = PLANS[plan].limits.serverTurnsPerMonth
  const result = await db.execute<{ allowed: boolean; used: number }>(
    sql`select allowed, used from public.bump_server_turns(${orgId}::uuid, ${usageMonth()}, ${limit})`,
  )
  const row = result.rows[0]
  if (!row || row.allowed || limit === null) return { allowed: true }

  const [org] = await db.select({ slug: orgs.slug }).from(orgs).where(eq(orgs.id, orgId)).limit(1)
  const domain = process.env.SAYABOT_DOMAIN?.trim()
  const path = org ? `/${org.slug}/settings/billing` : null
  const link = path ? (domain ? `https://${domain}${path}` : path) : null
  const next = upgradeFor(plan, "serverTurnsPerMonth", limit + 1)
  const parts = [
    limitMessage("serverTurnsPerMonth", plan, limit),
    "Agents that run on your Mac keep working, with no limit.",
    next
      ? `For more server replies, upgrade to ${PLANS[next].name}${link ? `: [Plan & billing](${link})` : " in Settings → Plan & billing"}.`
      : "The count starts again on the 1st of next month.",
  ]
  return { allowed: false, plan, message: parts.join(" ") }
}

/** The agent's reply when the plan's server replies are used up: a friendly note, not an error. */
export async function planLimitTurn(args: RunLlmTurnArgs, message: string): Promise<TurnResult> {
  const db = getDb()
  const { room, agent } = args
  const [run] = await db
    .insert(agentRuns)
    .values({
      sessionId: args.sessionId,
      roomId: room.id,
      agentId: agent.id,
      step: args.step,
      role: args.role,
      status: "complete",
      taskId: args.taskId ?? null,
      engine: "plan-limit",
      finishReason: "plan_limit",
    })
    .returning()
  if (!run) throw new Error("failed to record the plan-limit reply")
  const [reply] = await db
    .insert(messages)
    .values({
      roomId: room.id,
      threadRootId: args.threadRootId,
      senderType: "agent",
      senderId: agent.id,
      content: message,
      status: "complete",
      mentions: [],
      runId: run.id,
      metadata: {
        agentName: agent.displayName,
        agentHandle: agent.handle,
        role: args.role,
        planLimit: true,
      },
    })
    .returning({ id: messages.id })
  if (!reply) throw new Error("failed to post the plan-limit reply")
  await db.update(agentRuns).set({ messageId: reply.id }).where(eq(agentRuns.id, run.id))
  await broadcast(room.id, { type: "message.done", messageId: reply.id, status: "complete" }).catch(
    () => {},
  )
  return { messageId: reply.id, runId: run.id, content: message, error: null, aborted: false }
}
