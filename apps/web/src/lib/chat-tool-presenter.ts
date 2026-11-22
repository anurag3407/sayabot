import type { ToolCallView } from "@/lib/types"

export type ActionToolKind =
  | "command"
  | "code-search"
  | "search"
  | "read"
  | "edit"
  | "browser"
  | "device"
  | "other"

export interface ChangedFileStat {
  path: string
  name: string
  dir: string
  additions: number
  deletions: number
  isNew?: boolean
}

export interface ChangedFilesSummary {
  files: ChangedFileStat[]
  totalFiles: number
  totalAdditions: number
  totalDeletions: number
}

/** Classifies a tool call into an action category. */
export function classifyToolKind(toolName: string, _args?: Record<string, unknown> | null): ActionToolKind {
  const name = toolName.toLowerCase()
  if (
    name.includes("bash") ||
    name.includes("command") ||
    name.includes("terminal") ||
    name.includes("exec") ||
    name.includes("shell") ||
    name.includes("run_command")
  ) {
    return "command"
  }
  if (
    name.includes("search_code") ||
    name.includes("grep") ||
    name.includes("ripgrep") ||
    name.includes("find_file") ||
    name.includes("file_search") ||
    (name.includes("search") && (name.includes("code") || name.includes("file") || name.includes("repo")))
  ) {
    return "code-search"
  }
  if (
    name.includes("web") ||
    name.includes("google") ||
    name.includes("brave") ||
    name.includes("bing") ||
    (name === "search" && !name.includes("code"))
  ) {
    return "search"
  }
  if (name.includes("read") || name.includes("cat") || name.includes("view") || name.includes("get_file")) {
    return "read"
  }
  if (
    name.includes("write") ||
    name.includes("edit") ||
    name.includes("patch") ||
    name.includes("create_file") ||
    name.includes("save_file")
  ) {
    return "edit"
  }
  if (name.includes("browser") || name.includes("aside") || name.includes("scrape")) {
    return "browser"
  }
  if (name.includes("device") || name.includes("mac") || name.includes("computer")) {
    return "device"
  }
  return "other"
}

/** Extracts the command string from command-related tool call arguments. */
export function extractToolCommand(args?: Record<string, unknown> | null): string {
  if (!args) return ""
  if (typeof args.CommandLine === "string") return args.CommandLine
  if (typeof args.command === "string") return args.command
  if (typeof args.cmd === "string") return args.cmd
  if (typeof args.input === "string") return args.input
  if (typeof args.script === "string") return args.script
  return ""
}

/** Extracts file path from tool arguments. */
export function extractToolPath(args?: Record<string, unknown> | null): string {
  if (!args) return ""
  if (typeof args.Path === "string") return args.Path
  if (typeof args.path === "string") return args.path
  if (typeof args.filePath === "string") return args.filePath
  if (typeof args.target === "string") return args.target
  if (typeof args.file === "string") return args.file
  return ""
}

/** Extracts search query from tool arguments. */
export function extractSearchQuery(args?: Record<string, unknown> | null): { query: string; target?: string } {
  if (!args) return { query: "" }
  const query =
    typeof args.query === "string"
      ? args.query
      : typeof args.pattern === "string"
        ? args.pattern
        : typeof args.glob === "string"
          ? args.glob
          : ""
  const target =
    typeof args.path === "string"
      ? args.path
      : typeof args.dir === "string"
        ? args.dir
        : typeof args.target === "string"
          ? args.target
          : undefined
  return { query, target }
}

/**
 * Builds the natural-language aggregation sentence:
 * e.g. "Ran 2 commands, searched code 1 time, and performed 2 other actions"
 */
export function buildActionSummarySentence(
  calls: ToolCallView[],
  _hasThinking: boolean,
  isStreaming: boolean,
): { summary: string; hasFailure: boolean; failedCount: number } {
  const failedCount = calls.filter((c) => c.status === "error").length
  const hasFailure = failedCount > 0

  if (!calls.length) {
    return {
      summary: isStreaming ? "Thinking" : "Thought",
      hasFailure: false,
      failedCount: 0,
    }
  }

  // Count by category
  const counts: Record<ActionToolKind, number> = {
    command: 0,
    "code-search": 0,
    search: 0,
    read: 0,
    edit: 0,
    browser: 0,
    device: 0,
    other: 0,
  }

  for (const call of calls) {
    const kind = classifyToolKind(call.toolName, call.args)
    counts[kind] += 1
  }

  const formatKindLabel = (kind: ActionToolKind, n: number): string => {
    switch (kind) {
      case "command":
        return `Ran ${n} ${n === 1 ? "command" : "commands"}`
      case "code-search":
        return `Searched code ${n} ${n === 1 ? "time" : "times"}`
      case "search":
        return `Searched the web ${n} ${n === 1 ? "time" : "times"}`
      case "read":
        return `Read ${n} ${n === 1 ? "file" : "files"}`
      case "edit":
        return `Changed ${n} ${n === 1 ? "file" : "files"}`
      case "browser":
        return `Used browser ${n} ${n === 1 ? "time" : "times"}`
      case "device":
        return `Used device controls ${n} ${n === 1 ? "time" : "times"}`
      default:
        return `Used ${n} ${n === 1 ? "tool" : "tools"}`
    }
  }

  // Order of prominence
  const priorityOrder: ActionToolKind[] = [
    "command",
    "code-search",
    "search",
    "edit",
    "read",
    "browser",
    "device",
    "other",
  ]
  const activeKinds = priorityOrder.filter((kind) => counts[kind] > 0)

  // Take top two for headline
  const topTwo = activeKinds.slice(0, 2)
  const topLabels = topTwo.map((k) => formatKindLabel(k, counts[k]))

  const accountedCount = topTwo.reduce((sum, k) => sum + counts[k], 0)
  const remainder = calls.length - accountedCount

  const clauses = [...topLabels]
  if (remainder > 0) {
    clauses.push(`performed ${remainder} other ${remainder === 1 ? "action" : "actions"}`)
  }

  let summary = ""
  if (clauses.length === 1 && clauses[0]) {
    summary = clauses[0]
  } else if (clauses.length === 2 && clauses[0] && clauses[1]) {
    const second = clauses[1].charAt(0).toLowerCase() + clauses[1].slice(1)
    summary = `${clauses[0]} and ${second}`
  } else if (clauses.length > 2 && clauses[0]) {
    const lastClause = clauses[clauses.length - 1] || ""
    const last = lastClause.charAt(0).toLowerCase() + lastClause.slice(1)
    const middle = clauses.slice(1, -1).map((c) => c.charAt(0).toLowerCase() + c.slice(1))
    summary = `${clauses[0]}, ${middle.join(", ")}, and ${last}`
  }

  return { summary, hasFailure, failedCount }
}

/** Formats a compact duration, e.g. "3.5s", "47s", "1m 3s", "3m 13s". */
export function formatActionDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  if (totalSeconds < 60) {
    if (ms < 10_000 && ms % 1000 >= 100) {
      return `${(ms / 1000).toFixed(1)}s`
    }
    return `${Math.max(1, totalSeconds)}s`
  }
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (seconds === 0) return `${minutes}m`
  return `${minutes}m ${seconds}s`
}

/** Format large numbers cleanly like +2k -0. */
export function formatDiffNumber(num: number): string {
  if (Math.abs(num) >= 1000) {
    const k = (num / 1000).toFixed(1).replace(/\.0$/, "")
    return `${k}k`
  }
  return num.toString()
}

/**
 * Extracts changed files and diff stats from tool calls and tool outputs.
 */
export function extractChangedFiles(calls: ToolCallView[]): ChangedFilesSummary {
  const fileMap = new Map<string, ChangedFileStat>()

  for (const call of calls) {
    const name = call.toolName.toLowerCase()
    const args = call.args || {}

    if (name.includes("write") || name.includes("create_file")) {
      const rawPath = extractToolPath(args)
      if (rawPath) {
        const cleanPath = rawPath.replace(/^\/Users\/[^/]+\/[^/]+\//, "")
        const content =
          typeof args.Content === "string" ? args.Content : typeof args.content === "string" ? args.content : ""
        const lines = content ? content.split("\n").length : 1
        const parts = cleanPath.split("/")
        const fileName = parts.pop() || cleanPath
        const dir = parts.join("/") || "."

        const existing = fileMap.get(cleanPath)
        if (existing) {
          existing.additions += lines
        } else {
          fileMap.set(cleanPath, {
            path: cleanPath,
            name: fileName,
            dir,
            additions: lines,
            deletions: 0,
            isNew: true,
          })
        }
      }
    } else if (name.includes("edit") || name.includes("patch")) {
      const rawPath = extractToolPath(args)
      if (rawPath) {
        const cleanPath = rawPath.replace(/^\/Users\/[^/]+\/[^/]+\//, "")
        const target =
          typeof args.Target === "string" ? args.Target : typeof args.target === "string" ? args.target : ""
        const replacement =
          typeof args.Replacement === "string"
            ? args.Replacement
            : typeof args.replacement === "string"
              ? args.replacement
              : ""
        const added = replacement ? replacement.split("\n").length : 0
        const deleted = target ? target.split("\n").length : 0
        const parts = cleanPath.split("/")
        const fileName = parts.pop() || cleanPath
        const dir = parts.join("/") || "."

        const existing = fileMap.get(cleanPath)
        if (existing) {
          existing.additions += added
          existing.deletions += deleted
        } else {
          fileMap.set(cleanPath, {
            path: cleanPath,
            name: fileName,
            dir,
            additions: added,
            deletions: deleted,
            isNew: false,
          })
        }
      }
    }
  }

  const files = Array.from(fileMap.values())
  const totalAdditions = files.reduce((acc, f) => acc + f.additions, 0)
  const totalDeletions = files.reduce((acc, f) => acc + f.deletions, 0)

  return {
    files,
    totalFiles: files.length,
    totalAdditions,
    totalDeletions,
  }
}
