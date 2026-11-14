import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { redactSecrets } from "@sayabot/core"
import { agentRuns, messages } from "@sayabot/db"
import { devModelConfig } from "@sayabot/llm"
import { eq } from "drizzle-orm"
import { registerRun, unregisterRun } from "../active-runs"
import { getDb } from "../db"
import { broadcast } from "../realtime"
import { recordUsageEvent } from "../usage"
import {
  CLI_APP_NAME,
  cliAgentFolder,
  cliCommand,
  cliEnvironment,
  cliFailureHint,
  cliRunnerAllowed,
  cliRunnerConfig,
  cliSignedIn,
  findCliBinary,
  parseCliLine,
  type CliEvent,
  type CliRunnerConfig,
} from "./cli-agent"
import { grantCliMcp } from "./cli-mcp"
import {
  buildSystemPrompt,
  buildUserPrompt,
  loadCanvasContext,
  loadConversation,
  loadTaskBriefContext,
  loadTaskContext,
  renderTranscript,
} from "./context"
import type { RunLlmTurnArgs, TurnResult } from "./llm"

const MAX_RUNTIME_MS = 14 * 60_000
const BROADCAST_MS = 40
const PERSIST_MS = 1_000

export const ROOM_TOOLS_NOTE = [
  "You are running inside Sayabot through the sayabot MCP tools.",
  "Your final reply is posted to this room for you, so answer directly; do not call post_message for it.",
  "Use the sayabot tools for the room's tasks, canvas, votes, owner facts and to ask the humans for decisions (request_human_decision) before anything high-stakes.",
].join(" ")

/** The app signed in on this computer that an agent with no key and no runner falls back to. */
export async function defaultCliRunner(): Promise<CliRunnerConfig | null> {
  if (!cliRunnerAllowed()) return null
  for (const app of ["claude-code", "codex", "cursor"] as const) {
    if ((await findCliBinary(app)) && (await cliSignedIn(app))) return { app, model: null }
  }
  return null
}

/** The CLI config an agent uses, or null when it uses a key: explicit runner first, then the fallback. */
export async function agentCliRunner(agent: {
  providerKeyId: string | null
  params: unknown
}): Promise<CliRunnerConfig | null> {
  const explicit = cliRunnerConfig(agent.params as Record<string, unknown> | null)
  if (explicit) return explicit
  if (agent.providerKeyId || devModelConfig()) return null
  return defaultCliRunner()
}

export interface CliRunOutcome {
  ok: boolean
  /** The final answer (the app's result, else what it streamed). */
  text: string
  error: string | null
  aborted: boolean
  model: string
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number } | null
}

/**
 * Starts the app once and reads its JSONL events. With `room`, the run also gets Sayabot's room
 * tools through a one-run MCP token.
 */
export async function runCliProcess(args: {
  config: CliRunnerConfig
  system: string
  prompt: string
  folder: string
  signal?: AbortSignal
  timeoutMs?: number
  room?: { agentId: string; roomId: string }
  onEvent?: (event: CliEvent, visible: string) => void
}): Promise<CliRunOutcome> {
  const { config } = args
  const name = CLI_APP_NAME[config.app]
  const model = config.model ?? config.app
  const fail = (error: string): CliRunOutcome => ({
    ok: false,
    text: "",
    error,
    aborted: false,
    model,
    usage: null,
  })
  if (!cliRunnerAllowed()) {
    return fail(`${name} on this computer is turned off here (SAYABOT_LOCAL_CLI=0).`)
  }
  const binary = await findCliBinary(config.app)
  if (!binary) return fail(`${name} isn't installed on the computer running Sayabot.`)
  mkdirSync(args.folder, { recursive: true })

  const grant = args.room
    ? await grantCliMcp({ app: config.app, ...args.room }).catch((error: unknown) => {
        console.error("[cli] room tools unavailable for this run", error)
        return null
      })
    : null
  const system = grant ? `${args.system}\n\n${ROOM_TOOLS_NOTE}` : args.system
  const command = cliCommand(config, system, args.prompt, grant?.mcp)

  let streamed = ""
  let lastMessage = ""
  let finalText: string | null = null
  let resultError: string | null = null
  let usage: CliRunOutcome["usage"] = null
  let usedModel = model
  let stderr = ""
  let pending = ""
  const visible = () => streamed || lastMessage

  try {
    const child = spawn(binary, command.args, {
      cwd: args.folder,
      env: cliEnvironment(binary, process.env, grant?.env ?? {}),
      stdio: ["pipe", "pipe", "pipe"],
    })
    const kill = () => child.kill("SIGTERM")
    args.signal?.addEventListener("abort", kill, { once: true })
    const deadline = setTimeout(kill, args.timeoutMs ?? MAX_RUNTIME_MS)

    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      pending += chunk
      let newline = pending.indexOf("\n")
      while (newline >= 0) {
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        newline = pending.indexOf("\n")
        if (!line) continue
        const event = parseCliLine(config.app, line)
        if (!event) continue
        if (event.kind === "delta") streamed += event.text
        else if (event.kind === "message") {
          lastMessage = lastMessage ? `${lastMessage}\n\n${event.text}` : event.text
        } else {
          if (event.text) finalText = event.text
          if (event.error) resultError = event.error
          if (event.usage) usage = event.usage
          if (event.model) usedModel = event.model
        }
        args.onEvent?.(event, visible())
      }
    })
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4_000)
    })
    child.stdin.on("error", () => {})
    child.stdin.end(command.stdin ?? undefined)

    const code: number | null = await new Promise((resolve) => {
      child.on("close", (c) => resolve(c))
      child.on("error", (spawnError) => {
        stderr += `\n${spawnError.message}`
        resolve(-1)
      })
    })
    clearTimeout(deadline)
    args.signal?.removeEventListener("abort", kill)

    const text = (finalText ?? visible()).trim()
    if (args.signal?.aborted) {
      return { ok: false, text: visible(), error: null, aborted: true, model: usedModel, usage }
    }
    if (code === 0 && !resultError && text) {
      return { ok: true, text, error: null, aborted: false, model: usedModel, usage }
    }
    const reason = resultError ?? cliFailureHint(config.app, stderr, code)
    const error = /log ?in|sign ?in|auth/i.test(reason)
      ? cliFailureHint(config.app, reason, code)
      : reason
    return { ok: false, text, error, aborted: false, model: usedModel, usage }
  } catch (error) {
    return { ...fail(error instanceof Error ? error.message : String(error)), text: visible() }
  } finally {
    await grant?.release()
  }
}

/** A one-shot answer (no room, no tools), for the agent Test button. */
export async function runCliOnce(
  config: CliRunnerConfig,
  system: string,
  prompt: string,
  timeoutMs = 60_000,
): Promise<{ text: string; model: string }> {
  const out = await runCliProcess({
    config,
    system,
    prompt,
    folder: cliAgentFolder("test"),
    timeoutMs,
  })
  if (!out.ok) throw new Error(out.error ?? `${CLI_APP_NAME[config.app]} gave no answer`)
  return { text: out.text, model: out.model }
}

/**
 * One room turn answered by Claude Code / Codex / Cursor on this computer, on the person's own
 * subscription, with Sayabot's room tools. Streams the app's text into the room message.
 */
export async function runCliTurn(
  args: RunLlmTurnArgs,
  config: CliRunnerConfig,
): Promise<TurnResult> {
  const db = getDb()
  const { room, agent } = args

  const conversation = await loadConversation({
    roomId: room.id,
    threadRootId: args.threadRootId,
  })
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
      engine: "cli",
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
      },
    })
    .returning()
  if (!message) throw new Error("failed to create agent message")
  await db.update(agentRuns).set({ messageId: message.id }).where(eq(agentRuns.id, run.id))

  const controller = registerRun(run.id, room.id, { agentId: agent.id, engine: "cli" })
  const startedAt = Date.now()
  let ttftMs: number | null = null
  let seq = 0
  let sentText = ""
  let lastBroadcast = 0
  let lastPersist = 0
  let latest = ""
  let chain = Promise.resolve()

  const push = (force = false) => {
    const now = Date.now()
    // Only an extension of what the room already has can stream; anything else is just saved.
    const extends_ = latest.startsWith(sentText) && latest.length > sentText.length
    if (extends_ && (force || now - lastBroadcast >= BROADCAST_MS)) {
      const delta = redactSecrets(latest.slice(sentText.length)).text
      sentText = latest
      lastBroadcast = now
      chain = chain
        .then(() =>
          broadcast(room.id, { type: "message.delta", messageId: message.id, seq: seq++, delta }),
        )
        .catch(() => {})
    }
    if (force || now - lastPersist >= PERSIST_MS) {
      lastPersist = now
      const content = redactSecrets(latest).text
      chain = chain
        .then(async () => {
          await db.update(messages).set({ content }).where(eq(messages.id, message.id))
        })
        .catch(() => {})
    }
  }

  let outcome: CliRunOutcome
  try {
    outcome = await runCliProcess({
      config,
      system,
      prompt,
      folder: cliAgentFolder(agent.handle),
      signal: controller.signal,
      room: { agentId: agent.id, roomId: room.id },
      onEvent: (event, visible) => {
        if (ttftMs === null && (event.kind === "delta" || event.kind === "message")) {
          ttftMs = Date.now() - startedAt
        }
        latest = visible
        push()
      },
    })
  } finally {
    unregisterRun(run.id)
  }
  push(true)
  await chain

  const status = outcome.aborted ? "halted" : outcome.ok ? "complete" : "error"
  const content = redactSecrets(outcome.text).text
  const safeError = outcome.error ? redactSecrets(outcome.error).text : null
  const latencyMs = Date.now() - startedAt
  await db
    .update(messages)
    .set({
      content,
      status,
      metadata: {
        ...(message.metadata as Record<string, unknown>),
        ...(safeError ? { error: safeError } : {}),
        ...(outcome.aborted ? { stopped: true } : {}),
      },
    })
    .where(eq(messages.id, message.id))
  // Subscription runs cost nothing per token here, but the tokens still show on Usage.
  await recordUsageEvent({
    orgId: room.orgId,
    roomId: room.id,
    agentId: agent.id,
    provider: config.app,
    model: outcome.model,
    tokens: outcome.usage ? { ...outcome.usage, cacheWriteTokens: 0 } : null,
    kind: "llm",
    billing: "subscription",
    ttftMs,
    latencyMs,
  })
  await db
    .update(agentRuns)
    .set({
      status: status === "halted" ? "halted" : status,
      finishReason: status === "complete" ? "stop" : status === "halted" ? "abort" : "error",
      inputTokens: outcome.usage?.inputTokens ?? null,
      outputTokens: outcome.usage?.outputTokens ?? null,
      ttftMs,
      latencyMs,
      error: safeError,
    })
    .where(eq(agentRuns.id, run.id))
  await broadcast(room.id, { type: "message.done", messageId: message.id, status }).catch(() => {})
  return {
    messageId: message.id,
    runId: run.id,
    content,
    error: safeError,
    aborted: outcome.aborted,
  }
}
