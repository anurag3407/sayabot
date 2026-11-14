/**
 * Reads what Claude Code (`--output-format stream-json`) and Codex (`exec --json`) print while
 * they work, line by line: the reply text as it grows, and every step they take (commands, file
 * edits, Sayabot tools…) so the room can show it live as tool cards. Pure functions, no I/O.
 */

export type Activity =
  | { type: "started"; key: string; toolName: string; args: Record<string, unknown> }
  | { type: "finished"; key: string; ok: boolean; result?: string }

export interface StreamUpdate {
  /** Text to append to the live reply. */
  delta?: string
  /** A finished assistant message (used when no deltas came). */
  message?: string
  activity: Activity[]
  /** The run is over: the final reply (if the app says it) and an error, if it failed. */
  done?: { text: string | null; error: string | null }
}

const MAX_RESULT = 4_000

function parse(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line)
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content.slice(0, MAX_RESULT)
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof obj(part).text === "string" ? String(obj(part).text) : ""))
      .join("")
      .slice(0, MAX_RESULT)
  }
  return ""
}

/** One line of `claude -p --output-format stream-json --include-partial-messages`. */
export function parseClaudeLine(line: string): StreamUpdate {
  const data = parse(line)
  const none: StreamUpdate = { activity: [] }
  if (!data) return none

  if (data.type === "stream_event") {
    const event = obj(data.event)
    const delta = obj(event.delta)
    if (
      event.type === "content_block_delta" &&
      delta.type === "text_delta" &&
      typeof delta.text === "string"
    ) {
      return { delta: delta.text, activity: [] }
    }
    // A new assistant message after a tool step: keep the paragraphs apart.
    if (event.type === "message_start") return { delta: "\n\n", activity: [] }
    return none
  }

  if (data.type === "assistant") {
    const content = Array.isArray(obj(data.message).content)
      ? (obj(data.message).content as unknown[])
      : []
    const activity: Activity[] = []
    let text = ""
    for (const part of content) {
      const block = obj(part)
      if (block.type === "text" && typeof block.text === "string") text += block.text
      if (
        block.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        activity.push({
          type: "started",
          key: block.id,
          toolName: block.name,
          args: obj(block.input),
        })
      }
    }
    return { ...(text ? { message: text } : {}), activity }
  }

  if (data.type === "user") {
    const content = Array.isArray(obj(data.message).content)
      ? (obj(data.message).content as unknown[])
      : []
    const activity: Activity[] = []
    for (const part of content) {
      const block = obj(part)
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        activity.push({
          type: "finished",
          key: block.tool_use_id,
          ok: block.is_error !== true,
          result: resultText(block.content),
        })
      }
    }
    return { activity }
  }

  if (data.type === "result") {
    const failed =
      data.is_error === true || (typeof data.subtype === "string" && data.subtype !== "success")
    const text = typeof data.result === "string" ? data.result : null
    return {
      activity: [],
      done: {
        text: failed ? null : text,
        error: failed ? text || String(data.subtype ?? "Claude Code failed") : null,
      },
    }
  }
  return none
}

/** A Codex item as the step it is, in the same names Claude uses where they match. */
function codexStep(
  item: Record<string, unknown>,
): { toolName: string; args: Record<string, unknown> } | null {
  switch (item.type) {
    case "command_execution":
      return { toolName: "Bash", args: { command: String(item.command ?? "") } }
    case "mcp_tool_call":
      return {
        toolName: `mcp__${String(item.server ?? "tool")}__${String(item.tool ?? "call")}`,
        args: obj(item.arguments),
      }
    case "file_change": {
      const changes = Array.isArray(item.changes) ? (item.changes as unknown[]).map(obj) : []
      const first = changes[0]
      return {
        toolName: "Edit",
        args: {
          file_path: String(first?.path ?? ""),
          changes: changes.map((c) => `${String(c.kind ?? "edit")} ${String(c.path ?? "")}`),
        },
      }
    }
    case "web_search":
      return { toolName: "WebSearch", args: { query: String(item.query ?? "") } }
    default:
      return null
  }
}

function codexResult(item: Record<string, unknown>): { ok: boolean; result: string } {
  if (item.type === "command_execution") {
    const code = typeof item.exit_code === "number" ? item.exit_code : null
    return {
      ok: item.status !== "failed" && (code === null || code === 0),
      result: String(item.aggregated_output ?? "").slice(-MAX_RESULT),
    }
  }
  if (item.type === "mcp_tool_call") {
    const error = obj(item.error)
    const failed = item.status === "failed" || typeof error.message === "string"
    const result = failed ? String(error.message ?? "failed") : resultText(obj(item.result).content)
    return { ok: !failed, result }
  }
  return { ok: item.status !== "failed", result: "" }
}

/** One line of `codex exec --json`. */
export function parseCodexLine(line: string): StreamUpdate {
  const data = parse(line)
  if (!data) return { activity: [] }
  const item = obj(data.item)
  const key = typeof item.id === "string" ? `codex-${item.id}` : null

  if (data.type === "item.started" && key) {
    const step = codexStep(item)
    return { activity: step ? [{ type: "started", key, ...step }] : [] }
  }
  if (data.type === "item.completed") {
    if (item.type === "agent_message" && typeof item.text === "string") {
      return { message: item.text, activity: [] }
    }
    const step = key ? codexStep(item) : null
    if (key && step) {
      // Some items (file changes, searches) only ever arrive completed: start and finish them.
      const { ok, result } = codexResult(item)
      return {
        activity: [
          { type: "started", key, ...step },
          { type: "finished", key, ok, ...(result ? { result } : {}) },
        ],
      }
    }
    return { activity: [] }
  }
  if (data.type === "turn.completed") return { activity: [], done: { text: null, error: null } }
  if (data.type === "turn.failed" || data.type === "error") {
    const message = obj(data.error).message ?? data.message
    // Codex retries on its own and reports each attempt; only the last word counts.
    if (typeof message === "string" && /^Reconnecting\.\.\./.test(message)) return { activity: [] }
    return { activity: [], done: { text: null, error: String(message ?? "Codex failed") } }
  }
  return { activity: [] }
}

/** Shell operators that chain commands: such a command can only be allowed once. */
const CHAINED = /[;&|`]|\$\(|>|</

/**
 * The same "always allow" rule the server saves (apps/web/src/lib/mac-runner-shared.ts), so a
 * step allowed for good mid-run isn't asked about again in that run.
 */
export function allowRuleFor(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command.trim() : ""
    if (!command || CHAINED.test(command) || command.length > 200) return null
    const words = command.split(/\s+/).filter(Boolean)
    const first = words[0]
    if (!first || !/^[\w./-]+$/.test(first) || first === "sudo" || first === "rm") return null
    const second = words[1]
    const prefix =
      second && /^[\w.:/-]+$/.test(second) && !second.startsWith("-") ? `${first} ${second}` : first
    return `Bash(${prefix}:*)`
  }
  if (toolName === "WebFetch") {
    try {
      const host = typeof input.url === "string" ? new URL(input.url).hostname : null
      return host ? `WebFetch(domain:${host})` : null
    } catch {
      return null
    }
  }
  if (["Edit", "MultiEdit", "Write", "NotebookEdit", "WebSearch"].includes(toolName))
    return toolName
  if (/^mcp__[\w-]+__\w+$/.test(toolName)) return toolName
  return null
}

/** Whether a step matches one of the agent's saved rules (for steps the app asks about anyway). */
export function allowedByRules(
  toolName: string,
  input: Record<string, unknown>,
  rules: string[],
): boolean {
  const rule = allowRuleFor(toolName, input)
  if (rule && rules.includes(rule)) return true
  if (toolName === "Bash" && typeof input.command === "string") {
    const command = input.command.trim()
    if (/[;&|`]|\$\(|>|</.test(command)) return false
    return rules.some((r) => {
      const m = /^Bash\((.+):\*\)$/.exec(r)
      return Boolean(m?.[1] && (command === m[1] || command.startsWith(`${m[1]} `)))
    })
  }
  return false
}
