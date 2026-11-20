import { readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { HttpError, RpcError, SayabotClient, type ToolCallResult } from "./client.js"
import { serveMcpStdio } from "./stdio.js"

/**
 * The `sayabot` command. Two things live here:
 *
 *  - `sayabot mcp` — a stdio MCP server. Add it to Claude Desktop, Codex, Cursor or any other MCP
 *    client and that client drives a Sayabot room as the agent whose key it was given.
 *  - one-shot commands (`check-in`, `inbox`, `post`, …) for shells, cron jobs and scripts.
 *
 * Both go through the orchestrator's existing `/v1/mcp` endpoint with an agent API key, so the
 * key's `scopes` and `roomIds` are the whole permission model. This tool never talks to the
 * database, never sees a secret plaintext, and never needs the internal secret.
 */

export interface CliIo {
  stdin: NodeJS.ReadableStream
  stdout: NodeJS.WritableStream
  stderr: NodeJS.WritableStream
  env: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
}

const DEFAULT_URL = "http://127.0.0.1:8787"

const USAGE = `sayabot — drive a Sayabot room from a terminal or an MCP client

Usage
  sayabot mcp                     stdio MCP server (add this to your MCP client)
  sayabot check-in                who you are, unread mentions, tasks, open decisions
  sayabot inbox                   everything new since your last check
  sayabot rooms                   rooms this key can reach
  sayabot post "text"             post a message to the room
  sayabot bots                    workspace bots (orchestrator agents only)
  sayabot usage                   this month's turns, tokens and cost
  sayabot new-bot "Name"          create a bot        (--handle scout)
  sayabot new-room "Name"         create a room
  sayabot wait                    idle until the room needs you (--timeout secs)
  sayabot tools [--json]          list the MCP tools this key can call
  sayabot call <tool> --args '{}' call any tool directly
  sayabot whoami                  identity behind the key

Options
  --url <url>        orchestrator base URL          (default ${DEFAULT_URL}, env SAYABOT_URL)
  --key <key>        agent API key                  (env SAYABOT_AGENT_KEY)
  --key-file <path>  read the key from a file       (must not be group/world readable)
  --room <room>      room id or name, for one-shot commands
  --handle <handle>  bot handle, for new-bot
  --thread <id>      reply inside a thread          (post)
  --arg k=v          one tool argument, repeatable  (call/mcp arguments)
  --args '<json>'    a whole argument object        (call)
  --timeout <secs>   wait_for_activity window       (wait)
  --json             print the raw tool result
  -h, --help         this text
  -v, --version      version

Exit codes
  0 success · 1 the tool or request failed · 2 bad usage

Examples
  export SAYABOT_URL=http://127.0.0.1:8787 SAYABOT_AGENT_KEY=saaya_ak_...
  sayabot check-in
  sayabot post "Deploy is green, moving to staging"
  sayabot call list_tasks --arg status=open
`

class UsageError extends Error {}

const VALUE_FLAGS = new Set([
  "--url",
  "--key",
  "--key-file",
  "--room",
  "--handle",
  "--thread",
  "--args",
  "--timeout",
])
const BOOL_FLAGS = new Set(["--json", "--help", "-h", "--version", "-v"])

interface ParsedArgs {
  flags: Map<string, string[]>
  positional: string[]
}

function pushFlag(flags: Map<string, string[]>, name: string, value: string): void {
  const existing = flags.get(name)
  if (existing) existing.push(value)
  else flags.set(name, [value])
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>()
  const positional: string[] = []

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === undefined) break
    if (token === "--") {
      positional.push(...argv.slice(index + 1))
      break
    }
    if (token === "--arg") {
      const value = argv[++index]
      if (value === undefined) throw new UsageError("--arg needs key=value")
      pushFlag(flags, "--arg", value)
      continue
    }
    if (token.startsWith("--") && token.includes("=")) {
      const at = token.indexOf("=")
      const name = token.slice(0, at)
      if (!VALUE_FLAGS.has(name)) throw new UsageError(`unknown flag ${name}`)
      pushFlag(flags, name, token.slice(at + 1))
      continue
    }
    if (BOOL_FLAGS.has(token)) {
      pushFlag(flags, token, "true")
      continue
    }
    if (VALUE_FLAGS.has(token)) {
      const value = argv[++index]
      if (value === undefined) throw new UsageError(`${token} needs a value`)
      pushFlag(flags, token, value)
      continue
    }
    if (token.startsWith("-") && token !== "-") throw new UsageError(`unknown flag ${token}`)
    positional.push(token)
  }

  return { flags, positional }
}

/** The package version, read next to the emitted file (`dist/` or `src/` both sit one level down). */
function packageVersion(): string {
  try {
    const path = fileURLToPath(new URL("../package.json", import.meta.url))
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { version?: string }
    return manifest.version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

function flag(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.flags.get(name)?.at(-1)
}

function has(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.has(name)
}

/** Reads the key, preferring an explicit flag so a shell export cannot be silently overridden. */
function resolveKey(parsed: ParsedArgs, io: CliIo): string {
  const fromFlag = flag(parsed, "--key")?.trim()
  if (fromFlag) return fromFlag

  const keyFile = flag(parsed, "--key-file")
  if (keyFile) {
    const stats = statSync(keyFile)
    if ((stats.mode & 0o077) !== 0) {
      io.stderr.write(`sayabot: warning: ${keyFile} is readable by other users; chmod 600 it\n`)
    }
    return readFileSync(keyFile, "utf8").trim()
  }

  const fromEnv = io.env.SAYABOT_AGENT_KEY?.trim() || io.env.SAYABOT_API_KEY?.trim()
  if (fromEnv) return fromEnv

  throw new UsageError(
    "no agent key. Set SAYABOT_AGENT_KEY, or pass --key / --key-file.\n" +
      "Create one in the web app: Settings → Bots → API keys.",
  )
}

function resolveUrl(parsed: ParsedArgs, io: CliIo): string {
  const url = (flag(parsed, "--url") ?? io.env.SAYABOT_URL ?? DEFAULT_URL).trim()
  if (!/^https?:\/\//i.test(url))
    throw new UsageError(`--url must start with http:// or https:// (got ${url})`)

  // A bearer key over plain HTTP is fine on loopback and careless anywhere else.
  const loopback = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(url)
  if (url.toLowerCase().startsWith("http://") && !loopback) {
    io.stderr.write(
      `sayabot: warning: sending your agent key over plain HTTP to ${url}; use https or a tunnel\n`,
    )
  }
  return url
}

function roomArgs(parsed: ParsedArgs): Record<string, unknown> {
  const room = flag(parsed, "--room")
  if (!room) return {}
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(room)
  return isUuid ? { room_id: room } : { room }
}

function parseArgValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function toolArguments(parsed: ParsedArgs): Record<string, unknown> {
  const raw = flag(parsed, "--args")
  let args: Record<string, unknown> = {}
  if (raw) {
    let parsedArgs: unknown
    try {
      parsedArgs = JSON.parse(raw)
    } catch {
      throw new UsageError("--args must be a JSON object")
    }
    if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
      throw new UsageError("--args must be a JSON object")
    }
    args = { ...(parsedArgs as Record<string, unknown>) }
  }

  for (const pair of parsed.flags.get("--arg") ?? []) {
    const at = pair.indexOf("=")
    if (at <= 0) throw new UsageError(`--arg needs key=value (got ${pair})`)
    args[pair.slice(0, at)] = parseArgValue(pair.slice(at + 1))
  }

  return { ...roomArgs(parsed), ...args }
}

function write(stream: NodeJS.WritableStream, text: string): void {
  stream.write(text.endsWith("\n") ? text : `${text}\n`)
}

function renderResult(result: ToolCallResult): string {
  const structured = result.structuredContent
  if (structured !== undefined && structured !== null) return JSON.stringify(structured, null, 2)
  const text = (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim()
  return text || "(no output)"
}

function renderTools(tools: Array<{ name: string; title?: string; description?: string }>): string {
  const width = Math.min(28, Math.max(...tools.map((tool) => tool.name.length), 4))
  return tools
    .map((tool) => {
      const summary = (tool.description ?? tool.title ?? "").split("\n")[0] ?? ""
      return `${tool.name.padEnd(width)}  ${summary.length > 96 ? `${summary.slice(0, 93)}...` : summary}`.trimEnd()
    })
    .join("\n")
}

async function runOneShot(
  command: string,
  parsed: ParsedArgs,
  client: SayabotClient,
  io: CliIo,
): Promise<number> {
  const asJson = has(parsed, "--json")
  const room = roomArgs(parsed)

  const call = async (tool: string, args: Record<string, unknown>): Promise<number> => {
    const result = await client.callTool(tool, args)
    if (result.isError) {
      write(io.stderr, `sayabot: ${tool} failed: ${renderResult(result)}`)
      return 1
    }
    write(io.stdout, asJson ? JSON.stringify(result, null, 2) : renderResult(result))
    return 0
  }

  switch (command) {
    case "check-in":
    case "check_in":
      return await call("check_in", room)

    case "inbox":
      return await call("get_inbox", {})

    case "rooms":
      return await call("list_rooms", {})

    case "whoami":
      return await call("whoami", {})

    // Workspace admin. These tools only exist for the built-in orchestrator agent, so a key
    // belonging to any other bot gets the server's "Unknown tool" error.
    case "bots":
      return await call("sayabot_bots", {})

    case "usage":
      return await call("sayabot_usage", {})

    case "new-bot": {
      const displayName = parsed.positional.slice(1).join(" ").trim()
      if (!displayName)
        throw new UsageError('sayabot new-bot needs a name, e.g. sayabot new-bot "Scout"')
      const derived = displayName
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
      return await call("sayabot_create_bot", {
        ...toolArguments(parsed),
        display_name: displayName,
        handle: flag(parsed, "--handle") ?? derived,
      })
    }

    case "new-room": {
      const name = parsed.positional.slice(1).join(" ").trim()
      if (!name)
        throw new UsageError('sayabot new-room needs a name, e.g. sayabot new-room "Planning"')
      return await call("sayabot_create_room", { ...toolArguments(parsed), name })
    }

    case "post": {
      const content = parsed.positional.slice(1).join(" ").trim()
      if (!content) throw new UsageError('sayabot post needs a message, e.g. sayabot post "hello"')
      const thread = flag(parsed, "--thread")
      return await call("post_message", {
        ...room,
        content,
        ...(thread ? { thread_id: thread } : {}),
      })
    }

    case "wait": {
      const seconds = Number(flag(parsed, "--timeout") ?? "50")
      if (!Number.isFinite(seconds) || seconds <= 0)
        throw new UsageError("--timeout must be a positive number of seconds")
      return await call("wait_for_activity", {
        ...room,
        timeout_ms: Math.min(60_000, Math.max(1_000, Math.round(seconds * 1000))),
      })
    }

    case "tools": {
      const tools = await client.listTools()
      if (asJson) {
        write(io.stdout, JSON.stringify(tools, null, 2))
      } else if (tools.length === 0) {
        write(io.stdout, "This key can reach no tools.")
      } else {
        write(io.stdout, renderTools(tools))
      }
      return 0
    }

    case "call": {
      const tool = parsed.positional[1]
      if (!tool)
        throw new UsageError("sayabot call needs a tool name; run `sayabot tools` to see them")
      return await call(tool, toolArguments(parsed))
    }

    default:
      throw new UsageError(`unknown command: ${command}`)
  }
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed: ParsedArgs
  try {
    parsed = parseArgs(argv)
  } catch (error) {
    write(io.stderr, `sayabot: ${error instanceof Error ? error.message : String(error)}`)
    write(io.stderr, "Run `sayabot --help`.")
    return 2
  }

  if (has(parsed, "--version") || has(parsed, "-v")) {
    write(io.stdout, `sayabot ${packageVersion()}`)
    return 0
  }

  const command = parsed.positional[0]
  if (!command || command === "help" || has(parsed, "--help") || has(parsed, "-h")) {
    write(io.stdout, USAGE)
    return command && !has(parsed, "--help") && !has(parsed, "-h") ? 2 : 0
  }

  try {
    const url = resolveUrl(parsed, io)
    const key = resolveKey(parsed, io)
    const client = new SayabotClient({ url, key, fetchImpl: io.fetchImpl })

    if (command === "mcp") {
      // stdout belongs to the protocol from here on; every diagnostic goes to stderr.
      write(io.stderr, `sayabot mcp: ${client.endpoint} (stdio JSON-RPC)`)
      await serveMcpStdio({
        post: (payload) => client.post(payload),
        input: io.stdin,
        output: io.stdout,
        log: (message) => write(io.stderr, `sayabot mcp: ${message}`),
      })
      return 0
    }

    return await runOneShot(command, parsed, client, io)
  } catch (error) {
    if (error instanceof UsageError) {
      write(io.stderr, `sayabot: ${error.message}`)
      write(io.stderr, "Run `sayabot --help`.")
      return 2
    }
    if (error instanceof RpcError) {
      write(io.stderr, `sayabot: ${error.message}`)
      return 1
    }
    if (error instanceof HttpError) {
      write(io.stderr, `sayabot: ${error.message}`)
      return 1
    }
    write(io.stderr, `sayabot: ${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}
