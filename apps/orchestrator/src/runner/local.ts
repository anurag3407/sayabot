import { hostOnline, MAC_CLI_APP_IDS, redactSecrets } from "@sayabot/core"
import { clampEffort, ENGINE_EFFORT_LEVELS } from "@sayabot/llm/models/effort"
import { sealSecret } from "@sayabot/llm"
import { agentRuns, desktopHosts, localRunnerJobs, messages, orgMembers, toolCalls } from "@sayabot/db"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { registerRun, unregisterRun } from "../active-runs"
import { getDb } from "../db"
import { getEnv } from "../env"
import { broadcast } from "../realtime"
import { ROOM_TOOLS_NOTE } from "./cli"
import { mintMacMcpToken, revokeMcpToken } from "./cli-mcp"
import {
  buildSystemPrompt,
  buildUserPrompt,
  loadCanvasContext,
  loadConversation,
  loadTaskBriefContext,
  loadTaskContext,
  renderTranscript,
} from "./context"
import { serverCanAnswer, withoutRunner, type RunLlmTurnArgs, type TurnResult } from "./llm"

/**
 * An agent that answers through an app signed in on the owner's own computer (Claude Code,
 * Codex…), on their subscription. The turn becomes a job; the desktop app runs it and streams
 * its output back, which we relay into the room message as it arrives.
 */

/**
 * Apps a Mac runs agents with: signed-in agent CLIs (MAC_CLI_APPS in @sayabot/core: Claude Code,
 * Codex, Copilot, Command Code, Kimi, Kiro…) and models served locally (Ollama, LM Studio).
 */
export const MAC_RUNNER_APPS: readonly string[] = [...MAC_CLI_APP_IDS, "ollama", "lmstudio"]
export type MacRunnerApp = string

export interface LocalRunnerConfig {
  hostId: string
  app: MacRunnerApp
  /** The model inside the app; null keeps the app's own default. */
  model?: string | null
  /** Thinking effort, for apps that take one. */
  effort?: string | null
}

/** A model id reaches the Mac's command line, so only plain ones pass. */
const MAC_MODEL_ID = /^[\w.:/@+[\]-]{1,160}$/

export function localRunnerConfig(params: Record<string, unknown> | null | undefined): LocalRunnerConfig | null {
  const runner = params?.runner as Record<string, unknown> | undefined
  if (!runner || typeof runner.hostId !== "string" || !/^[0-9a-f-]{36}$/i.test(runner.hostId)) return null
  const app = MAC_RUNNER_APPS.includes(String(runner.app)) ? String(runner.app) : "claude-code"
  const model =
    typeof runner.model === "string" && runner.model !== "default" && MAC_MODEL_ID.test(runner.model)
      ? runner.model
      : null
  const effort = clampEffort(params?.effort as string | undefined, ENGINE_EFFORT_LEVELS[app] ?? []) ?? null
  return { hostId: runner.hostId, app, ...(model ? { model } : {}), ...(effort ? { effort } : {}) }
}

/** The Mac default only picks a signed-in app; a local model needs a model picked for it. */
const RUNNER_APPS = new Set<string>(MAC_CLI_APP_IDS)

/**
 * The owner's Mac as the default for agents that have no key or computer of their own, when
 * Sayabot for Mac has it turned on (`settings.localDefault`, set by the heartbeat). Only in
 * workspaces where the Mac's owner is the only member, so nobody else's messages run on their
 * Mac, and only while it's online. Otherwise the server answers as before.
 */
export async function defaultMacRunner(agent: {
  orgId: string
  providerKeyId: string | null
  params: unknown
}): Promise<LocalRunnerConfig | null> {
  if (agent.providerKeyId) return null
  // Where the bot runs, not what it can click: the Mac's screen stays gated separately
  // (resolveComputer in the computer tools), so a bot with the screen off still runs here.
  if ((agent.params as Record<string, unknown> | null)?.runner) return null
  const db = getDb()
  const members = await db
    .select({ userId: orgMembers.userId })
    .from(orgMembers)
    .where(eq(orgMembers.orgId, agent.orgId))
    .limit(2)
  const owner = members.length === 1 ? members[0] : undefined
  if (!owner) return null
  const hosts = await db
    .select({ id: desktopHosts.id, settings: desktopHosts.settings, lastSeenAt: desktopHosts.lastSeenAt })
    .from(desktopHosts)
    .where(and(eq(desktopHosts.userId, owner.userId), isNull(desktopHosts.revokedAt)))
    .orderBy(desc(desktopHosts.lastSeenAt))
    .limit(5)
  for (const host of hosts) {
    const choice = host.settings?.localDefault
    const app = choice && typeof choice === "object" ? choice.app : null
    if (host.settings?.runnerEnabled && app && RUNNER_APPS.has(app) && hostOnline(host.lastSeenAt)) {
      return { hostId: host.id, app: app as LocalRunnerConfig["app"] }
    }
  }
  return null
}

/**
 * What a bot pinned to a Mac does when that Mac can't take the turn (asleep, closed, the app not
 * running): answer from the server, wait for the Mac (up to 15 minutes), or fail with a note.
 * "auto" (the default) answers from the server when the server can, and waits otherwise.
 */
export const WHEN_MAC_OFF = ["auto", "server", "wait", "fail"] as const
export type WhenMacOff = (typeof WHEN_MAC_OFF)[number]

export function whenMacOff(params: unknown): WhenMacOff {
  const value = (params as Record<string, unknown> | null)?.whenMacOff
  return (WHEN_MAC_OFF as readonly string[]).includes(String(value)) ? (value as WhenMacOff) : "auto"
}

/** "local": the Mac takes it now. "wait": queue it for the Mac. "server": answer from the server. */
export async function macPlan(
  agent: RunLlmTurnArgs["agent"],
  config: LocalRunnerConfig,
): Promise<"local" | "wait" | "server"> {
  const [host] = await getDb()
    .select({ userId: desktopHosts.userId, revokedAt: desktopHosts.revokedAt, settings: desktopHosts.settings, lastSeenAt: desktopHosts.lastSeenAt })
    .from(desktopHosts)
    .where(eq(desktopHosts.id, config.hostId))
    .limit(1)
  const usable = host && !host.revokedAt && host.userId === agent.ownerUserId && host.settings?.runnerEnabled
  if (usable && hostOnline(host.lastSeenAt)) return "local"
  const choice = whenMacOff(agent.params)
  // A Mac that's gone or switched off for bots won't come back on its own: waiting can't help.
  if (choice === "fail") return "local"
  const server = choice !== "wait" && (await serverCanAnswer({ ...agent, params: withoutRunner(agent.params) }))
  if (server) return "server"
  return usable && choice !== "server" ? "wait" : "local"
}

/** Where a Mac run is, for the app: its own folder, and asking before anything risky. */
const MAC_NOTE =
  "You are running on your owner's Mac, in your own folder. Steps that change things outside it, run commands or open the network ask your owner first; if they say no, don't retry the same step, explain what you needed instead."

/** Apps that take Sayabot's room tools over MCP when they run on a Mac. */
const MAC_MCP_APPS = new Set<string>(["claude-code", "codex"])

/** Approval cards still waiting when a Mac job ends can't be answered any more. */
async function expireMacApprovals(roomId: string, jobId: string): Promise<void> {
  const db = getDb()
  const expired = await db
    .update(toolCalls)
    .set({ status: "rejected", resolvedAt: new Date(), error: "The run ended before anyone answered" })
    .where(
      and(
        eq(toolCalls.roomId, roomId),
        eq(toolCalls.status, "pending_approval"),
        sql`${toolCalls.args} -> '_mac' ->> 'jobId' = ${jobId}`,
      ),
    )
    .returning({ id: toolCalls.id })
    .catch(() => [])
  for (const row of expired) {
    await broadcast(roomId, { type: "tool.approval_resolved", toolCallId: row.id, status: "rejected" }).catch(() => {})
  }
}

const POLL_MS = 1_200
const MAX_MS = 15 * 60_000
const START_GRACE_MS = 60_000

export async function runLocalTurn(
  args: RunLlmTurnArgs,
  config: LocalRunnerConfig,
  options: { wait?: boolean } = {},
): Promise<TurnResult> {
  const db = getDb()
  const { room, agent } = args

  const conversation = await loadConversation({ roomId: room.id, threadRootId: args.threadRootId })
  const [canvasContext, taskContext, taskBrief] = await Promise.all([
    loadCanvasContext(room.id),
    loadTaskContext(room.id),
    args.taskId ? loadTaskBriefContext(args.taskId) : Promise.resolve(""),
  ])
  const system = buildSystemPrompt({ room, agent, role: args.role })
  const prompt = buildUserPrompt({
    transcript: renderTranscript(conversation),
    canvases: canvasContext,
    tasks: taskContext,
    agent,
    extra: taskBrief || undefined,
  })

  const [run] = await db
    .insert(agentRuns)
    .values({
      sessionId: args.sessionId,
      roomId: room.id,
      agentId: agent.id,
      step: args.step,
      role: args.role,
      status: "running",
      taskId: args.taskId ?? null,
      engine: "local",
    })
    .returning()
  if (!run) throw new Error("failed to create agent run")
  const [message] = await db
    .insert(messages)
    .values({
      roomId: room.id,
      threadRootId: args.threadRootId,
      senderType: "agent",
      senderId: agent.id,
      content: "",
      status: "streaming",
      mentions: [],
      runId: run.id,
      metadata: {
        agentName: agent.displayName,
        agentHandle: agent.handle,
        role: args.role,
        runsOn: config.app,
        where: "mac",
        ...(config.model ? { model: config.model } : {}),
      },
    })
    .returning()
  if (!message) throw new Error("failed to create agent message")
  await db.update(agentRuns).set({ messageId: message.id }).where(eq(agentRuns.id, run.id))

  // Set once the job is queued: the Mac's one-run tool token and the job itself, cleaned up below.
  let mcpTokenId: string | null = null
  let jobId: string | null = null
  const finish = async (
    content: string,
    status: "complete" | "error" | "halted",
    error: string | null,
    errorKind: "mac_offline" | "mac_removed" | "runner_off" | null = null,
  ) => {
    await revokeMcpToken(mcpTokenId)
    if (jobId) await expireMacApprovals(room.id, jobId)
    const safe = redactSecrets(content).text
    await db
      .update(messages)
      .set({
        content: safe,
        status,
        metadata: {
          ...(message.metadata as Record<string, unknown>),
          ...(error ? { error } : {}),
          ...(errorKind ? { errorKind } : {}),
        },
      })
      .where(eq(messages.id, message.id))
    await db
      .update(agentRuns)
      .set({ status: status === "halted" ? "halted" : status === "error" ? "error" : "complete", error, finishReason: status === "complete" ? "stop" : status })
      .where(eq(agentRuns.id, run.id))
    await broadcast(room.id, { type: "message.done", messageId: message.id, status }).catch(() => {})
    return { messageId: message.id, runId: run.id, content: safe, error, aborted: status === "halted" } satisfies TurnResult
  }

  const [host] = await db.select().from(desktopHosts).where(eq(desktopHosts.id, config.hostId)).limit(1)
  if (!host || host.revokedAt || host.userId !== agent.ownerUserId) {
    return finish("", "error", "The computer this bot ran on was removed. Pick another model with \"Switch model\".", "mac_removed")
  }
  if (!host.settings?.runnerEnabled) {
    return finish("", "error", `"Run agents on this computer" is off for ${host.name}. Turn it on in Settings → Computers.`, "runner_off")
  }
  const waiting = options.wait === true && !hostOnline(host.lastSeenAt)
  if (!hostOnline(host.lastSeenAt) && !waiting) {
    return finish("", "error", `${host.name} is offline. Open Sayabot for Mac there and retry, or pick another model with "Switch model".`, "mac_offline")
  }
  // Waiting: the reply says so until the Mac answers (the answer then replaces it).
  const waitingNote = waiting ? `_Waiting for ${host.name}. Open Sayabot for Mac there and I'll answer._` : ""
  if (waitingNote) {
    await db.update(messages).set({ content: waitingNote }).where(eq(messages.id, message.id))
    await broadcast(room.id, { type: "message.delta", messageId: message.id, seq: 0, delta: waitingNote }).catch(() => {})
  }

  // Claude Code and Codex get Sayabot's room tools (tasks, canvas, decisions, facts) through a
  // token for this agent and room only, revoked when the job ends. The others answer in text.
  const grant = MAC_MCP_APPS.has(config.app)
    ? await mintMacMcpToken({ agentId: agent.id, roomId: room.id }).catch((error: unknown) => {
        console.warn("[local-runner] no room tools for this run", error)
        return null
      })
    : null
  mcpTokenId = grant?.tokenId ?? null

  const [job] = await db
    .insert(localRunnerJobs)
    .values({
      hostId: host.id,
      agentId: agent.id,
      roomId: room.id,
      messageId: args.trigger.id,
      replyMessageId: message.id,
      runId: run.id,
      app: config.app,
      model: config.model ?? null,
      effort: config.effort ?? null,
      prompt: `${grant ? `${system}\n\n${ROOM_TOOLS_NOTE} ${MAC_NOTE}` : system}\n\n${prompt}`.slice(0, 200_000),
      status: "queued",
      mcpTokenEnc: grant ? sealSecret(grant.token, getEnv().MESH_KEK) : null,
      mcpTokenId,
    })
    .returning({ id: localRunnerJobs.id })
  if (!job) return finish("", "error", "Could not queue the job")
  jobId = job.id

  const controller = registerRun(run.id, room.id, { agentId: agent.id, engine: "local" })
  const started = Date.now()
  let sent = waitingNote
  let seq = waitingNote ? 1 : 0
  try {
    while (Date.now() - started < MAX_MS) {
      if (controller.signal.aborted) {
        await db.update(localRunnerJobs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(localRunnerJobs.id, job.id))
        return finish(sent === waitingNote ? "" : sent, "halted", null)
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
      const [state] = await db
        .select({ status: localRunnerJobs.status, output: localRunnerJobs.output, error: localRunnerJobs.error })
        .from(localRunnerJobs)
        .where(eq(localRunnerJobs.id, job.id))
        .limit(1)
      if (!state) return finish(sent, "error", "The job disappeared")
      const output = redactSecrets(state.output ?? "").text
      if (output.length > sent.length && output.startsWith(sent)) {
        const delta = output.slice(sent.length)
        sent = output
        await broadcast(room.id, { type: "message.delta", messageId: message.id, seq: seq++, delta }).catch(() => {})
        await db.update(messages).set({ content: sent }).where(eq(messages.id, message.id))
      } else if (output !== sent && output) {
        sent = output
        await db.update(messages).set({ content: sent }).where(eq(messages.id, message.id))
      }
      if (state.status === "done") return finish(sent === waitingNote ? "" : sent, "complete", null)
      if (state.status === "failed") return finish(sent === waitingNote ? "" : sent, "error", state.error ?? "It failed on the computer")
      if (state.status === "queued" && !waiting && Date.now() - started > START_GRACE_MS) {
        await db.update(localRunnerJobs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(localRunnerJobs.id, job.id))
        return finish("", "error", `${host.name} didn't pick this up. Open Sayabot for Mac there and retry, or pick another model with "Switch model".`, "mac_offline")
      }
    }
    await db.update(localRunnerJobs).set({ status: "cancelled", finishedAt: new Date() }).where(eq(localRunnerJobs.id, job.id))
    return waiting && sent === waitingNote
      ? finish("", "error", `${host.name} stayed offline for 15 minutes. Open Sayabot for Mac there and retry, or pick another model with "Switch model".`, "mac_offline")
      : finish(sent, "error", "Took longer than 15 minutes, so it was stopped.")
  } finally {
    unregisterRun(run.id)
  }
}
