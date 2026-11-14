/**
 * Mac-run tool cards, safe to use in the browser: the hidden `_mac` marker the orchestrator puts
 * on them, a plain description of each step, and the "always allow" rule a step would save.
 */

export interface MacMarker {
  key: string
  jobId: string
  hostId: string
  hostName: string
  /** The Mac's owner: the only person who can answer its approvals. */
  ownerId: string | null
  agentId: string
}

export function readMacMarker(args: unknown): MacMarker | null {
  if (!args || typeof args !== "object") return null
  const mark = (args as Record<string, unknown>)._mac
  if (!mark || typeof mark !== "object") return null
  const m = mark as Record<string, unknown>
  if (typeof m.hostId !== "string" || typeof m.agentId !== "string") return null
  return {
    key: String(m.key ?? ""),
    jobId: String(m.jobId ?? ""),
    hostId: m.hostId,
    hostName: typeof m.hostName === "string" ? m.hostName : "this computer",
    ownerId: typeof m.ownerId === "string" ? m.ownerId : null,
    agentId: m.agentId,
  }
}

/** The card's arguments without the hidden marker. */
export function withoutMacMarker(args: unknown): unknown {
  if (!args || typeof args !== "object" || !("_mac" in args)) return args
  const { _mac: _hidden, ...rest } = args as Record<string, unknown>
  return rest
}

function str(args: unknown, key: string): string | null {
  if (!args || typeof args !== "object") return null
  const value = (args as Record<string, unknown>)[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function short(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function baseName(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path
}

/** Sayabot's own tools reached over MCP, named the way the room shows them. */
function sayabotTool(toolName: string): string | null {
  const match = /^mcp__sayabot__(\w+)$/.exec(toolName)
  return match?.[1] ? match[1].replace(/_/g, " ") : null
}

/** One line for a Mac step, e.g. "Run `npm test` on Anurag's MacBook". */
export function describeMacStep(toolName: string, args: unknown): string {
  const mark = readMacMarker(args)
  const where = mark ? ` on ${mark.hostName}` : ""
  const sayabot = sayabotTool(toolName)
  if (sayabot) return `Use Sayabot: ${sayabot}`
  switch (toolName) {
    case "Bash":
    case "command_execution": {
      const command = str(args, "command")
      return command ? `Run \`${short(command, 100)}\`${where}` : `Run a command${where}`
    }
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "NotebookEdit":
    case "file_change": {
      const file = str(args, "file_path") ?? str(args, "path") ?? str(args, "notebook_path")
      const verb = toolName === "Write" ? "Write" : "Edit"
      return file ? `${verb} ${baseName(file)}${where}` : `${verb} a file${where}`
    }
    case "Read": {
      const file = str(args, "file_path")
      return file ? `Read ${baseName(file)}` : "Read a file"
    }
    case "Glob":
    case "Grep":
      return `Search files for ${short(str(args, "pattern") ?? "a pattern", 60)}`
    case "WebFetch": {
      const url = str(args, "url")
      return url ? `Open ${short(url, 80)}` : "Open a web page"
    }
    case "WebSearch":
      return `Search the web for ${short(str(args, "query") ?? "something", 60)}`
    case "TodoWrite":
      return "Update its to-do list"
    case "Task":
      return `Start a helper: ${short(str(args, "description") ?? "subtask", 60)}`
    default: {
      const mcp = /^mcp__([\w-]+)__(\w+)$/.exec(toolName)
      if (mcp?.[2]) return `Use ${mcp[1]}: ${mcp[2].replace(/_/g, " ")}`
      return `Use ${toolName}${where}`
    }
  }
}

/** Shell operators that chain commands: such a command can only be allowed once. */
const CHAINED = /[;&|`]|\$\(|>|</

/**
 * The rule "Always allow" saves, in Claude Code's --allowedTools syntax, or null when a step
 * can only be allowed once. Commands are allowed by their leading words (`Bash(npm test:*)`),
 * web pages by site, other steps by tool.
 */
export function macAllowRuleFor(toolName: string, args: unknown): string | null {
  if (toolName === "Bash") {
    const command = str(args, "command")
    if (!command || CHAINED.test(command) || command.length > 200) return null
    const words = command.split(/\s+/).filter(Boolean)
    const first = words[0]
    if (!first || !/^[\w./-]+$/.test(first)) return null
    if (first === "sudo" || first === "rm") return null
    const second = words[1]
    const prefix =
      second && /^[\w.:/-]+$/.test(second) && !second.startsWith("-") ? `${first} ${second}` : first
    return `Bash(${prefix}:*)`
  }
  if (toolName === "WebFetch") {
    const url = str(args, "url")
    try {
      const host = url ? new URL(url).hostname : null
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

/** How the "always allow" button reads for a step, or null when there's no such option. */
export function macAllowLabel(toolName: string, args: unknown): string | null {
  const rule = macAllowRuleFor(toolName, args)
  if (!rule) return null
  const bash = /^Bash\((.+):\*\)$/.exec(rule)
  if (bash) return `Always allow \`${bash[1]}\``
  const site = /^WebFetch\(domain:(.+)\)$/.exec(rule)
  if (site) return `Always allow ${site[1]}`
  if (rule === "Edit" || rule === "MultiEdit" || rule === "Write") return "Always allow file edits"
  return "Always allow this"
}
