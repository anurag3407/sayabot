import { createRunScrubber, redactSecrets, type TurnRole } from "@sayabot/core"
import { agentRuns, messages, providerKeys, tasks } from "@sayabot/db"
import { recordUsageEvent, tokensFrom } from "../usage"
import { createLanguageModel, devModelConfig, providerKeyToApiKey } from "@sayabot/llm"
import type { LanguageModel, LanguageModelUsage, ToolSet } from "ai"
import { eq, sql } from "drizzle-orm"
import { registerRun, unregisterRun } from "../active-runs"
import { getDb } from "../db"
import { getEnv } from "../env"
import { broadcast } from "../realtime"
import { buildTools } from "../tools"
import type { AgentRow, MessageRow, RoomRow } from "./context"
import {
  buildSystemPrompt,
  buildUserPrompt,
  loadCanvasContext,
  loadConversation,
  loadTaskBriefContext,
  loadTaskContext,
  renderTranscript,
} from "./context"
import { streamAgentText } from "./stream-agent"

export interface RunLlmTurnArgs {
  room: RoomRow
  agent: AgentRow
  sessionId: string
  threadRootId: string | null
  trigger: MessageRow
  role: TurnRole
  step: number
  taskId?: string | null
}

export interface TurnResult {
  messageId: string
  runId: string
  content: string
  error: string | null
  aborted: boolean
}

export interface ResolvedModel {
  model: LanguageModel
  provider: string
  modelName: string
  apiKey?: string
}

export function getCheapModelName(provider: string, customCheap?: string): string {
  if (customCheap) return customCheap
  switch (provider) {
    case "anthropic":
      return "claude-haiku-5-5"
    case "openai":
      return "gpt-4o-mini"
    case "google":
      return "gemini-2.0-flash"
    case "deepseek":
      return "deepseek-chat"
    case "openrouter":
      return "openai/gpt-4o-mini"
    case "groq":
      return "openai/gpt-oss-20b"
    default:
      return "gpt-4o-mini"
  }
}

export async function resolveAgentCheapModel(agent: AgentRow): Promise<ResolvedModel> {
  const customCheap = (agent.params as Record<string, unknown> | null)?.cheapModel as string | undefined
  const db = getDb()
  if (agent.providerKeyId) {
    const [key] = await db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.id, agent.providerKeyId))
      .limit(1)
    if (key) {
      const apiKey = providerKeyToApiKey(key, getEnv().MESH_KEK)
      const cheapModelName = getCheapModelName(key.provider, customCheap)
      return {
        model: createLanguageModel({
          provider: key.provider,
          apiKey,
          model: cheapModelName,
          baseUrl: key.baseUrl,
        }),
        provider: key.provider,
        modelName: cheapModelName,
        apiKey,
      }
    }
  }
  const dev = devModelConfig()
  if (dev) {
    const cheapModelName = getCheapModelName(dev.provider, customCheap)
    return {
      model: createLanguageModel({ ...dev, model: cheapModelName }),
      provider: dev.provider,
      modelName: cheapModelName,
    }
  }
  return resolveAgentModel(agent)
}

export function resolveEffortLevel(params: {
  configuredEffort?: string
  hasTask: boolean
  isSubagent?: boolean
}): "low" | "medium" | "high" | "max" | undefined {
  const eff = params.configuredEffort ?? "auto"
  if (eff === "low" || eff === "medium" || eff === "high" || eff === "max") {
    return eff
  }
  if (eff === "auto") {
    if (params.isSubagent) return "low"
    if (params.hasTask) return "high"
    return "low"
  }
  return undefined
}

export async function resolveAgentModel(agent: AgentRow): Promise<ResolvedModel> {
  const db = getDb()
  if (agent.providerKeyId) {
    const [key] = await db
      .select()
      .from(providerKeys)
      .where(eq(providerKeys.id, agent.providerKeyId))
      .limit(1)
    if (!key) throw new Error(`Provider key for @${agent.handle} was deleted`)
    if (!agent.model) throw new Error(`@${agent.handle} has no model configured`)
    const apiKey = providerKeyToApiKey(key, getEnv().MESH_KEK)
    return {
      model: createLanguageModel({
        provider: key.provider,
        apiKey,
        model: agent.model,
        baseUrl: key.baseUrl,
      }),
      provider: key.provider,
      modelName: agent.model,
      apiKey,
    }
  }
  const dev = devModelConfig()
  if (!dev) {
    throw new Error(
      `@${agent.handle} has no API key yet. A workspace admin can add one in Settings, then choose it on the Agents page.`,
    )
  }
  const modelName = agent.model ?? dev.model
  return {
    model: createLanguageModel({ ...dev, model: modelName }),
    provider: dev.provider,
    modelName,
  }
}

function numericParam(params: Record<string, unknown>, key: string, fallback?: number) {
  const value = params[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/**
 * Runs one LLM turn end to end: context, tools, streamed deltas, partial
 * persistence, final redaction, usage accounting and run status.
 */
export async function runLlmTurn(args: RunLlmTurnArgs): Promise<TurnResult> {
  const db = getDb()
  const { room, agent } = args
  const resolved = await resolveAgentModel(agent)

  const conversation = await loadConversation({
    roomId: room.id,
    threadRootId: args.threadRootId,
  })
  const transcript = renderTranscript(conversation)
  const [canvasContext, taskContext, taskBrief] = await Promise.all([
    loadCanvasContext(room.id),
    loadTaskContext(room.id),
    args.taskId ? loadTaskBriefContext(args.taskId) : Promise.resolve(""),
  ])
  const system = buildSystemPrompt({ room, agent, role: args.role })
  const prompt = buildUserPrompt({
    transcript,
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
      metadata: { agentName: agent.displayName, agentHandle: agent.handle, role: args.role },
    })
    .returning()
  if (!message) throw new Error("failed to create agent message")
  await db.update(agentRuns).set({ messageId: message.id }).where(eq(agentRuns.id, run.id))

  const controller = registerRun(run.id, room.id)

  const scrubPlaintexts = [resolved.apiKey].filter(Boolean) as string[]
  const runScrubber = createRunScrubber(scrubPlaintexts)

  let tools: ToolSet = {}
  let closeTools = async () => {}
  const warnings: string[] = []

  let buffer = ""
  let seq = 0
  let fullRaw = ""
  let lastBroadcast = 0
  let lastPersist = 0
  let chain = Promise.resolve()
  const send = (event: Parameters<typeof broadcast>[1]) => {
    chain = chain.then(() => broadcast(room.id, event)).catch(() => {})
  }
  const flush = () => {
    if (!buffer) return
    const { text } = redactSecrets(runScrubber(buffer))
    buffer = ""
    if (text) send({ type: "message.delta", messageId: message.id, seq: seq++, delta: text })
  }

  let usage: LanguageModelUsage | null = null
  let ttftMs: number | null = null
  let latencyMs = 0
  let error: string | null = null
  let aborted = false
  let finishReason: string | null = null
  let steps = 1
  const startedAt = Date.now()

  const finalize = async () => {
    flush()
    const redacted = redactSecrets(runScrubber(fullRaw)).text
    const status = aborted ? "halted" : error ? "error" : "complete"
    const safeError = error ? redactSecrets(runScrubber(error)).text : null
    const safeWarnings = warnings.map((warning) => redactSecrets(runScrubber(warning)).text)
    const metadata = {
      ...(message.metadata as Record<string, unknown>),
      ...(safeError ? { error: safeError } : {}),
      ...(aborted ? { stopped: true } : {}),
      ...(safeWarnings.length ? { warnings: safeWarnings } : {}),
    }
    await db
      .update(messages)
      .set({ content: redacted, status, metadata })
      .where(eq(messages.id, message.id))

    const cost = await recordUsageEvent({
      orgId: room.orgId,
      roomId: room.id,
      agentId: agent.id,
      provider: resolved.provider,
      model: resolved.modelName,
      tokens: tokensFrom(usage),
      kind: "llm",
      ttftMs,
      latencyMs,
    })

    await db
      .update(agentRuns)
      .set({
        status: aborted ? "halted" : error ? "error" : "complete",
        finishReason: aborted ? "abort" : error ? "error" : (finishReason ?? "stop"),
        steps,
        engine: typeof (agent.params as any)?.engine === "string" ? (agent.params as any).engine : "v1",
        inputTokens: usage?.inputTokens ?? null,
        outputTokens: usage?.outputTokens ?? null,
        costUsd: cost,
        ttftMs,
        latencyMs,
        error: safeError,
      })
      .where(eq(agentRuns.id, run.id))

    if (args.taskId) {
      await db
        .update(tasks)
        .set({
          turnsUsed: sql`turns_used + 1`,
          costUsd: sql`cost_usd + ${cost}`,
        })
        .where(eq(tasks.id, args.taskId))
    }

    send({ type: "message.done", messageId: message.id, status })
    await chain
    return redacted
  }

  try {
    try {
      const built = await buildTools({
        roomId: room.id,
        orgId: room.orgId,
        agent,
        runtime: {
          orgId: room.orgId,
          roomId: room.id,
          agentId: agent.id,
          runId: run.id,
          messageId: message.id,
          scrub: runScrubber,
        },
      })
      tools = built.tools
      closeTools = built.close
      warnings.push(...built.warnings)
    } catch (toolError) {
      warnings.push(
        `Tools unavailable for this turn: ${toolError instanceof Error ? toolError.message : String(toolError)}`,
      )
    }

    const params = agent.params ?? {}
    const defaultMaxSteps = args.taskId ? 30 : 20
    const result = await streamAgentText({
      model: resolved.model,
      system,
      prompt,
      tools,
      abortSignal: controller.signal,
      maxSteps: numericParam(params, "maxSteps", defaultMaxSteps),
      temperature: numericParam(params, "temperature"),
      topP: numericParam(params, "topP"),
      maxOutputTokens: numericParam(params, "maxOutputTokens"),
      onDelta: async (delta) => {
        fullRaw += delta
        buffer += delta
        const now = Date.now()
        if (now - lastBroadcast >= 40) {
          lastBroadcast = now
          flush()
        }
        if (now - lastPersist >= 1_000) {
          lastPersist = now
          await getDb()
            .update(messages)
            .set({ content: redactSecrets(runScrubber(fullRaw)).text })
            .where(eq(messages.id, message.id))
            .catch((persistError) => console.error("[runner] partial persist failed", persistError))
        }
      },
    })
    usage = result.usage
    ttftMs = result.ttftMs
    latencyMs = result.latencyMs
    aborted = result.aborted
    error = result.error
    finishReason = result.finishReason
    steps = result.steps
  } catch (streamError) {
    aborted = controller.signal.aborted
    error = aborted
      ? null
      : streamError instanceof Error
        ? streamError.message
        : String(streamError)
    latencyMs = Date.now() - startedAt
  } finally {
    unregisterRun(run.id)
    await closeTools().catch(() => {})
  }

  const content = await finalize()
  return {
    messageId: message.id,
    runId: run.id,
    content,
    error: error ? redactSecrets(error).text : null,
    aborted,
  }
}
