import {
  ORCHESTRATOR_GUIDE,
  debateRoleInstruction,
  harnessSystemPrompt,
  personaBlock,
  desktopGuidance,
  desktopHome,
  parseCapabilities,
  replyStyleFromParams,
  replyStyleInstruction,
  worksOnFromParams,
  type TurnRole,
} from "@sayabot/core"
import { getProviderCapabilities } from "@sayabot/llm"
import type { ModelMessage, SystemModelMessage, UserModelMessage, ToolSet } from "ai"
import type { AgentRow, ContextMessage, RoomRow } from "../runner/context"
import type { ToolSpec } from "../tools/audited"

export interface CanvasDiffInfo {
  id: string
  title: string
  diffSummary: string
}

export interface TaskContextItem {
  number: number
  title: string
  status: string
  kind: string
  owner?: string
}

export interface VolatileTailArgs {
  now: Date | string
  recalledMemories?: Array<{ id: string; title: string; body: string; scope?: string }>
  canvasDiffs?: CanvasDiffInfo[]
  openTasks?: TaskContextItem[]
  activeTaskBrief?: string
  currentTrigger?: string
  operatorNotes?: string[]
  /** Pre-rendered context sections (room canvases, room task board). */
  contextBlocks?: string[]
  /** Checklist appended after the trigger (e.g. self-verification for tasks). */
  closingInstructions?: string
}

export interface BuildEngineContextArgs {
  agent: AgentRow
  room: RoomRow
  provider: string
  role?: TurnRole
  skillsIndex?: Array<{ slug: string; description: string }>
  pinnedMemories?: Array<{ id: string; title: string; body: string }>
  roomHistory: ContextMessage[]
  runHistory?: ModelMessage[]
  volatileTail: VolatileTailArgs
  /**
   * When true, places a cache breakpoint at the end of roomHistory (prior chat turns),
   * and consolidates system prompt breakpoints into a single breakpoint at system2.
   * This gives multi-turn chats a near 100% cache hit rate on the conversation history
   * while staying within Anthropic's 4-breakpoint limit (system, tools, history, rolling tail).
   */
  cacheHistoryBoundary?: boolean
  /**
   * Explicit override for consolidating system prompt breakpoints.
   */
  consolidateSystemCache?: boolean
}

export interface EngineContextResult {
  /** The full array of ModelMessages passed to the language model. */
  messages: ModelMessage[]
  /** The prefix messages (system blocks, room history, and run history) excluding the volatile tail. */
  prefix: ModelMessage[]
  /** The volatile tail message. */
  tail: UserModelMessage
  /** JSON-stringified prefix for byte-stability assertions. */
  prefixString: string
  /**
   * Index of the history boundary message in non-system messages, if marked.
   * Preserved by applyRollingCacheBreakpoint across intra-run steps.
   */
  historyBoundaryIndex?: number
}

function label(message: ContextMessage): string {
  if (message.senderType === "system") return "System"
  if (message.senderType === "agent") {
    return message.senderHandle
      ? `${message.senderName} (@${message.senderHandle}) (agent)`
      : `${message.senderName} (agent)`
  }
  return `${message.senderName} (human)`
}

/**
 * Sorts tool specs deterministically by name for cache-friendly tool definitions.
 */
export function sortToolSpecs(specs: ToolSpec[]): ToolSpec[] {
  return [...specs].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Computes a concise line diff summary between previous and current text.
 */
export function computeCanvasDiffSummary(oldText?: string | null, newText?: string | null): string {
  if (oldText === undefined || oldText === null) {
    const lines = (newText ?? "").split("\n").length
    return `${lines} lines total`
  }
  if (oldText === newText) {
    const lines = (newText ?? "").split("\n").length
    return `unchanged (${lines} lines)`
  }

  const oldLines = oldText ? oldText.split("\n") : []
  const newLines = newText ? newText.split("\n") : []

  const oldSet = new Set(oldLines)
  const newSet = new Set(newLines)

  let added = 0
  let removed = 0

  for (const line of newLines) {
    if (!oldSet.has(line)) added++
  }
  for (const line of oldLines) {
    if (!newSet.has(line)) removed++
  }

  if (added === 0 && removed === 0) {
    return "reordered or modified lines"
  }

  return `+${added} -${removed} lines`
}

/**
 * Builds structured, append-only messages laid out for prefix caching:
 * - [system 1: frozen]: harness rules + identity (+ orchestrator guide) + persona (breakpoint 1)
 * - [system 2: slow-changing]: room directive, skills index, pinned memories (breakpoint 2)
 * - [messages: room history]: prior turns (others -> user, this agent -> assistant)
 * - [messages: this run]: append-only steps from this run (breakpoint 3 rolling)
 * - [volatile tail]: now time, recalled memories, canvas diffs, tasks, trigger (never cached)
 */
export function buildEngineContext(args: BuildEngineContextArgs): EngineContextResult {
  const caps = getProviderCapabilities(args.provider as any)
  const agentCaps = parseCapabilities(args.agent.capabilities)

  const cacheOption =
    args.provider === "anthropic" && caps.supportsPromptCache
      ? { [args.provider]: { cacheControl: { type: "ephemeral" as const } } }
      : undefined

  // 1. System 1 (Frozen): harness rules + identity, then the owner's persona
  const system1Parts = [harnessSystemPrompt(args.agent)]
  if (agentCaps.orchestrator) system1Parts.push(ORCHESTRATOR_GUIDE)

  // The owner's persona (agents.system_prompt) comes after the harness rules it cannot loosen.
  const persona = personaBlock(args.agent.systemPrompt)
  if (persona) system1Parts.push(persona)
  const replyStyle = replyStyleInstruction(
    replyStyleFromParams(args.agent.params as Record<string, unknown> | null),
  )
  if (replyStyle) system1Parts.push(replyStyle)

  if (agentCaps.computer) {
    const worksOn = worksOnFromParams(args.agent.params as Record<string, unknown> | null)
    const home = desktopHome(worksOn)
    system1Parts.push(
      "Persistent Computer Environment:\n" +
        `- ${home} is your persistent workspace across turns.\n` +
        "- Start with workspace_detect to inspect actual project tooling. Prefer code_outline, code_definition, code_references and code_diagnostics for TypeScript/JavaScript; use fs_read ranges only when source is needed. Other languages still require their own tools.\n" +
        "- Read before editing. Keep file hashes for guarded edits; never overwrite a truncated read. Use fs_edit for narrow, unambiguous changes.\n" +
        "- For bugs, reproduce with a targeted failing test, fix the cause, then run that test and relevant regressions. After the last edit, run verify_workspace with actual repository test/lint/typecheck commands. A successful command is evidence for that check only, not proof of every requirement.\n" +
        "- Use workspace_fork for experiments on a clean repository, with explicit worktree paths in worker tasks. Never discard dirty work, automatically merge candidates, push or roll back without approval.\n" +
        "- Before finishing code work, inspect git_diff for unintended edits and secrets. If checks cannot run, state that the result is unverified and why.\n" +
        "- Granted secrets are available via environment placeholders ($GITHUB_TOKEN, etc.).\n" +
        "- Egress network is HTTPS only through Secret Broker.",
      desktopGuidance(worksOn),
    )
  }

  if (agentCaps.cron) {
    system1Parts.push(
      "Scheduled Routines & Automations (Hermes-compatible):\n" +
        "- You can schedule, list, pause, resume, or trigger autonomous routines and cron jobs using the cronjob tool.\n" +
        "- When a user asks to run tasks periodically (e.g. 'daily at 9am', 'every 2 hours', '0 9 * * 1-5'), invoke cronjob({ action: 'create', ... }).\n" +
        "- Routines execute automatically at their scheduled interval and post directly to the designated room.",
    )
  }

  // If cacheHistoryBoundary is enabled, consolidate system cache so system only consumes 1 breakpoint,
  // leaving room for tools, history boundary, and the active tail within Anthropic's 4-breakpoint limit.
  const consolidateSystem = args.consolidateSystemCache ?? Boolean(args.cacheHistoryBoundary)

  const system1Message: SystemModelMessage = {
    role: "system",
    content: system1Parts.join("\n\n"),
    ...(cacheOption && !consolidateSystem ? { providerOptions: cacheOption } : {}),
  }

  // 2. System 2 (Slow-changing): Room directive, skills index, pinned memories
  const system2Parts: string[] = []

  if (args.room.systemDirective?.trim()) {
    system2Parts.push(`Room Directive (#${args.room.name}):\n${args.room.systemDirective.trim()}`)
  } else {
    system2Parts.push(`Room: #${args.room.name}`)
  }

  if (args.skillsIndex && args.skillsIndex.length > 0) {
    const sortedSkills = [...args.skillsIndex].sort((a, b) => a.slug.localeCompare(b.slug))
    system2Parts.push(
      "Available Skills (use load_skill({ slug }) to inspect full procedure):\n" +
        sortedSkills.map((s) => `- ${s.slug}: ${s.description}`).join("\n"),
    )
  }

  if (args.pinnedMemories && args.pinnedMemories.length > 0) {
    const sortedMemories = [...args.pinnedMemories].sort((a, b) => a.id.localeCompare(b.id))
    system2Parts.push(
      "Pinned Team Memories:\n" +
        sortedMemories.map((m) => `[#${m.id}] ${m.title}: ${m.body}`).join("\n"),
    )
  }

  const role = args.role ? debateRoleInstruction(args.role) : ""
  if (role) {
    system2Parts.push(role)
  }

  const system2Message: SystemModelMessage = {
    role: "system",
    content: system2Parts.join("\n\n"),
    ...(cacheOption ? { providerOptions: cacheOption } : {}),
  }

  // 3. Room History: map prior turns
  const roomHistoryMessages: ModelMessage[] = args.roomHistory.map((m) => {
    const safeContent =
      m.content.length > 8000 ? `${m.content.slice(0, 8000)}… [truncated]` : m.content
    if (m.senderType === "agent" && m.senderId === args.agent.id) {
      return {
        role: "assistant" as const,
        content: safeContent,
      }
    }
    return {
      role: "user" as const,
      content: `[${label(m)}]: ${safeContent}`,
    }
  })

  // When cacheHistoryBoundary is active, mark the end of room history as a breakpoint.
  // In multi-turn chat, this guarantees all prior turns are read from cache at a 90% discount.
  let historyBoundaryIndex: number | undefined
  if (args.cacheHistoryBoundary && cacheOption && roomHistoryMessages.length > 0) {
    historyBoundaryIndex = roomHistoryMessages.length - 1
    const lastHistMsg = roomHistoryMessages[historyBoundaryIndex]!
    roomHistoryMessages[historyBoundaryIndex] = {
      ...lastHistMsg,
      providerOptions: {
        ...(((lastHistMsg as Record<string, unknown>).providerOptions as Record<string, unknown>) ??
          {}),
        ...cacheOption,
      },
    } as ModelMessage
  }

  // 4. This Run History (append-only)
  const runHistory = args.runHistory ? [...args.runHistory] : []

  // If prompt cache is supported and runHistory has steps, apply rolling breakpoint
  if (cacheOption && runHistory.length > 0) {
    const lastIdx = runHistory.length - 1
    const lastMsg = runHistory[lastIdx]
    if (lastMsg) {
      runHistory[lastIdx] = {
        ...lastMsg,
        providerOptions: {
          ...(((lastMsg as Record<string, unknown>).providerOptions as Record<string, unknown>) ??
            {}),
          ...cacheOption,
        },
      } as ModelMessage
    }
  }

  const prefix: ModelMessage[] = [
    system1Message,
    system2Message,
    ...roomHistoryMessages,
    ...runHistory,
  ]

  // 5. Volatile Tail (never cached, contains now, recalled memories, diffs, trigger)
  const nowIso =
    typeof args.volatileTail.now === "string"
      ? args.volatileTail.now
      : args.volatileTail.now.toISOString()

  const tailParts: string[] = [`Current Time: ${nowIso}`]

  if (args.volatileTail.recalledMemories && args.volatileTail.recalledMemories.length > 0) {
    tailParts.push(
      "<recalled>\n" +
        "Memories that may be relevant. When you rely on one, cite it as [#id].\n" +
        args.volatileTail.recalledMemories
          .map((m) => `[#${m.id}] (${m.scope || "team"}) ${m.title}: ${m.body}`)
          .join("\n") +
        "\n</recalled>",
    )
  }

  for (const block of args.volatileTail.contextBlocks ?? []) {
    if (block.trim()) tailParts.push(block.trim())
  }

  if (args.volatileTail.canvasDiffs && args.volatileTail.canvasDiffs.length > 0) {
    tailParts.push(
      "Canvas Status:\n" +
        args.volatileTail.canvasDiffs
          .map(
            (c) =>
              `- Canvas "${c.title}" (id=${c.id}): ${c.diffSummary}. Use canvas_read({ canvasId: "${c.id}" }) to inspect.`,
          )
          .join("\n"),
    )
  }

  if (args.volatileTail.activeTaskBrief) {
    tailParts.push(args.volatileTail.activeTaskBrief)
  } else if (args.volatileTail.openTasks && args.volatileTail.openTasks.length > 0) {
    tailParts.push(
      "Open Tasks in Room:\n" +
        args.volatileTail.openTasks
          .map(
            (t) =>
              `- MESH-${t.number} [${t.kind}] ${t.title} (${t.status}, ${t.owner || "unassigned"}) id=${t.number}`,
          )
          .join("\n"),
    )
  }

  if (args.volatileTail.operatorNotes && args.volatileTail.operatorNotes.length > 0) {
    tailParts.push(
      "Operator Notes:\n" + args.volatileTail.operatorNotes.map((n) => `[Note]: ${n}`).join("\n"),
    )
  }

  tailParts.push(
    args.volatileTail.currentTrigger?.trim() ||
      `Write your next response or tool call as @${args.agent.handle}.`,
  )

  if (args.volatileTail.closingInstructions?.trim()) {
    tailParts.push(args.volatileTail.closingInstructions.trim())
  }

  const tailMessage: UserModelMessage = {
    role: "user",
    content: tailParts.join("\n\n"),
  }

  const prefixString = JSON.stringify(prefix)

  return {
    messages: [...prefix, tailMessage],
    prefix,
    tail: tailMessage,
    prefixString,
    historyBoundaryIndex,
  }
}

const EXPLICIT_CACHE_PROVIDERS = new Set(["anthropic"])

/**
 * Caches tool definitions by placing an ephemeral cache breakpoint on the LAST tool definition.
 * All tools are sorted deterministically so their schema order is stable across calls.
 * This guarantees the model reuses cached tool definitions without re-tokenizing them every turn.
 */
export function applyToolCacheBreakpoint<T extends ToolSet>(tools: T, provider: string): T {
  if (!EXPLICIT_CACHE_PROVIDERS.has(provider)) return tools
  const caps = getProviderCapabilities(provider as any)
  if (!caps.supportsPromptCache) return tools

  const toolNames = Object.keys(tools).sort()
  if (toolNames.length === 0) return tools

  const lastToolName = toolNames[toolNames.length - 1]!
  const result: Record<string, unknown> = {}

  for (const name of toolNames) {
    const originalTool = tools[name]!
    if (name === lastToolName) {
      const existingOpts = (originalTool as Record<string, unknown>).providerOptions as
        | Record<string, unknown>
        | undefined
      result[name] = {
        ...originalTool,
        providerOptions: {
          ...(existingOpts ?? {}),
          [provider]: {
            ...((existingOpts?.[provider] as Record<string, unknown>) ?? {}),
            cacheControl: { type: "ephemeral" },
          },
        },
      }
    } else {
      result[name] = originalTool
    }
  }

  return result as T
}

/**
 * Moves the rolling prompt-cache breakpoint to the last message before each
 * step. Earlier rolling markers on non-system messages are stripped, EXCEPT for
 * an optional established history boundary breakpoint (e.g. at the end of roomHistory),
 * so a multi-turn chat retains its history cache hit while the active loop steps forward.
 *
 * Anthropic allows 4 breakpoints:
 * 1. System block (last system message)
 * 2. Tool definitions (last tool)
 * 3. History boundary (end of prior chat turns)
 * 4. Active tail / current step (rolling breakpoint)
 */
export function applyRollingCacheBreakpoint(
  messages: ModelMessage[],
  provider: string,
  historyBoundaryIndex?: number,
): ModelMessage[] {
  // Only Anthropic needs explicit breakpoints; OpenAI-style providers cache
  // prefixes automatically and ignore the marker.
  if (!EXPLICIT_CACHE_PROVIDERS.has(provider) || messages.length === 0) return messages
  const caps = getProviderCapabilities(provider as any)
  if (!caps.supportsPromptCache) return messages
  const lastIdx = messages.length - 1
  return messages.map((msg, idx) => {
    if (msg.role === "system") return msg
    const existing = (msg as { providerOptions?: Record<string, unknown> }).providerOptions
    const providerData = (existing?.[provider] ?? {}) as Record<string, unknown>
    const { cacheControl: _cache, ...otherProviderOptions } = providerData
    const rest = { ...existing }
    if (Object.keys(otherProviderOptions).length) rest[provider] = otherProviderOptions
    else delete rest[provider]

    // Preserve history boundary breakpoint if valid and not the tail
    if (historyBoundaryIndex !== undefined && idx === historyBoundaryIndex && idx < lastIdx) {
      return {
        ...msg,
        providerOptions: {
          ...rest,
          [provider]: { ...otherProviderOptions, cacheControl: { type: "ephemeral" } },
        },
      } as ModelMessage
    }

    if (idx === lastIdx) {
      return {
        ...msg,
        providerOptions: {
          ...rest,
          [provider]: { ...otherProviderOptions, cacheControl: { type: "ephemeral" } },
        },
      } as ModelMessage
    }
    if (!existing || !("cacheControl" in providerData)) return msg
    return { ...msg, providerOptions: rest } as ModelMessage
  })
}
