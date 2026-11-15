import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import {
  AcpConnection,
  acpModels,
  acpUpdate,
  effortRequest,
  initializeParams,
  isAuthError,
  modelRequest,
  permissionOutcome,
  toolName,
} from "./acp"
import type { DesktopHost } from "./host"
import { toolPath } from "./bin-path"
import { agentSpec, findBinary, type AgentSpec } from "./local-agents"
import { localServerUrl } from "./local-models"
import {
  allowedByRules,
  allowRuleFor,
  isReadOnlyStep,
  parseClaudeLine,
  parseCodexLine,
  type Activity,
  type StreamUpdate,
} from "./mac-stream"

/**
 * The local runner: agents set to run on this computer answer through an agent app signed in
 * here (Claude Code, Codex, GitHub Copilot, Command Code, Cursor, Gemini CLI, OpenCode, Mistral
 * Vibe, Grok, Kimi, Kiro, Droid, Devin, Cline, Qwen, Hermes, OMP, pi, DeepSeek Harness), on the
 * person's own subscription or keys. Each agent works in its own folder (~/Sayabot/agents/<handle>).
 *
 * Apps that speak the Agent Client Protocol run through acp.ts: their reply streams into the room,
 * their steps show up as live cards, and every permission they ask for becomes an approval card.
 *
 * Claude Code and Codex also get Sayabot's room tools (tasks, canvas, decisions, facts) through a
 * one-run token, and every step they take shows up live in the room. Anything Claude wants to do
 * that needs permission (a command, an edit, a web page) becomes an approval card the owner can
 * answer from the web, the phone or this Mac; nothing risky runs without a yes. Codex keeps its
 * sandbox: it can only write inside the agent's folder, with no network.
 */

interface Job {
  id: string
  prompt: string
  app: string
  /** The model inside the app; null/absent keeps the app's own default. */
  model?: string | null
  /** Thinking effort for apps that take one; absent keeps the app's default. */
  effort?: string | null
  agentHandle: string
  agentName?: string
  /** Sayabot's room tools for this run (null for apps without MCP, or if it couldn't be made). */
  mcp?: { url: string; token: string } | null
  /** Steps the owner chose "always allow" for, in Claude Code's --allowedTools syntax. */
  allow?: string[]
  /**
   * The chat's permissions as this Mac applies them (the server already checked that auto/turbo
   * were picked by this Mac's owner): review = ask about every step, ask = ask about risky steps,
   * auto = read-only steps run on their own, turbo = everything runs. Absent on older servers = ask.
   */
  permissions?: "review" | "ask" | "auto" | "turbo"
  room?: { id: string; name: string; path: string | null } | null
}

export interface ApprovalNotice {
  agentName: string
  step: string
  roomPath: string | null
}

/*
 * No time limit on runs: they use this Mac and the person's own app subscription, like running
 * the app in a terminal. A run ends when the app finishes, someone presses stop in the room, or
 * the Mac app quits (the server notices a Mac that stops checking in).
 */
const PROGRESS_MS = 1_500
const EVENTS_MS = 700
const APPROVAL_POLL_MS = 1_500
// A little longer than the server's 30-minute window, so the server decides first.
const APPROVAL_WAIT_MS = 30 * 60_000 + 30_000

/** Sayabot room tools an app must not call in its own turn (its reply is posted for it). */
const BLOCKED_ROOM_TOOLS = ["post_message", "wait_for_activity", "use_secret"]
const TOKEN_ENV = "SAYABOT_MCP_TOKEN"

/** Model ids and effort levels reach a command line, so only plain ones pass. */
const MODEL_ID = /^[\w.:/@+[\]-]{1,160}$/
const EFFORT = /^[a-z]{1,10}$/

export function jobModel(job: Pick<Job, "model">): string | null {
  return job.model && job.model !== "default" && MODEL_ID.test(job.model) ? job.model : null
}

export function jobEffort(job: Pick<Job, "effort">): string | null {
  return job.effort && EFFORT.test(job.effort) ? job.effort : null
}

/** argv + whether the prompt goes on stdin, for the apps that answer in plain text. */
export function commandFor(
  app: string,
  prompt: string,
  lastMessageFile: string,
  model: string | null = null,
): { bin: string; args: string[]; stdin: string | null } {
  switch (app) {
    case "codex":
      return {
        bin: "codex",
        args: [
          "exec",
          "--skip-git-repo-check",
          ...(model ? ["--model", model] : []),
          "--output-last-message",
          lastMessageFile,
          "-",
        ],
        stdin: prompt,
      }
    case "gemini":
      return {
        bin: "gemini",
        args: [
          ...(model ? ["-m", model] : []),
          "-p",
          "Answer the request given on standard input.",
        ],
        stdin: prompt,
      }
    case "opencode":
      return {
        bin: "opencode",
        args: ["run", ...(model ? ["-m", model] : []), prompt.slice(-100_000)],
        stdin: null,
      }
    case "pi":
      return {
        bin: "pi",
        args: ["-p", ...(model ? ["--model", model] : []), prompt.slice(-100_000)],
        stdin: null,
      }
    case "cursor":
      // No --force: Cursor proposes changes but doesn't apply them on its own.
      return {
        bin: "cursor-agent",
        args: [
          "-p",
          "--output-format",
          "text",
          ...(model ? ["--model", model] : []),
          prompt.slice(-100_000),
        ],
        stdin: null,
      }
    case "claude-code":
    default:
      return {
        bin: "claude",
        args: ["-p", "--output-format", "text", ...(model ? ["--model", model] : [])],
        stdin: prompt,
      }
  }
}

/** Claude Code with Sayabot's tools, the approval prompt and live steps. */
export function claudeArgs(job: Job, mcpConfigPath: string): string[] {
  const allowed = [...(job.mcp ? ["mcp__sayabot"] : []), ...(job.allow ?? [])]
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-mode",
    "default",
    "--no-session-persistence",
    "--mcp-config",
    mcpConfigPath,
    "--strict-mcp-config",
    "--permission-prompt-tool",
    "mcp__sayabot_mac__approve",
    ...(allowed.length ? ["--allowedTools", allowed.join(",")] : []),
    ...(job.mcp
      ? ["--disallowedTools", BLOCKED_ROOM_TOOLS.map((t) => `mcp__sayabot__${t}`).join(",")]
      : []),
    // The agent's folder settings only: the person's own hooks and plugins stay out of agent runs.
    "--setting-sources",
    "project,local",
    ...(jobModel(job) ? ["--model", jobModel(job) as string] : []),
    ...(jobEffort(job) ? ["--effort", jobEffort(job) as string] : []),
  ]
}

/** Codex with Sayabot's tools; its sandbox keeps writes inside the agent's folder. */
export function codexArgs(job: Job): string[] {
  const mcp = job.mcp
    ? [
        "-c",
        `mcp_servers.sayabot.url=${JSON.stringify(job.mcp.url)}`,
        "-c",
        `mcp_servers.sayabot.bearer_token_env_var=${JSON.stringify(TOKEN_ENV)}`,
        "-c",
        `mcp_servers.sayabot.disabled_tools=${JSON.stringify(BLOCKED_ROOM_TOOLS)}`,
        "-c",
        'mcp_servers.sayabot.default_tools_approval_mode="approve"',
      ]
    : []
  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "workspace-write",
    ...(jobModel(job) ? ["--model", jobModel(job) as string] : []),
    ...(jobEffort(job) ? ["-c", `model_reasoning_effort=${JSON.stringify(jobEffort(job))}`] : []),
    ...mcp,
    "-",
  ]
}

function agentFolder(handle: string): string {
  const safe = handle.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "agent"
  const dir = path.join(os.homedir(), "Sayabot", "agents", safe)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function failureHint(bin: string, stderr: string, code: number | null): string {
  if (/log ?in|auth|sign ?in|unauthori|invalid_grant|expired/i.test(stderr)) {
    return `${bin} isn't signed in on this computer. Open it once in a terminal and sign in.`
  }
  return (
    stderr.trim().split("\n").slice(-3).join(" ").slice(0, 500) || `${bin} exited with code ${code}`
  )
}

/** A one-line description of a step for the Mac notification. */
function describeStep(toolName: string, input: Record<string, unknown>): string {
  const command = typeof input.command === "string" ? input.command : null
  const file = typeof input.file_path === "string" ? input.file_path : null
  const url = typeof input.url === "string" ? input.url : null
  if (toolName === "Bash" && command)
    return `run \`${command.length > 80 ? `${command.slice(0, 80)}…` : command}\``
  if (file) return `${toolName === "Write" ? "write" : "edit"} ${path.basename(file)}`
  if (url) return `open ${url}`
  return `use ${toolName}`
}

export class LocalRunner {
  private busy = false
  private child: ChildProcess | null = null
  private abortLocal: (() => void) | null = null

  constructor(
    private host: DesktopHost,
    private notify: (notice: ApprovalNotice) => void = () => {},
  ) {}

  get running(): boolean {
    return this.busy
  }

  /** Called after each heartbeat; runs one job at a time. */
  async maybeRun(queuedJobs: number, enabled: boolean): Promise<void> {
    if (this.busy || !enabled || queuedJobs <= 0) return
    this.busy = true
    try {
      const claimed = await this.host.post<{ job: Job | null }>("/api/desktop/jobs/claim", {})
      if (!claimed?.job) return
      const spec = agentSpec(claimed.job.app)
      if (claimed.job.app === "claude-code" || claimed.job.app === "codex")
        await this.runWithTools(claimed.job)
      else if (localServerUrl(claimed.job.app)) await this.runLocalModel(claimed.job)
      else if (spec?.run.kind === "acp") await this.runAcp(claimed.job, spec, spec.run.args)
      else await this.runPlain(claimed.job)
    } finally {
      this.busy = false
    }
  }

  stop(): void {
    this.child?.kill("SIGTERM")
    this.abortLocal?.()
  }

  private finish(job: Job, body: Record<string, unknown>): Promise<unknown> {
    return this.host.post(`/api/desktop/jobs/${job.id}`, body)
  }

  // ---------- Claude Code / Codex: room tools, live steps, approvals ----------

  private async runWithTools(job: Job): Promise<void> {
    const isClaude = job.app === "claude-code"
    const binName = isClaude ? "claude" : "codex"
    const bin = await findBinary(binName)
    if (!bin) {
      await this.finish(job, {
        status: "failed",
        error: `${binName} isn't installed on this computer.`,
      })
      return
    }

    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "sayabot-run-"))
    fs.chmodSync(scratch, 0o700)
    let approvals: net.Server | null = null
    const sessionRules = [...(job.allow ?? [])]
    let cancelled = false

    // Steps go to the room in small batches.
    let pending: Activity[] = []
    const flush = async () => {
      if (!pending.length) return
      const events = pending
      pending = []
      await this.host.post(`/api/desktop/jobs/${job.id}/events`, { events })
    }
    const eventsTimer = setInterval(() => void flush(), EVENTS_MS)

    try {
      let args: string[]
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: toolPath(bin),
        NO_COLOR: "1",
      }
      if (isClaude) {
        const socketPath = path.join(scratch, "approve.sock")
        approvals = await this.listenForApprovals(
          socketPath,
          job,
          sessionRules,
          () => cancelled,
          () => flush(),
        )
        const configPath = path.join(scratch, "mcp.json")
        const servers: Record<string, unknown> = {
          sayabot_mac: {
            command: process.execPath,
            args: [path.join(__dirname, "approve-mcp.js")],
            env: { ELECTRON_RUN_AS_NODE: "1", SAYABOT_APPROVAL_SOCKET: socketPath },
          },
        }
        if (job.mcp) {
          servers.sayabot = {
            type: "http",
            url: job.mcp.url,
            headers: { Authorization: `Bearer ${job.mcp.token}` },
          }
        }
        fs.writeFileSync(configPath, JSON.stringify({ mcpServers: servers }), { mode: 0o600 })
        args = claudeArgs(job, configPath)
      } else {
        args = codexArgs(job)
        if (job.mcp) env[TOKEN_ENV] = job.mcp.token
      }

      const child = spawn(bin, args, {
        cwd: agentFolder(job.agentHandle),
        env,
        stdio: ["pipe", "pipe", "pipe"],
      })
      this.child = child
      let live = ""
      let lastMessage = ""
      let done: StreamUpdate["done"] | null = null
      let stderr = ""
      let partial = ""
      const parseLine = isClaude ? parseClaudeLine : parseCodexLine

      child.stdout?.on("data", (chunk: Buffer) => {
        partial += chunk.toString("utf8")
        const lines = partial.split("\n")
        partial = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const update = parseLine(line)
          if (update.delta) live += update.delta
          if (update.message) {
            lastMessage = update.message
            // Codex sends whole messages only; Claude also streams them as deltas.
            if (!isClaude) live = live ? `${live}\n\n${update.message}` : update.message
          }
          if (update.activity.length) pending.push(...update.activity)
          if (update.done) done = update.done
        }
        if (live.length > 200_000) live = live.slice(-200_000)
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-4_000)
      })
      child.stdin?.end(job.prompt)

      let lastSent = ""
      const progress = setInterval(async () => {
        const text = live.trim()
        if (text === lastSent) {
          // Still ask now and then, so a stop in the room reaches us even while it's quiet.
          const reply = await this.host.post<{ cancelled?: boolean }>(
            `/api/desktop/jobs/${job.id}`,
            {},
          )
          if (reply?.cancelled) {
            cancelled = true
            child.kill("SIGTERM")
          }
          return
        }
        lastSent = text
        const reply = await this.host.post<{ cancelled?: boolean }>(`/api/desktop/jobs/${job.id}`, {
          output: text,
        })
        if (reply?.cancelled) {
          cancelled = true
          child.kill("SIGTERM")
        }
      }, PROGRESS_MS)

      const code: number | null = await new Promise((resolve) => {
        child.on("close", (c) => resolve(c))
        child.on("error", () => resolve(-1))
      })
      clearInterval(progress)
      this.child = null
      await flush()
      if (cancelled) return

      const finished = done as StreamUpdate["done"] | null
      const final = (finished?.text || lastMessage || live).trim()
      if (finished?.error || (code !== 0 && !final)) {
        const error = finished?.error
          ? finished.error.slice(0, 500)
          : failureHint(binName, stderr, code)
        await this.finish(job, { output: final, status: "failed", error })
      } else {
        await this.finish(job, { output: final, status: "done" })
      }
    } finally {
      clearInterval(eventsTimer)
      approvals?.close()
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  }

  /**
   * The socket approve-mcp.js talks to. Each request becomes an approval card in the room (and a
   * Mac notification); the answer goes back to Claude as allow or deny.
   */
  private listenForApprovals(
    socketPath: string,
    job: Job,
    sessionRules: string[],
    isCancelled: () => boolean,
    flushSteps: () => Promise<void>,
  ): Promise<net.Server> {
    const server = net.createServer((socket) => {
      let buffer = ""
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8")
        const newline = buffer.indexOf("\n")
        if (newline < 0) return
        const line = buffer.slice(0, newline)
        buffer = ""
        let request: { tool_name: string; input: Record<string, unknown>; tool_use_id: string }
        try {
          request = JSON.parse(line)
        } catch {
          socket.end(`${JSON.stringify({ behavior: "deny", message: "Unreadable request" })}\n`)
          return
        }
        void this.decide(job, request, sessionRules, isCancelled, flushSteps).then((answer) => {
          if (!socket.destroyed) socket.end(`${JSON.stringify(answer)}\n`)
        })
      })
      socket.on("error", () => {})
    })
    return new Promise((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, () => {
        try {
          fs.chmodSync(socketPath, 0o600)
        } catch {
          // the folder is 0700 already
        }
        resolve(server)
      })
    })
  }

  private async decide(
    job: Job,
    request: { tool_name: string; input: Record<string, unknown>; tool_use_id: string },
    sessionRules: string[],
    isCancelled: () => boolean,
    flushSteps: () => Promise<void>,
  ): Promise<
    | { behavior: "allow"; updatedInput: Record<string, unknown> }
    | { behavior: "deny"; message: string }
  > {
    const input = request.input ?? {}
    const permissions = job.permissions ?? "ask"
    // Turbo: the owner picked "run everything" for this chat on this Mac.
    if (permissions === "turbo") return { behavior: "allow", updatedInput: input }
    // Auto: steps that only look run on their own; anything that changes things still asks.
    if (permissions === "auto" && isReadOnlyStep(request.tool_name, input))
      return { behavior: "allow", updatedInput: input }
    // Allowed for good earlier in this run (Claude only learns rules at start). Request review
    // asks about every step, so remembered rules don't apply there.
    if (permissions !== "review" && allowedByRules(request.tool_name, input, sessionRules))
      return { behavior: "allow", updatedInput: input }

    // The step's card must exist before it turns into an approval.
    await flushSteps()
    const created = await this.host.post<{ toolCallId?: string }>(
      `/api/desktop/jobs/${job.id}/approvals`,
      {
        key: request.tool_use_id,
        toolName: request.tool_name,
        args: input,
      },
    )
    if (!created?.toolCallId) {
      return {
        behavior: "deny",
        message: "Couldn't reach Sayabot to ask the owner, so this wasn't allowed.",
      }
    }
    this.notify({
      agentName: job.agentName ?? `@${job.agentHandle}`,
      step: describeStep(request.tool_name, input),
      roomPath: job.room?.path ?? null,
    })

    const started = Date.now()
    while (Date.now() - started < APPROVAL_WAIT_MS && !isCancelled()) {
      await new Promise((r) => setTimeout(r, APPROVAL_POLL_MS))
      const state = await this.host.get<{
        status: string
        remembered?: boolean
        message?: string | null
      }>(`/api/desktop/jobs/${job.id}/approvals/${created.toolCallId}`)
      if (!state || state.status === "pending") continue
      if (state.status === "approved") {
        if (state.remembered) {
          const rule = allowRuleFor(request.tool_name, input)
          if (rule && !sessionRules.includes(rule)) sessionRules.push(rule)
        }
        return { behavior: "allow", updatedInput: input }
      }
      return { behavior: "deny", message: state.message || "The owner said no." }
    }
    return { behavior: "deny", message: "Nobody answered in time, so this wasn't allowed." }
  }

  // ---------- Agent Client Protocol apps: Copilot, Command Code, Vibe, Kimi, Kiro… ----------

  private async runAcp(job: Job, spec: AgentSpec, args: readonly string[]): Promise<void> {
    const bin = await findBinary(spec.bin)
    if (!bin) {
      await this.finish(job, {
        status: "failed",
        error: `${spec.name} isn't installed on this computer.`,
      })
      return
    }
    const cwd = agentFolder(job.agentHandle)
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: toolPath(bin),
      NO_COLOR: "1",
    }
    let output = ""
    let cancelled = false
    let sessionId: string | null = null
    const sessionRules = [...(job.allow ?? [])]
    let pending: Activity[] = []
    const flush = async () => {
      if (!pending.length) return
      const events = pending
      pending = []
      await this.host.post(`/api/desktop/jobs/${job.id}/events`, { events })
    }
    const child = spawn(bin, [...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] })
    this.child = child
    const connection = new AcpConnection(child, {
      onNotification: (method, params) => {
        if (method !== "session/update") return
        const update = acpUpdate(params)
        if (update.delta) output = (output + update.delta).slice(-200_000)
        if (update.activity.length) pending.push(...update.activity)
      },
      onRequest: async (method, params) => {
        if (method !== "session/request_permission") throw new Error("Not supported")
        const request = (params ?? {}) as { toolCall?: Record<string, unknown>; options?: unknown }
        const call = request.toolCall ?? {}
        const input =
          call.rawInput && typeof call.rawInput === "object"
            ? (call.rawInput as Record<string, unknown>)
            : { title: String(call.title ?? "") }
        const answer = await this.decide(
          job,
          {
            tool_name: toolName(call),
            input,
            tool_use_id:
              typeof call.toolCallId === "string" ? call.toolCallId : `acp-${Date.now()}`,
          },
          sessionRules,
          () => cancelled,
          flush,
        )
        return permissionOutcome(request.options, answer.behavior === "allow")
      },
    })
    const stop = () => {
      if (sessionId) connection.notify("session/cancel", { sessionId })
      setTimeout(() => child.kill("SIGTERM"), 3_000).unref()
    }
    const eventsTimer = setInterval(() => void flush(), EVENTS_MS)
    let lastSent = ""
    const progress = setInterval(async () => {
      const text = output.trim()
      const reply = await this.host.post<{ cancelled?: boolean }>(
        `/api/desktop/jobs/${job.id}`,
        text === lastSent ? {} : { output: text },
      )
      lastSent = text
      if (reply?.cancelled && !cancelled) {
        cancelled = true
        stop()
      }
    }, PROGRESS_MS)
    try {
      await connection.request("initialize", initializeParams(), 60_000)
      const session = await connection.request("session/new", { cwd, mcpServers: [] }, 120_000)
      sessionId =
        typeof (session as { sessionId?: unknown })?.sessionId === "string"
          ? (session as { sessionId: string }).sessionId
          : null
      if (!sessionId) throw new Error(`${spec.name} didn't start a session.`)
      const offered = acpModels(session)
      const model = jobModel(job)
      const switchTo = model ? modelRequest(offered.setter, sessionId, model) : null
      // Each model has its own effort levels; set_config_option answers with the new choices.
      let effortChoices = offered.effort
      if (switchTo) {
        const switched = await connection
          .request(switchTo.method, switchTo.params, 30_000)
          .catch((error: unknown) => {
            console.warn(`[runner] ${spec.name} kept its own model`, error)
            return null
          })
        const after = switched ? acpModels(switched) : null
        if (after && (after.effort || after.setter)) effortChoices = after.effort
      }
      const thinking = effortRequest(effortChoices, sessionId, jobEffort(job))
      if (thinking) {
        await connection
          .request(thinking.method, thinking.params, 30_000)
          .catch((error: unknown) => {
            console.warn(`[runner] ${spec.name} kept its own effort`, error)
          })
      }
      const result = (await connection.request(
        "session/prompt",
        { sessionId, prompt: [{ type: "text", text: job.prompt }] },
        null,
      )) as { stopReason?: unknown } | null
      await flush()
      if (cancelled) return
      const final = output.trim()
      const stopReason = typeof result?.stopReason === "string" ? result.stopReason : "end_turn"
      if (final) await this.finish(job, { output: final, status: "done" })
      else
        await this.finish(job, {
          output: "",
          status: "failed",
          error:
            stopReason === "refusal"
              ? `${spec.name} declined to answer this.`
              : `${spec.name} finished without a reply (${stopReason}).`,
        })
    } catch (error) {
      await flush().catch(() => undefined)
      if (cancelled) return
      const message = error instanceof Error ? error.message : String(error)
      const keys = spec.keyEnv.length ? `, or set ${spec.keyEnv[0]}` : ""
      await this.finish(job, {
        output: output.trim(),
        status: "failed",
        error: isAuthError(error)
          ? `${spec.name} isn't signed in on this computer. Run \`${spec.bin}\` once in a terminal and sign in${keys}. (${message.slice(0, 200)})`
          : message.slice(0, 500),
      })
    } finally {
      clearInterval(eventsTimer)
      clearInterval(progress)
      connection.close()
      this.child = null
    }
  }

  // ---------- Gemini CLI / OpenCode / Cursor / pi: plain text ----------

  private async runPlain(job: Job): Promise<void> {
    const lastMessageFile = path.join(os.tmpdir(), `sayabot-${job.id}.txt`)
    const cmd = commandFor(job.app, job.prompt, lastMessageFile, jobModel(job))
    const bin = await findBinary(cmd.bin)
    if (!bin) {
      await this.finish(job, {
        status: "failed",
        error: `${cmd.bin} isn't installed on this computer.`,
      })
      return
    }
    let output = ""
    let stderr = ""
    let cancelled = false
    // The app's own folder first: nvm-installed CLIs are Node scripts that need that folder's `node`.
    const env = {
      ...process.env,
      PATH: toolPath(bin),
      NO_COLOR: "1",
    }
    const child = spawn(bin, cmd.args, {
      cwd: agentFolder(job.agentHandle),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child = child
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      if (output.length > 200_000) output = output.slice(-200_000)
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4_000)
    })
    if (cmd.stdin !== null) child.stdin?.end(cmd.stdin)
    else child.stdin?.end()

    let lastSent = ""
    const progress = setInterval(async () => {
      if (output === lastSent) return
      lastSent = output
      const reply = await this.host.post<{ cancelled?: boolean }>(`/api/desktop/jobs/${job.id}`, {
        output,
      })
      if (reply?.cancelled) {
        cancelled = true
        child.kill("SIGTERM")
      }
    }, PROGRESS_MS)

    const code: number | null = await new Promise((resolve) => {
      child.on("close", (c) => resolve(c))
      child.on("error", () => resolve(-1))
    })
    clearInterval(progress)
    this.child = null
    if (cancelled) return

    let final = output.trim()
    try {
      const last = fs.readFileSync(lastMessageFile, "utf8").trim()
      if (last) final = last
      fs.unlinkSync(lastMessageFile)
    } catch {
      // only Codex writes this file
    }
    if (code === 0 && final) {
      await this.finish(job, { output: final, status: "done" })
    } else {
      await this.finish(job, {
        output: final,
        status: "failed",
        error: failureHint(cmd.bin, stderr, code),
      })
    }
  }

  // ---------- Ollama / LM Studio: a model served on this Mac ----------

  /**
   * Streams one chat completion from the local server's OpenAI-style endpoint. Text only: no
   * tools, nothing outside the reply. Ollama and LM Studio both speak `/v1/chat/completions`.
   */
  private async runLocalModel(job: Job): Promise<void> {
    const base = localServerUrl(job.app)
    const model = jobModel(job)
    const name = job.app === "ollama" ? "Ollama" : "LM Studio"
    if (!base || !model) {
      await this.finish(job, {
        status: "failed",
        error: `Pick a ${name} model for this bot first.`,
      })
      return
    }
    const controller = new AbortController()
    this.abortLocal = () => controller.abort()
    let output = ""
    let lastSent = ""
    let cancelled = false
    const progress = setInterval(async () => {
      if (output === lastSent) return
      lastSent = output
      const reply = await this.host.post<{ cancelled?: boolean }>(`/api/desktop/jobs/${job.id}`, {
        output,
      })
      if (reply?.cancelled) {
        cancelled = true
        controller.abort()
      }
    }, PROGRESS_MS)
    try {
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [{ role: "user", content: job.prompt }],
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        const detail = (await res.text().catch(() => "")).slice(0, 300)
        throw new Error(detail || `${name} answered ${res.status}`)
      }
      const decoder = new TextDecoder()
      let buffer = ""
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf("\n")) !== -1) {
          output += localDelta(buffer.slice(0, newline))
          buffer = buffer.slice(newline + 1)
        }
        if (output.length > 200_000) output = output.slice(-200_000)
      }
      output += localDelta(buffer)
      if (cancelled) return
      const final = output.trim()
      if (final) await this.finish(job, { output: final, status: "done" })
      else
        await this.finish(job, {
          output: "",
          status: "failed",
          error: `${name} sent an empty answer.`,
        })
    } catch (error) {
      if (cancelled) return
      const message = error instanceof Error ? error.message : String(error)
      const hint = /ECONNREFUSED|fetch failed/i.test(message)
        ? `${name} isn't running on this computer. Open it and try again.`
        : message.slice(0, 500)
      await this.finish(job, { output: output.trim(), status: "failed", error: hint })
    } finally {
      clearInterval(progress)
      this.abortLocal = null
    }
  }
}

/** The text in one `data: {...}` line of an OpenAI-style stream. */
export function localDelta(line: string): string {
  const trimmed = line.trim()
  if (!trimmed.startsWith("data:")) return ""
  const payload = trimmed.slice(5).trim()
  if (!payload || payload === "[DONE]") return ""
  try {
    const parsed = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: unknown } }> }
    const content = parsed.choices?.[0]?.delta?.content
    return typeof content === "string" ? content : ""
  } catch {
    return ""
  }
}
