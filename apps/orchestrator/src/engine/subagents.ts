import { resolve } from "node:path"
import { createRunScrubber } from "@sayabot/core"
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from "ai"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { agentRuns, runSteps, runTranscripts } from "@sayabot/db"
import { getDb } from "../db"
import { broadcast } from "../realtime"
import type { AgentRow } from "../runner/context"
import { resolveAgentCheapModel, resolveAgentModel } from "../runner/llm"
import { redactValue, toAuditedTools, type ToolSpec } from "../tools/audited"
import { workspaceScopeSchema } from "../tools/builtins/workspace"

export const MAX_CONCURRENT_SUBAGENTS = 4
export const MAX_TOTAL_SUBAGENTS = 12
export const SUBAGENT_HEARTBEAT_MS = 10_000

export const spawnSubagentSchema = z.object({
  task: z.string().min(1).max(30_000).describe("Clear, self-contained task description"),
  role: z.enum(["researcher", "planner", "worker", "critic"]).default("researcher"),
  tools: z.enum(["read_only", "same"]).default("read_only")
    .describe("Only a worker may request 'same'; all other roles are always read-only"),
  model: z.enum(["cheap", "same"]).default("cheap"),
  maxSteps: z.number().int().min(1).max(30).default(10),
  workspace: workspaceScopeSchema.optional()
    .describe("Explicit workspace_fork scope for a worker. Shared tools are confined to this path."),
  runInBackground: z.boolean().default(false)
    .describe("When true, runs the subagent in the background without blocking the parent turn. Check progress with subagent_status."),
}).strict().refine((input) => !input.workspace || input.role === "worker", {
  message: "Only workers may be assigned a worktree scope",
  path: ["workspace"],
})

export type SpawnSubagentInput = z.infer<typeof spawnSubagentSchema>

export const READ_ONLY_TOOL_NAMES = new Set([
  "fs_read", "fs_glob", "fs_grep", "git_status", "git_diff", "web_search",
  "canvas_read", "recall", "code_outline", "code_definition", "code_references",
  "code_diagnostics", "code_rename_preview", "workspace_inspect",
])

const SUBAGENT_EXCLUDED_TOOLS = new Set([
  "spawn_subagent", "update_plan", "find_tools", "propose_skill", "load_skill",
  "install_skill", "approve_skill", "skill_install", "skill_approve", "workspace_fork",
])

const ROLE_PROMPTS: Record<SpawnSubagentInput["role"], string> = {
  researcher: "Research the assigned question only. Read relevant evidence, distinguish facts from inference, and return findings with sources. Do not implement changes or perform unrelated actions.",
  planner: "Plan the assigned task only. Inspect relevant evidence, then return ordered implementation steps, dependencies, risks and verification criteria. Do not implement the plan or modify anything.",
  worker: "Carry out only the assigned implementation or investigation. Preserve unrelated work, verify your changes when permitted, and report changed paths, checks performed and remaining limitations. Do not merge, reset, deploy or expand the task scope.",
  critic: "Review the assigned work only. Identify concrete defects, regressions, missing tests and unsupported claims with file/line evidence and severity. Do not fix findings, install anything, approve anything or perform unrelated side effects. If no defects are supported by evidence, say so.",
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: () => void = () => {}
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason)
        if (signal.aborted) onAbort()
        else signal.addEventListener("abort", onAbort, { once: true })
      }),
    ])
  } finally {
    signal.removeEventListener("abort", onAbort)
  }
}

export interface SpawnSubagentToolArgs {
  parentRunId: string
  roomId: string
  orgId: string
  agent: AgentRow
  availableToolSpecs?: ToolSpec[]
  /** Resolved at call time, so it can see tools registered after this one. */
  getAvailableToolSpecs?: () => ToolSpec[]
  scrub?: (s: string) => string
}

export function spawnSubagentTool(args: SpawnSubagentToolArgs): ToolSpec {
  return {
    name: "spawn_subagent",
    description: "Run and await a focused researcher, planner, worker or critic subtask. Returns the child run ID, terminal status and result; this is not detached background work. Defaults to read-only research. Only workers may share parent tools, which are not isolated or sandboxed.",
    schema: spawnSubagentSchema,
    dangerous: false,
    execute: async (rawInput: SpawnSubagentInput, signal?: AbortSignal) => {
      const input = spawnSubagentSchema.parse(rawInput)
      signal?.throwIfAborted()
      const db = getDb()
      let scrub = (text: string) => args.scrub ? args.scrub(text) : text
      const safe = (value: unknown) => redactValue(value, scrub)
      const readOnly = input.role !== "worker" || input.tools !== "same"
      const transcript: ModelMessage[] = [{ role: "user", content: input.task }]

      // Serialize reservation on the parent. READ COMMITTED makes a waiter see
      // children committed by the previous lock holder before it counts them.
      const childRun = await db.transaction(async (tx) => {
        const [parent] = await tx.select().from(agentRuns)
          .where(eq(agentRuns.id, args.parentRunId)).for("update")
        signal?.throwIfAborted()
        if (!parent || parent.roomId !== args.roomId || parent.agentId !== args.agent.id) {
          throw new Error("Subagent parent run not found in this agent/room")
        }
        if (parent.parentRunId) throw new Error("Recursive subagent spawning is not allowed")
        if (parent.status !== "running" && parent.status !== "waiting") {
          throw new Error("Cannot spawn from a terminated parent run")
        }
        const [counts] = await tx.select({
          total: sql<number>`count(*)`,
          active: sql<number>`count(*) filter (where ${agentRuns.status} in ('running', 'waiting'))`,
        }).from(agentRuns).where(eq(agentRuns.parentRunId, args.parentRunId))
        const total = Number(counts?.total ?? 0)
        const active = Number(counts?.active ?? 0)
        if (active >= MAX_CONCURRENT_SUBAGENTS) {
          throw new Error(`Subagent concurrency limit reached (${active}/${MAX_CONCURRENT_SUBAGENTS})`)
        }
        if (total >= MAX_TOTAL_SUBAGENTS) {
          throw new Error(`Total subagent limit reached (${total}/${MAX_TOTAL_SUBAGENTS})`)
        }
        const [child] = await tx.insert(agentRuns).values({
          roomId: args.roomId, agentId: args.agent.id, step: 0, role: "responder",
          status: "running", engine: "v2", parentRunId: args.parentRunId,
          heartbeatAt: new Date(), steps: 0,
        }).returning()
        if (!child) throw new Error("Failed to create child run for subagent")
        await tx.insert(runTranscripts).values({
          runId: child.id, messages: safe(transcript), compactedThroughIdx: 0,
          plan: null, version: 1,
        })
        return child
      }, { isolationLevel: "read committed" })

      const controller = new AbortController()
      const onAbort = () => controller.abort(signal?.reason)
      if (!input.runInBackground) {
        signal?.addEventListener("abort", onAbort, { once: true })
        if (signal?.aborted) onAbort()
      }

      const runExecution = async () => {
        let steps = 0
        let lastStepHadTools = false
        let stepStartedAt = new Date()
        let heartbeatError: unknown = null
        let heartbeatPending: Promise<void> | undefined
        const heartbeatTimer = setInterval(() => {
          if (heartbeatPending) return
          heartbeatPending = (async () => {
            try {
              await db.update(agentRuns).set({ heartbeatAt: new Date() })
                .where(and(eq(agentRuns.id, childRun.id), eq(agentRuns.status, "running")))
            } catch (error) {
              heartbeatError = error
              controller.abort(error)
            }
          })().finally(() => { heartbeatPending = undefined })
        }, SUBAGENT_HEARTBEAT_MS)
        heartbeatTimer.unref?.()

        const send = async (status: string, finishReason?: string, error?: string) => {
          // Keep the existing run.step event; attach machine-readable child data.
          const event = {
            type: "run.step" as const, runId: args.parentRunId, step: steps,
            kind: "subagent" as const, label: `Subagent ${input.role} ${status}${finishReason ? ` (${finishReason})` : ""}`,
            subagent: {
              runId: childRun.id, parentRunId: args.parentRunId, role: input.role,
              status, finishReason, steps, readOnly, isolation: "shared_tools", error,
            },
          }
          await broadcast(args.roomId, event).catch(() => {})
        }
        let status: "complete" | "error" | "halted" = "error"
        let finishReason = "error"
        let error: string | null = null
        let summary = ""
        let inputTokens: number | null = null
        let outputTokens: number | null = null
        try {
          controller.signal.throwIfAborted()
          await send("started")
          const resolved = await abortable(input.model === "same"
            ? resolveAgentModel(args.agent) : resolveAgentCheapModel(args.agent), controller.signal)
          const modelScrubber = createRunScrubber(resolved.apiKey ? [resolved.apiKey] : [])
          scrub = (text) => modelScrubber(args.scrub ? args.scrub(text) : text)
          const available = args.getAvailableToolSpecs?.() ?? args.availableToolSpecs ?? []
          const allowedSpecs = available.filter((spec) => {
            if (SUBAGENT_EXCLUDED_TOOLS.has(spec.name) || /(?:^|_)skills?(?:_|$)/i.test(spec.name)) return false
            return !readOnly || (READ_ONLY_TOOL_NAMES.has(spec.name) && spec.dangerous === false)
          })
          if (input.workspace) {
            const inspect = available.find((spec) => spec.name === "workspace_inspect")
            if (!inspect || inspect.dangerous !== false) throw new Error("Worktree scope requires workspace_inspect")
            const inspection = await inspect.execute(input.workspace, controller.signal)
            if (!inspection || typeof inspection !== "object" ||
                (inspection as Record<string, unknown>).repo !== input.workspace.repo ||
                (inspection as Record<string, unknown>).worktree !== input.workspace.worktree ||
                (inspection as Record<string, unknown>).baseSha !== input.workspace.baseSha) {
              throw new Error("Worktree scope could not be verified")
            }
            // Confine subagent tool executions strictly to the assigned worktree
            const worktreeRoot = resolve(input.workspace.worktree)
            for (let i = 0; i < allowedSpecs.length; i++) {
              const orig = allowedSpecs[i]!
              if (["fs_read", "fs_write", "fs_edit", "computer_read_file", "computer_write_file"].includes(orig.name)) {
                allowedSpecs[i] = {
                  ...orig,
                  execute: async (toolArgs: any, sig?: AbortSignal, ctx?: any) => {
                    const rawPath = typeof toolArgs?.path === "string" ? toolArgs.path : ""
                    if (rawPath) {
                      const resolvedTarget = rawPath.startsWith("/") ? resolve(rawPath) : resolve(worktreeRoot, rawPath)
                      const isUnderWorktree = resolvedTarget === worktreeRoot || resolvedTarget.startsWith(worktreeRoot + "/")
                      const isUnderTmp = resolvedTarget === "/tmp" || resolvedTarget.startsWith("/tmp/")
                      if (!isUnderWorktree && !isUnderTmp) {
                        throw new Error(`Access denied: Subagent is confined to workspace worktree ${worktreeRoot}`)
                      }
                    }
                    return orig.execute(toolArgs, sig, ctx)
                  },
                }
              }
            }
          }
          const childTools: ToolSet = toAuditedTools(allowedSpecs, {
            orgId: args.orgId, roomId: args.roomId, agentId: args.agent.id,
            runId: childRun.id, messageId: null, scrub,
          })
          const system = [
            `You are a ${input.role} subagent for @${args.agent.handle}.${input.runInBackground ? " You are running as a background task." : " The parent awaits your result; you are not a detached background task."}`,
            ROLE_PROMPTS[input.role],
            "Do not ask questions. State assumptions and verification limits. Your final answer must contain concrete evidence, not an unsupported success claim.",
            "Never spawn other agents, install or approve skills, merge workspaces or perform unrelated side effects.",
            readOnly ? "You have read-only tools. Do not attempt to modify anything." :
              "You share the parent's tools and permissions. This is NOT an isolated environment. Preserve all unrelated work.",
            input.workspace ? `Worktree task scope: ${JSON.stringify(input.workspace)}. Read and edit project files only within that worktree; never edit the original repo. This path is an instruction, not a sandbox boundary; shared tools are not path-constrained.` :
              "No worktree scope was supplied. Do not claim worktree isolation or assume that a separate checkout exists.",
          ].join("\n")
          transcript.unshift({ role: "system", content: system })
          await db.update(runTranscripts).set({ messages: safe(transcript), updatedAt: new Date() })
            .where(eq(runTranscripts.runId, childRun.id))
          controller.signal.throwIfAborted()
          const result = await generateText({
            model: resolved.model, system, prompt: input.task, tools: childTools,
            stopWhen: stepCountIs(input.maxSteps), abortSignal: controller.signal,
            onStepEnd: async (step) => {
              const idx = steps + 1
              const nextTranscript = [...transcript, ...step.response.messages as ModelMessage[]]
              await db.transaction(async (tx) => {
                await tx.insert(runSteps).values({
                  runId: childRun.id, idx, kind: step.toolCalls.length ? "tool" : "model", inputRef: null,
                  output: safe({ text: step.text, toolCalls: step.toolCalls, toolResults: step.toolResults, finishReason: step.finishReason }),
                  usage: safe(step.usage), startedAt: stepStartedAt, finishedAt: new Date(),
                })
                await tx.update(runTranscripts).set({
                  messages: safe(nextTranscript), updatedAt: new Date(), version: sql`version + 1`,
                }).where(eq(runTranscripts.runId, childRun.id))
                await tx.update(agentRuns).set({ steps: idx, heartbeatAt: new Date() })
                  .where(eq(agentRuns.id, childRun.id))
              })
              steps = idx
              lastStepHadTools = step.toolCalls.length > 0
              transcript.splice(0, transcript.length, ...nextTranscript)
              stepStartedAt = new Date()
              await send("running", step.finishReason)
              controller.signal.throwIfAborted()
            },
          })
          controller.signal.throwIfAborted()
          summary = safe(result.text) as string
          inputTokens = result.totalUsage?.inputTokens ?? null
          outputTokens = result.totalUsage?.outputTokens ?? null
          finishReason = result.finishReason
          if (steps >= input.maxSteps && lastStepHadTools && finishReason !== "error") {
            status = "halted"
            finishReason = "tool_step_limit"
          } else if (finishReason === "stop" && summary.trim()) status = "complete"
          else if (finishReason === "error") {
            status = "error"
            error = "Subagent model reported an error"
          } else {
            status = "halted"
            if (finishReason === "tool-calls") finishReason = steps >= input.maxSteps ? "tool_step_limit" : "incomplete_tool_calls"
            else if (finishReason === "length") finishReason = "output_token_limit"
            else if (finishReason === "stop") finishReason = "no_output"
          }
        } catch (err) {
          status = heartbeatError ? "error" : controller.signal.aborted || (err instanceof Error && err.name === "AbortError") ? "halted" : "error"
          finishReason = status === "halted" ? "abort" : "error"
          error = safe(err instanceof Error ? err.message : String(err)) as string
        } finally {
          clearInterval(heartbeatTimer)
          await heartbeatPending
          if (!input.runInBackground) {
            signal?.removeEventListener("abort", onAbort)
          }
        }
        if (heartbeatError) {
          status = "error"
          finishReason = "error"
          error = safe(heartbeatError instanceof Error ? heartbeatError.message : String(heartbeatError)) as string
        } else if (signal?.aborted && !input.runInBackground) {
          status = "halted"
          finishReason = "abort"
        }
        // Do not hide a failed terminal write: include the child ID for recovery.
        try {
          await db.update(agentRuns).set({
            status, finishReason, error, steps, inputTokens, outputTokens, heartbeatAt: new Date(),
          }).where(eq(agentRuns.id, childRun.id))
        } catch (err) {
          await send("error", "persistence_error")
          throw new Error(`Subagent ${childRun.id} terminal persistence failed: ${safe(err instanceof Error ? err.message : String(err))}`)
        }
        await send(status, finishReason, error ?? undefined)
        return {
          ok: status === "complete", runId: childRun.id, status, finishReason,
          role: input.role, readOnly, isolation: "shared_tools", workspace: input.workspace,
          task: safe(input.task), stepsTaken: steps, summary, error,
        }
      }

      if (input.runInBackground) {
        runExecution().catch((err) => {
          console.error(`[subagent] Background execution failed for ${childRun.id}:`, err)
        })
        return {
          ok: true,
          runId: childRun.id,
          status: "running",
          background: true,
          role: input.role,
          readOnly,
          isolation: "shared_tools",
          workspace: input.workspace,
          task: safe(input.task),
          message: `Subagent ${childRun.id} is running in the background. Check progress with subagent_status({ runId: "${childRun.id}" }).`,
        }
      }

      return await runExecution()
    },
  }
}

export function subagentStatusTool(): ToolSpec {
  return {
    name: "subagent_status",
    description: "Check the status, step count, and final result or error of a subagent by runId.",
    schema: z.object({
      runId: z.string().uuid().describe("The subagent run ID returned by spawn_subagent"),
    }),
    dangerous: false,
    execute: async ({ runId }: { runId: string }) => {
      const db = getDb()
      const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1)
      if (!run) return { ok: false, error: "Subagent run not found" }
      const [transcript] = await db.select().from(runTranscripts).where(eq(runTranscripts.runId, runId)).limit(1)

      let lastMessage: string | undefined
      if (transcript && Array.isArray(transcript.messages) && transcript.messages.length > 0) {
        const last = transcript.messages[transcript.messages.length - 1] as any
        if (last && typeof last.content === "string") lastMessage = last.content
      }

      return {
        ok: true,
        runId: run.id,
        status: run.status,
        finishReason: run.finishReason,
        steps: run.steps,
        error: run.error,
        completed: run.status === "complete" || run.status === "error" || run.status === "halted",
        lastMessage,
      }
    },
  }
}
