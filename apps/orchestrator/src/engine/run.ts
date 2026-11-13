import {
  createRunScrubber,
  parseCapabilities,
  redactSecrets,
} from "@sayabot/core"
import {
  agentRuns,
  messages,
  runSteps,
  runTranscripts,
  tasks,
} from "@sayabot/db"
import { buildProviderOptions, flushLangfuse, recordStepToLangfuse } from "@sayabot/llm"
import { stepCountIs, streamText, type LanguageModelUsage, type ModelMessage, type SystemModelMessage, type ToolSet } from "ai"
import { eq, sql } from "drizzle-orm"
import { consumeRunInterrupts, registerRun, unregisterRun } from "../active-runs"
import { ComputerClient } from "../computer/client"
import { getDb } from "../db"
import { recordUsageEvent } from "../usage"
import { syncMemoryMirror } from "../memory/mirror"
import { runInBackground } from "../memory/modules/background"
import { citedMemoryIds } from "../memory/modules/retrieval"
import { getMemoryService } from "../memory/service"
import { broadcast } from "../realtime"
import {
  loadCanvasContext,
  loadConversation,
  loadTaskBriefContext,
  loadTaskContext,
  type ContextMessage,
} from "../runner/context"
import {
  resolveAgentModel,
  resolveEffortLevel,
  type RunLlmTurnArgs,
  type TurnResult,
} from "../runner/llm"
import { buildTools } from "../tools"
import { redactValue, type ToolSpec } from "../tools/audited"
import { applyRollingCacheBreakpoint, buildEngineContext } from "./context"
import { CacheMetrics, estimateMessageTokens, estimateToolTokens, resolveContextBudget } from "./budget"
import { compactionBoundary, elideOldToolResults } from "./compaction"
import type { VerificationEvidence } from "./evidence"
import { summarizeForBudget } from "./summarize"
import {
  decidePrepareStep,
  needsStepSeparator,
  steeringMessage,
  systemReminder,
  type StepLike,
} from "./loop-control"
import { classifyEngineError } from "./recovery"
import { getAvailableSkills } from "./skills"
import { buildSelfVerificationPrompt, getVerifyMode, runCriticVerification } from "./verify"

/** Model-call passes per turn: the main loop plus late steering / critic revisions. */
const MAX_PASSES = 3

function numericParam(
  params: Record<string, unknown> | null | undefined,
  key: string,
  fallback?: number,
): number | undefined {
  if (!params) return fallback
  const value = params[key]
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

/**
 * Runs one Engine v2 turn:
 * - Structured prefix caching via buildEngineContext
 * - Step-by-step durable execution with run_steps & run_transcripts persistence
 * - 10-second heartbeat on agent_runs.heartbeat_at
 * - Realtime run events (run.step, run.status)
 * - Provider capability integration (Anthropic caching, providerOptions)
 */
export async function runEngineTurn(args: RunLlmTurnArgs): Promise<TurnResult> {
  const db = getDb()
  const { room, agent } = args
  const resolved = await resolveAgentModel(agent)

  const conversation: ContextMessage[] = await loadConversation({
    roomId: room.id,
    threadRootId: args.threadRootId,
  })

  const [canvasContext, taskContext, taskBrief] = await Promise.all([
    loadCanvasContext(room.id),
    loadTaskContext(room.id),
    args.taskId ? loadTaskBriefContext(args.taskId) : Promise.resolve(""),
  ])

  const maxSteps = Math.max(1, Math.min(200, Math.floor(numericParam(agent.params as Record<string, unknown>, "maxSteps", 60) ?? 60)))

  const [run] = await db
    .insert(agentRuns)
    .values({
      sessionId: args.sessionId,
      roomId: room.id,
      agentId: agent.id,
      step: args.step,
      role: args.role,
      status: "running",
      engine: "v2",
      heartbeatAt: new Date(),
      parentRunId: null,
      taskId: args.taskId ?? null,
      steps: 0,
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
        engine: "v2",
      },
    })
    .returning()
  if (!message) throw new Error("failed to create agent message")

  await db.update(agentRuns).set({ messageId: message.id }).where(eq(agentRuns.id, run.id))

  // Initialize run_transcripts row
  await db.insert(runTranscripts).values({
    runId: run.id,
    messages: [],
    compactedThroughIdx: 0,
    plan: null,
    version: 1,
  })

  const controller = registerRun(run.id, room.id, { agentId: agent.id, engine: "v2" })

  // Start 10-second heartbeat updater
  const heartbeatTimer = setInterval(() => {
    db.update(agentRuns)
      .set({ heartbeatAt: new Date() })
      .where(eq(agentRuns.id, run.id))
      .catch(() => {})
  }, 10_000)

  const scrubPlaintexts = [resolved.apiKey].filter(Boolean) as string[]
  const runScrubber = createRunScrubber(scrubPlaintexts)
  const agentCaps = parseCapabilities(agent.capabilities)
  // Ids of memories injected this turn; citations of them in the reply reinforce them.
  let recalledMemoryIds: string[] = []

  let tools: ToolSet = {}
  let toolSpecs: ToolSpec[] = []
  let activeToolNames: () => string[] | undefined = () => undefined
  let closeTools = async () => {}
  const warnings: string[] = []
  let verification = (): VerificationEvidence => ({ status: "not_required", mutationRevision: 0, checks: [] })
  const cacheMetrics = new CacheMetrics()
  let compactions = 0
  let peakEstimatedInputTokens = 0

  let buffer = ""
  let seq = 0
  let fullRaw = ""
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

  const usageTotals = {
    seen: false,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  }
  const recordUsage = (usage: LanguageModelUsage) => {
    cacheMetrics.record(usage)
    usageTotals.inputTokens += usage.inputTokens ?? 0
    usageTotals.outputTokens += usage.outputTokens ?? 0
    usageTotals.cacheReadTokens += usage.inputTokenDetails?.cacheReadTokens ?? 0
    usageTotals.cacheWriteTokens += usage.inputTokenDetails?.cacheWriteTokens ?? 0
    usageTotals.seen = true
  }
  let ttftMs: number | null = null
  let latencyMs = 0
  let error: string | null = null
  let aborted = false
  let finishReason: string | null = null
  let stepsCompleted = 0
  const startedAt = Date.now()

  const finalize = async () => {
    clearInterval(heartbeatTimer)
    unregisterRun(run.id)
    flush()
    const redacted = redactSecrets(runScrubber(fullRaw)).text
    const status = aborted ? "halted" : error ? "error" : "complete"
    const safeError = error ? redactSecrets(runScrubber(error)).text : null
    const safeWarnings = warnings.map((w) => redactSecrets(runScrubber(w)).text)
    const metadata = {
      ...(message.metadata as Record<string, unknown>),
      ...(safeError ? { error: safeError } : {}),
      ...(aborted ? { stopped: true } : {}),
      ...(safeWarnings.length ? { warnings: safeWarnings } : {}),
      harness: redactValue({ cache: cacheMetrics.snapshot(), verification: verification(), compactions, peakEstimatedInputTokens }, runScrubber),
    }

    await db
      .update(messages)
      .set({ content: redacted, status, metadata })
      .where(eq(messages.id, message.id))

    const cost = usageTotals.seen
      ? await recordUsageEvent({
          orgId: room.orgId,
          roomId: room.id,
          agentId: agent.id,
          provider: resolved.provider,
          model: resolved.modelName,
          tokens: {
            inputTokens: usageTotals.inputTokens,
            outputTokens: usageTotals.outputTokens,
            cachedInputTokens: usageTotals.cacheReadTokens,
            cacheWriteTokens: usageTotals.cacheWriteTokens,
          },
          kind: "llm",
          ttftMs,
          latencyMs,
        })
      : 0

    await db
      .update(agentRuns)
      .set({
        status: aborted ? "halted" : error ? "error" : "complete",
        finishReason: aborted ? "abort" : error ? "error" : (finishReason ?? "stop"),
        steps: stepsCompleted,
        engine: "v2",
        heartbeatAt: new Date(),
        inputTokens: usageTotals.seen ? usageTotals.inputTokens : null,
        outputTokens: usageTotals.seen ? usageTotals.outputTokens : null,
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
    if (!aborted && !error && redacted) {
      void import("../connectors/inbound")
        .then(({ deliverInboundReply }) => deliverInboundReply(args.trigger.metadata, redacted))
        .catch((error) => console.warn("[inbound] reply not delivered", error))
    }

    // Post-run memory pass. Runs in the background so the room lock is released and the
    // turn returns without waiting on another model call. Only redacted text leaves here.
    if (agentCaps.memory && redacted && !aborted && !error) {
      try {
        const memoryService = getMemoryService()
        const transcriptText = buildExtractionTranscript({
          triggerSender: args.trigger.senderType,
          triggerText: redactSecrets(runScrubber(args.trigger.content ?? "")).text,
          agentName: agent.displayName,
          reply: redacted,
        })
        runInBackground("memory.extract", () =>
          memoryService.extractMemoriesFromTranscript({
            orgId: room.orgId,
            roomId: room.id,
            agentId: agent.id,
            transcriptText,
            agent,
          }),
        )
        const cited = citedMemoryIds(redacted, recalledMemoryIds)
        if (cited.length > 0) {
          runInBackground("memory.reinforce", () => memoryService.reinforce(room.orgId, cited))
        }
      } catch {}
    }

    await flushLangfuse().catch(() => {})

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
      toolSpecs = built.specs
      activeToolNames = built.activeToolNames
      verification = built.verification
      closeTools = built.close
      warnings.push(...built.warnings)
    } catch (toolError) {
      warnings.push(
        `Tool init error: ${toolError instanceof Error ? toolError.message : String(toolError)}`,
      )
    }

    // Pre-turn memory: pinned digest (cached prefix), relevant recall and owner facts
    // (volatile tail), active commitments. Skipped entirely when memory is disabled, and
    // best-effort otherwise: a memory failure never fails the turn.
    let pinnedMemories: Array<{ id: string; title: string; body: string }> = []
    let recalledMemories: Array<{ id: string; title: string; body: string; scope?: string }> = []
    let activeOpenLoopsSummary = ""
    let ownerFactsSummary = ""
    if (agentCaps.memory) {
      try {
        const memoryService = getMemoryService()
        const recallQuery = [args.trigger.content, taskBrief].filter(Boolean).join(" ").slice(0, 1000)
        // Each source fails on its own (sync throws included) without dropping the others.
        const settle = <T,>(load: () => Promise<T>, fallback: T): Promise<T> =>
          Promise.resolve().then(load).catch(() => fallback)
        const [pinned, recalled, loops, facts] = await Promise.all([
          settle(() => memoryService.getPinnedDigest({ orgId: room.orgId, agentId: agent.id, roomId: room.id }), []),
          settle(
            () =>
              memoryService.recall({
                orgId: room.orgId,
                query: recallQuery,
                agentId: agent.id,
                roomId: room.id,
                limit: 8,
                excludePinned: true,
                minRelevance: 0.2,
                reinforce: false,
              }),
            [],
          ),
          settle(
            () => memoryService.getActiveLoops({ orgId: room.orgId, agentId: agent.id, roomId: room.id, limit: 5 }),
            [],
          ),
          // A small fact set is shown whole so the agent never re-asks; a large one by relevance.
          settle(
            () =>
              memoryService.relevantOwnerFacts({
                orgId: room.orgId,
                roomId: room.id,
                query: recallQuery,
                limit: 8,
                showAllUpTo: 12,
              }),
            { facts: [], total: 0 },
          ),
        ])
        pinnedMemories = pinned
        recalledMemories = recalled.map((m) => ({
          id: m.id,
          title: m.title,
          body: m.body,
          scope: m.scope === "agent" ? "private" : m.scope,
        }))
        recalledMemoryIds = recalled.map((m) => m.id)
        if (loops.length > 0) {
          activeOpenLoopsSummary =
            "Active Commitments & Open Loops:\n" +
            loops.map((l) => `- [${l.status.toUpperCase()}] (id=${l.id}) ${l.description}`).join("\n")
        }
        if (facts.facts.length > 0) {
          ownerFactsSummary =
            "Known owner facts (already answered; do not ask again):\n" +
            facts.facts.map((f) => `- ${f.label}: ${f.value}`).join("\n") +
            (facts.total > facts.facts.length
              ? `\n(${facts.total - facts.facts.length} more; use recall to search them.)`
              : "")
        }

        // Mirror room-independent memory into the agent's computer, off the critical path.
        if (agentCaps.computer) {
          runInBackground("memory.mirror", () =>
            syncMemoryMirror({ orgId: room.orgId, agentId: agent.id, client: new ComputerClient() }),
          )
        }
      } catch (memoryError) {
        console.warn("[memory] pre-turn context failed:", redactSecrets(runScrubber(String(memoryError))).text)
      }
    }

    // Load available skills for the org
    let skillsIndex: Array<{ slug: string; description: string }> = []
    try {
      skillsIndex = await getAvailableSkills(room.orgId)
    } catch {}

    const params = (agent.params ?? {}) as Record<string, unknown>
    const verifyMode = getVerifyMode(params)
    const modelBudget = resolveContextBudget(resolved.provider, params)

    // Build structured context
    const initialContext = buildEngineContext({
      agent,
      room,
      provider: resolved.provider,
      role: args.role,
      skillsIndex,
      pinnedMemories,
      roomHistory: conversation,
      volatileTail: {
        now: new Date(),
        recalledMemories,
        activeTaskBrief: taskBrief || undefined,
        contextBlocks: [
          canvasContext ? `Room Canvases:\n${canvasContext}` : "",
          !taskBrief && taskContext ? `Open Tasks in Room:\n${taskContext}` : "",
          ownerFactsSummary,
          activeOpenLoopsSummary,
        ],
        currentTrigger: args.trigger.content,
        // Only where there is something to verify: a task, or a workspace with checks.
        closingInstructions:
          verifyMode !== "off" && (taskBrief || "verify_workspace" in tools)
            ? buildSelfVerificationPrompt()
            : undefined,
      },
    })

    const instructions = initialContext.messages.filter((message): message is SystemModelMessage => message.role === "system")
    const initialMessages = initialContext.messages.filter((message) => message.role !== "system")
    const instructionTokens = estimateMessageTokens(instructions)

    const configuredEffort = params.effort as string | undefined
    const effort = resolveEffortLevel({
      configuredEffort,
      hasTask: Boolean(args.taskId),
    })
    const providerOptions = buildProviderOptions({
      provider: resolved.provider as any,
      effort,
    })
    const thinking = providerOptions.anthropic?.thinking as { budgetTokens?: number } | undefined
    if (thinking?.budgetTokens) thinking.budgetTokens = Math.min(thinking.budgetTokens, modelBudget.outputTokens - 1024)

    send({ type: "run.status", runId: run.id, status: "thinking" })

    // Messages produced during this run (model responses, steering, reviewer
    // feedback). Persisted to run_transcripts so a run can be inspected/resumed.
    const runMessages: ModelMessage[] = []
    const sentReminders = new Set<string>()
    const planToolAvailable = "update_plan" in tools
    let stepStartTime = Date.now()
    let criticCycle = 0
    let lastBroadcast = 0
    let lastPersist = 0

    const persistTranscript = async (messagesToStore: ModelMessage[]) => {
      await db
        .update(runTranscripts)
        .set({
          messages: redactValue(messagesToStore, runScrubber) as unknown[],
          updatedAt: new Date(),
          version: sql`version + 1`,
        })
        .where(eq(runTranscripts.runId, run.id))
    }

    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const passBudget = maxSteps - stepsCompleted
      if (passBudget <= 0 || controller.signal.aborted) break
      const passStartSteps = stepsCompleted
      const passStartRunMessages = runMessages.length
      const errorBox: { error: unknown } = { error: null }
      const passInput: ModelMessage[] = [...initialMessages, ...runMessages]
      // The last prompt prepareStep produced (includes steering, reminders and
      // compaction, plus every earlier step's output).
      let lastPrepared: ModelMessage[] = passInput
      // Per-step outputs of this pass, for incremental transcript persistence.
      const passStepMessages: ModelMessage[] = []

      if (pass > 0 && fullRaw && !/\s$/.test(fullRaw)) {
        buffer += "\n\n"
        fullRaw += "\n\n"
      }
      let passText = ""

      const activeTools = activeToolNames()
      const streamResult = streamText({
        model: resolved.model,
        instructions,
        messages: passInput,
        tools,
        ...(activeTools ? { activeTools } : {}),
        abortSignal: controller.signal,
        maxRetries: 4,
        stopWhen: stepCountIs(passBudget),
        ...(Object.keys(providerOptions).length > 0 ? { providerOptions: providerOptions as any } : {}),
        ...(numericParam(params, "temperature") !== undefined
          ? { temperature: numericParam(params, "temperature") }
          : {}),
        ...(numericParam(params, "topP") !== undefined ? { topP: numericParam(params, "topP") } : {}),
        maxOutputTokens: modelBudget.outputTokens,
        onError: ({ error: streamErr }) => {
          errorBox.error = streamErr
        },
        prepareStep: async ({ messages: stepMessages, steps, stepNumber }) => {
          const nextActive = activeToolNames()
          const activeSpecs = nextActive ? toolSpecs.filter((spec) => nextActive.includes(spec.name)) : toolSpecs
          const budget = resolveContextBudget(resolved.provider, params, estimateToolTokens(activeSpecs))
          const workingMessages = stepMessages
          const messageBudget = budget.messageTokens - instructionTokens
          const decision = decidePrepareStep({
            messages: workingMessages,
            steps: steps as unknown as StepLike[],
            stepNumber: passStartSteps + stepNumber,
            maxSteps,
            interrupts: consumeRunInterrupts(run.id),
            contextBudgetTokens: messageBudget,
            planToolAvailable,
            sentReminders,
          })
          if (decision.steered) {
            send({
              type: "run.step",
              runId: run.id,
              step: stepsCompleted,
              kind: "model",
              label: "Steered by a new message from the room",
            })
          }
          if (decision.elidedCount > 0) {
            send({
              type: "run.step",
              runId: run.id,
              step: stepsCompleted,
              kind: "model",
              label: `Compacted context (${decision.elidedCount} old tool results elided)`,
            })
          }
          const compacted = await summarizeForBudget({
            messages: decision.messages ?? workingMessages,
            protectedPrefixCount: initialMessages.length,
            messageBudget,
            summarizerInputBudget: modelBudget.inputTokens,
            outputTokens: modelBudget.outputTokens,
            model: resolved.model,
            signal: controller.signal,
            onUsage: recordUsage,
          })
          if (compacted.compacted > 0) {
            compactions++
            send({ type: "run.step", runId: run.id, step: stepsCompleted, kind: "model", label: `Summarized ${compacted.compacted} earlier messages; preserved current task and recent tool pairs` })
          }
          let finalMessages = compacted.messages
          let estimatedTokens = estimateMessageTokens(finalMessages)
          peakEstimatedInputTokens = Math.max(peakEstimatedInputTokens, estimatedTokens + budget.toolTokens + instructionTokens)
          if (estimatedTokens > messageBudget) {
            const aggressive = elideOldToolResults(finalMessages, 2)
            if (aggressive.elidedCount > 0) {
              finalMessages = aggressive.messages
              estimatedTokens = estimateMessageTokens(finalMessages)
              compactions++
              send({ type: "run.step", runId: run.id, step: stepsCompleted, kind: "model", label: `Aggressively elided ${aggressive.elidedCount} older tool results to preserve context budget` })
            }
          }
          if (estimatedTokens > messageBudget) {
            const boundary = compactionBoundary(finalMessages, initialMessages.length, 2)
            if (boundary > initialMessages.length) {
              finalMessages = [...finalMessages.slice(0, initialMessages.length), ...finalMessages.slice(boundary)]
              estimatedTokens = estimateMessageTokens(finalMessages)
              compactions++
            }
          }
          if (estimatedTokens > messageBudget) throw new Error("Context budget exhausted without safely discardable history. Narrow the task or configure this model's contextWindowTokens.")
          const prepared = applyRollingCacheBreakpoint(finalMessages, resolved.provider)
          lastPrepared = prepared
          return {
            messages: prepared,
            ...(nextActive ? { activeTools: nextActive } : {}),
          }
        },
        onStepEnd: async (step) => {
          stepsCompleted += 1
          recordUsage(step.usage)
          const stepIdx = stepsCompleted
          const isToolStep = Boolean(step.toolCalls && step.toolCalls.length > 0)
          const hasPlan = step.toolCalls?.some((tc: { toolName: string }) => tc.toolName === "update_plan")
          const hasSubagent = step.toolCalls?.some((tc: { toolName: string }) => tc.toolName === "spawn_subagent")
          const hasRecall = step.toolCalls?.some((tc: { toolName: string }) => tc.toolName === "recall" || tc.toolName === "memory")
          const kind = hasSubagent ? "subagent" : hasPlan ? "plan" : hasRecall ? "recall" : isToolStep ? "tool" : "model"
          const primaryTool = isToolStep ? step.toolCalls[0] : null
          const inputRef = primaryTool?.toolName ?? null

          try {
            await db.insert(runSteps).values({
              runId: run.id,
              idx: stepIdx,
              kind,
              inputRef,
              output: redactValue(
                {
                  text: step.text,
                  toolCalls: step.toolCalls,
                  toolResults: step.toolResults,
                  finishReason: step.finishReason,
                },
                runScrubber,
              ) as Record<string, unknown>,
              usage: step.usage,
              startedAt: new Date(stepStartTime),
              finishedAt: new Date(),
            })

            void recordStepToLangfuse({
              traceId: run.id,
              stepIdx,
              kind,
              name: primaryTool?.toolName ?? (kind === "model" ? resolved.modelName : kind),
              input: primaryTool && "args" in primaryTool ? (primaryTool as { args: unknown }).args : undefined,
              output: step.text || (isToolStep ? step.toolResults : undefined),
              usage: step.usage
                ? {
                    inputTokens: step.usage.inputTokens,
                    outputTokens: step.usage.outputTokens,
                    totalTokens: (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0),
                  }
                : undefined,
              startedAt: new Date(stepStartTime),
              finishedAt: new Date(),
            })

            passStepMessages.push(...(step.response.messages as ModelMessage[]))
            await persistTranscript([
              ...runMessages.slice(0, passStartRunMessages),
              ...passStepMessages,
            ])

            await db
              .update(agentRuns)
              .set({ steps: stepIdx, heartbeatAt: new Date() })
              .where(eq(agentRuns.id, run.id))
          } catch {}

          send({
            type: "run.step",
            runId: run.id,
            step: stepIdx,
            kind: isToolStep ? "tool" : "model",
            label: isToolStep
              ? `Running ${step.toolCalls.map((t) => t.toolName).join(", ")}`
              : "Generating response",
          })
          send({ type: "run.status", runId: run.id, status: isToolStep ? "tool" : "thinking" })

          stepStartTime = Date.now()
        },
      })

      let newStep = false
      for await (const part of streamResult.fullStream) {
        if (part.type === "start-step") {
          newStep = true
          continue
        }
        if (part.type !== "text-delta" || !part.text) continue
        const delta = part.text
        if (ttftMs === null) ttftMs = Date.now() - startedAt
        if (newStep) {
          newStep = false
          // Separate prose from consecutive steps ("Let me check." + "Found it.").
          if (needsStepSeparator(passText, delta)) {
            buffer += "\n\n"
            fullRaw += "\n\n"
            passText += "\n\n"
          }
        }
        buffer += delta
        fullRaw += delta
        passText += delta
        const now = Date.now()
        if (now - lastBroadcast >= 40) {
          lastBroadcast = now
          flush()
        }
        if (now - lastPersist >= 1_000) {
          lastPersist = now
          db.update(messages)
            .set({ content: redactSecrets(runScrubber(fullRaw)).text })
            .where(eq(messages.id, message.id))
            .catch(() => {})
        }
      }
      flush()

      if (errorBox.error) throw errorBox.error

      const [passReason, response] = await Promise.all([
        streamResult.finishReason,
        streamResult.response,
      ])
      finishReason = passReason
      // In AI SDK 7, response.messages holds only the final step's output.
      const finalStepOutput = response.messages as ModelMessage[]
      runMessages.splice(
        0,
        runMessages.length,
        ...lastPrepared.slice(initialMessages.length),
        ...finalStepOutput,
      )

      if (controller.signal.aborted) break

      // A human message that arrived during the final step would otherwise be
      // dropped: continue the run so the agent addresses it.
      const late = consumeRunInterrupts(run.id)
      if (late.length > 0) {
        runMessages.push(steeringMessage(late))
        send({
          type: "run.step",
          runId: run.id,
          step: stepsCompleted,
          kind: "model",
          label: "Steered by a new message from the room",
        })
        continue
      }

      const evidence = verification()
      if (verifyMode !== "off" && (evidence.status === "pending" || evidence.status === "failed")) {
        if (pass + 1 >= MAX_PASSES || stepsCompleted >= maxSteps || sentReminders.has("verify")) {
          // Surface it, but don't fail the turn: the agent may honestly report
          // that checks are unavailable or that failures pre-date its change.
          warnings.push(`Work remains unverified: ${evidence.reason}`)
          break
        }
        sentReminders.add("verify")
        runMessages.push(systemReminder(`${evidence.reason} Inspect the project's checks, call verify_workspace, fix any failures and report only what the execution evidence supports. If checks are unavailable, say so explicitly.`))
        continue
      }

      if (verifyMode === "critic" && passText.trim()) {
        send({ type: "run.status", runId: run.id, status: "thinking" })
        send({
          type: "run.step",
          runId: run.id,
          step: stepsCompleted + 1,
          kind: "tool",
          label: "Running critic verification against task requirements",
        })
        const review = await runCriticVerification({
          agent,
          orgId: room.orgId,
          roomId: room.id,
          taskBrief: taskBrief || args.trigger.content,
          proposedOutput: `${fullRaw}\n\nExecution evidence: ${JSON.stringify(verification())}`, 
          signal: controller.signal,
          scrub: runScrubber,
          availableToolSpecs: toolSpecs,
          cycle: criticCycle++,
        })

        try {
          stepsCompleted += 1
          await db.insert(runSteps).values({
            runId: run.id,
            idx: stepsCompleted,
            kind: "verify",
            inputRef: "critic_verification",
            output: redactValue(
              {
                pass: review.pass,
                feedback: review.feedback,
                reasons: review.reasons,
                cycle: criticCycle - 1,
              },
              runScrubber,
            ) as Record<string, unknown>,
            usage: null,
            startedAt: new Date(),
            finishedAt: new Date(),
          })

          void recordStepToLangfuse({
            traceId: run.id,
            stepIdx: stepsCompleted,
            kind: "verify",
            name: "critic_verification",
            output: { pass: review.pass, feedback: review.feedback, reasons: review.reasons },
            startedAt: new Date(),
            finishedAt: new Date(),
          })
        } catch {}
        if (!review.pass) {
          const findings = review.feedback || review.reasons.map((r) => `- ${r}`).join("\n") || "The critic did not verify the work."
          if (pass + 1 >= MAX_PASSES || stepsCompleted >= maxSteps || criticCycle >= 2) {
            warnings.push(`Critic verification unresolved: ${findings}`)
            break
          }
          warnings.push(`Critic feedback: ${findings}`)
          runMessages.push(
            systemReminder(
              `An independent reviewer checked your work against the task requirements and found problems:\n\n${findings}\n\n` +
                "Fix these now with your tools, then write a short final reply stating what you changed.",
            ),
          )
          send({
            type: "run.step",
            runId: run.id,
            step: stepsCompleted,
            kind: "model",
            label: "Revising after critic feedback",
          })
          continue
        }
      }
      break
    }

    aborted = controller.signal.aborted
    if (!aborted && finishReason === "tool-calls" && stepsCompleted >= maxSteps) {
      error ??= `Step limit (${maxSteps}) reached before a final response; work is incomplete.`
    }
    if (!aborted && consumeRunInterrupts(run.id).length > 0) {
      error ??= "A new instruction arrived after the execution budget was exhausted. A follow-up turn is required."
    }
    if (
      !aborted &&
      verifyMode !== "off" &&
      ["pending", "failed"].includes(verification().status) &&
      !warnings.some((w) => w.startsWith("Work remains unverified"))
    ) {
      warnings.push(`Work remains unverified: ${verification().reason}`)
    }
    try {
      await persistTranscript(runMessages)
    } catch {}
    latencyMs = Date.now() - startedAt
  } catch (err) {
    if (controller.signal.aborted || (err instanceof Error && err.name === "AbortError")) {
      aborted = true
    } else {
      const raw = err instanceof Error ? err.message : String(err)
      const classified = classifyEngineError(err)
      error = classified.category === "unknown" ? raw : `${classified.message} (${raw})`
    }
    latencyMs = Date.now() - startedAt
  } finally {
    try {
      await closeTools()
    } catch {}
  }

  const finalContent = await finalize()
  return {
    runId: run.id,
    messageId: message.id,
    content: finalContent,
    error,
    aborted,
  }
}

/** One turn as the memory extractor sees it: who asked what, and what the agent replied. */
export function buildExtractionTranscript(args: {
  triggerSender: string
  triggerText: string
  agentName: string
  reply: string
}): string {
  const who =
    args.triggerSender === "human" ? "Human" : args.triggerSender === "agent" ? "Another agent" : "System"
  const parts: string[] = []
  if (args.triggerText.trim()) parts.push(`${who}: ${args.triggerText.trim().slice(0, 2500)}`)
  parts.push(`${args.agentName} (you): ${args.reply.trim().slice(0, 3500)}`)
  return parts.join("\n\n")
}
