import { redactSecrets, type TurnRole } from "@sayabot/core"
import { agentRuns, messages } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { registerRun, unregisterRun } from "../active-runs"
import { waitForBotReply } from "../bot-reply"
import { getDb } from "../db"
import type { WebhookJobData } from "../jobs/webhook"
import type { AgentRow, MessageRow, RoomRow } from "./context"

export interface ExternalTurnArgs {
  room: RoomRow
  agent: AgentRow
  sessionId: string
  threadRootId: string | null
  trigger: MessageRow
  role: TurnRole
  step: number
  payload: WebhookJobData["payload"]
  enqueueWebhook: (data: WebhookJobData) => Promise<void>
}

export interface ExternalTurnResult {
  runId: string
  messageId: string | null
  content: string
  timedOut: boolean
  aborted: boolean
  error: string | null
  /** Pull-based (MCP) bot: nothing to wait for, it picks the turn up from get_inbox. */
  deferred?: boolean
}

function abortPromise(signal: AbortSignal): { promise: Promise<null>; cleanup: () => void } {
  let onAbort: (() => void) | undefined
  const promise = new Promise<null>((resolve) => {
    if (signal.aborted) return resolve(null)
    onAbort = () => resolve(null)
    signal.addEventListener("abort", onAbort, { once: true })
  })
  return {
    promise,
    cleanup: () => {
      if (onAbort) signal.removeEventListener("abort", onAbort)
    },
  }
}

/**
 * Hands the floor to an external bot and waits up to 60 seconds for it to post
 * a reply. The waiter is registered before dispatch so a fast bot cannot race it.
 */
export async function runExternalTurn(args: ExternalTurnArgs): Promise<ExternalTurnResult> {
  const db = getDb()
  const [run] = await db
    .insert(agentRuns)
    .values({
      sessionId: args.sessionId,
      roomId: args.room.id,
      agentId: args.agent.id,
      step: args.step,
      role: args.role,
      status: "running",
    })
    .returning()
  if (!run) throw new Error("failed to create external agent run")

  if (!args.agent.webhookUrl) {
    // MCP-connected bots run in their owner's own client. The mention is already in
    // their inbox; holding the floor for them would stall every other agent.
    await db
      .update(agentRuns)
      .set({ status: "complete", latencyMs: 0, error: "deferred to the bot's MCP inbox" })
      .where(eq(agentRuns.id, run.id))
    return { runId: run.id, messageId: null, content: "", timedOut: false, aborted: false, error: null, deferred: true }
  }

  const controller = registerRun(run.id, args.room.id)
  const started = Date.now()
  const replyPromise = waitForBotReply({
    roomId: args.room.id,
    agentId: args.agent.id,
    threadRootId: args.threadRootId,
  })

  try {
    await args.enqueueWebhook({
      orgId: args.room.orgId,
      roomId: args.room.id,
      agentId: args.agent.id,
      messageId: args.trigger.id,
      sessionId: args.sessionId,
      payload: args.payload,
    })
  } catch (error) {
    await db
      .update(agentRuns)
      .set({
        status: "error",
        error: redactSecrets(
          `webhook dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
        ).text,
        latencyMs: Date.now() - started,
      })
      .where(eq(agentRuns.id, run.id))
    unregisterRun(run.id)
    return {
      runId: run.id,
      messageId: null,
      content: "",
      timedOut: false,
      aborted: false,
      error: "webhook dispatch failed",
    }
  }

  const helper = abortPromise(controller.signal)
  let reply: Awaited<typeof replyPromise> | null = null
  try {
    reply = await Promise.race([replyPromise, helper.promise])
  } finally {
    helper.cleanup()
    unregisterRun(run.id)
  }
  const latencyMs = Date.now() - started

  if (controller.signal.aborted) {
    await db
      .update(agentRuns)
      .set({ status: "halted", latencyMs })
      .where(eq(agentRuns.id, run.id))
    return {
      runId: run.id,
      messageId: null,
      content: "",
      timedOut: false,
      aborted: true,
      error: null,
    }
  }

  if (!reply) {
    await db
      .update(agentRuns)
      .set({ status: "error", error: "external agent did not reply within 60 seconds", latencyMs })
      .where(eq(agentRuns.id, run.id))
    return {
      runId: run.id,
      messageId: null,
      content: "",
      timedOut: true,
      aborted: false,
      error: null,
    }
  }

  const [replyMessage] = await db
    .select({ content: messages.content })
    .from(messages)
    .where(eq(messages.id, reply.messageId))
    .limit(1)
  await db.update(messages).set({ runId: run.id }).where(eq(messages.id, reply.messageId))
  await db
    .update(agentRuns)
    .set({ status: "complete", messageId: reply.messageId, latencyMs })
    .where(eq(agentRuns.id, run.id))
  return {
    runId: run.id,
    messageId: reply.messageId,
    content: replyMessage?.content ?? "",
    timedOut: false,
    aborted: false,
    error: null,
  }
}
