import { redactSecrets } from "@sayabot/core"
import { toolCalls } from "@sayabot/db"
import { tool, type ToolSet } from "ai"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "../db"
import { capToolOutputForModel } from "../engine/loop-control"
import { notifyHumansNeeded } from "../push"
import { broadcast } from "../realtime"
import { resolveApprovalWaiter, waitForApproval } from "./approvals"

export interface ToolRuntime {
  orgId: string
  roomId: string
  agentId: string
  runId?: string | null
  messageId?: string | null
  approvalTimeoutMs?: number
  scrub?: (s: string) => string
}

export interface ToolContext {
  toolCallId: string
  signal?: AbortSignal
}

export interface ToolSpec {
  name: string
  description: string
  schema: z.ZodType
  dangerous: boolean | ((args: Record<string, unknown>) => boolean)
  execute: (args: any, signal?: AbortSignal, ctx?: ToolContext) => Promise<unknown>
}

const STORED_RESULT_LIMIT = 120_000

export function redactValue(value: unknown, scrub?: (s: string) => string, depth = 0): unknown {
  if (depth > 8) return "[truncated]"
  if (typeof value === "string") {
    const scrubbed = scrub ? scrub(value) : value
    return redactSecrets(scrubbed).text
  }
  if (Array.isArray(value)) return value.map((v) => redactValue(v, scrub, depth + 1))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactValue(v, scrub, depth + 1)]),
    )
  }
  return value
}

function forStorage(value: unknown, scrub?: (s: string) => string): unknown {
  const redacted = redactValue(value, scrub)
  let json: string
  try {
    json = JSON.stringify(redacted) ?? "null"
  } catch {
    return { error: "tool result could not be serialised" }
  }
  if (json.length <= STORED_RESULT_LIMIT) return redacted
  return { truncated: true, preview: json.slice(0, 10_000) }
}

function isDangerous(spec: ToolSpec, args: Record<string, unknown>): boolean {
  return typeof spec.dangerous === "function" ? spec.dangerous(args) : spec.dangerous
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function toSafeUuid(val?: string | null): string | null {
  if (typeof val === "string" && UUID_REGEX.test(val.trim())) {
    return val.trim()
  }
  return null
}

/**
 * Runs every tool through one path: persist the call, ask a human when the tool
 * is dangerous, execute, persist the result, and return something the model can
 * consume. Failures become tool results instead of killing the stream.
 */
export function toAuditedTools(specs: ToolSpec[], runtime: ToolRuntime): ToolSet {
  const tools: ToolSet = {}
  for (const spec of specs) {
    tools[spec.name] = tool({
      description: spec.description,
      inputSchema: spec.schema,
      execute: async (args: unknown, options) => {
        const input = (args ?? {}) as Record<string, unknown>
        if (options.abortSignal?.aborted) return { ok: false, error: "Run stopped before tool execution" }
        const dangerous = isDangerous(spec, input)
        const storedArgs = forStorage(input, runtime.scrub)
        const [row] = await getDb()
          .insert(toolCalls)
          .values({
            runId: toSafeUuid(runtime.runId),
            roomId: runtime.roomId,
            messageId: toSafeUuid(runtime.messageId),
            toolName: spec.name,
            args: storedArgs as Record<string, unknown>,
            status: dangerous ? "pending_approval" : "running",
          })
          .returning({ id: toolCalls.id })
        if (!row) throw new Error("failed to record tool call")

        const startedAt = Date.now()
        await broadcast(runtime.roomId, {
          type: "tool.started",
          toolCallId: row.id,
          agentId: runtime.agentId,
          toolName: spec.name,
          args: storedArgs,
        })

        if (dangerous) {
          await broadcast(runtime.roomId, {
            type: "tool.approval_requested",
            toolCallId: row.id,
            agentId: runtime.agentId,
            toolName: spec.name,
            args: storedArgs,
          })
          notifyHumansNeeded({
            roomId: runtime.roomId,
            agentId: runtime.agentId,
            kind: "approval",
            detail: spec.name,
            refId: row.id,
          })
          const signal = options.abortSignal
          const decision = await Promise.race([
            waitForApproval(row.id, runtime.approvalTimeoutMs),
            new Promise<"rejected">((resolve) => {
              if (signal?.aborted) return resolve("rejected")
              signal?.addEventListener("abort", () => resolve("rejected"), { once: true })
            }),
          ])
          resolveApprovalWaiter(row.id, "rejected")
          await broadcast(runtime.roomId, {
            type: "tool.approval_resolved",
            toolCallId: row.id,
            status: decision,
          })
          if (decision === "rejected") {
            await getDb()
              .update(toolCalls)
              .set({
                status: "rejected",
                resolvedAt: new Date(),
                error: signal?.aborted ? "Run stopped while awaiting approval" : "Approval expired or was rejected",
              })
              .where(eq(toolCalls.id, row.id))
            await broadcast(runtime.roomId, {
              type: "tool.finished",
              toolCallId: row.id,
              status: "rejected",
              durationMs: Date.now() - startedAt,
            })
            return {
              ok: false,
              rejected: true,
              error: signal?.aborted
                ? "The run was stopped before approval."
                : "A room admin rejected this tool call.",
            }
          }
        }

        try {
          options.abortSignal?.throwIfAborted()
          const ctx: ToolContext = {
            toolCallId: row.id,
            signal: options.abortSignal,
          }
          const result = await spec.execute(input, options.abortSignal, ctx)
          await getDb()
            .update(toolCalls)
            .set({
              status: "done",
              result: forStorage(result, runtime.scrub) as unknown,
              resolvedAt: new Date(),
            })
            .where(eq(toolCalls.id, row.id))
          await broadcast(runtime.roomId, {
            type: "tool.finished",
            toolCallId: row.id,
            status: "done",
            durationMs: Date.now() - startedAt,
          })
          return capToolOutputForModel(redactValue(result, runtime.scrub))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const scrubbedError = runtime.scrub ? runtime.scrub(message) : message
          await getDb()
            .update(toolCalls)
            .set({ status: "error", error: redactSecrets(scrubbedError).text, resolvedAt: new Date() })
            .where(eq(toolCalls.id, row.id))
          await broadcast(runtime.roomId, {
            type: "tool.finished",
            toolCallId: row.id,
            status: "error",
            durationMs: Date.now() - startedAt,
          })
          return { ok: false, error: redactSecrets(scrubbedError).text }
        }
      },
    })
  }
  return tools
}
