const KNOWN_TOOLS: Record<string, string> = {
  code_sandbox: "run code in a sandbox",
  postgres_inspector: "run a read-only database query",
  web_search: "search the web",
  github_bridge: "make a change on GitHub",
  list_tasks: "list tasks",
  create_task: "create a task",
  update_task: "update a task",
  canvas_write: "rewrite a canvas",
  canvas_patch: "edit a canvas",
}

const DETAIL_KEYS = [
  "title",
  "query",
  "name",
  "path",
  "repo",
  "url",
  "action",
  "status",
  "language",
]

function toolAction(toolName: string): string {
  const known = KNOWN_TOOLS[toolName]
  if (known) return known
  const readable = toolName
    .replace(/^mcp[_:-]/, "")
    .replace(/[_:-]+/g, " ")
    .trim()
  return `use ${readable || "a tool"}`
}

/** One plain sentence describing what approving a tool call will let the agent do. */
export function describeToolCall(args: {
  toolName: string
  input: unknown
  agentName?: string | null
}): string {
  const who = args.agentName ?? "An agent"
  let detail = ""
  if (args.input && typeof args.input === "object") {
    const input = args.input as Record<string, unknown>
    const key = DETAIL_KEYS.find((name) => typeof input[name] === "string" && input[name])
    if (key) {
      const value = (input[key] as string).replace(/\s+/g, " ").trim()
      detail = `: “${value.length > 90 ? `${value.slice(0, 90)}…` : value}”`
    }
  }
  return `${who} wants to ${toolAction(args.toolName)}${detail}.`
}

export const APPROVAL_WINDOW_MS = 5 * 60_000
/**
 * A step on the owner's own Mac waits longer for an answer: the run has no time limit and costs
 * the server nothing, so stepping away for a while shouldn't refuse it. Matches
 * MAC_APPROVAL_TIMEOUT_MS in the orchestrator and APPROVAL_WAIT_MS in the Mac app.
 */
export const MAC_APPROVAL_WINDOW_MS = 30 * 60_000

export function approvalMsLeft(
  createdAt: string,
  now: number,
  windowMs = APPROVAL_WINDOW_MS,
): number {
  return new Date(createdAt).getTime() + windowMs - now
}

export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`
}
