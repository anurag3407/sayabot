import { spawn, type ChildProcess } from "node:child_process"
import type { ReportedModel } from "./local-models"
import type { Activity } from "./mac-stream"

/**
 * A small Agent Client Protocol client (agentclientprotocol.com): JSON-RPC 2.0, one message per
 * line over the app's stdin/stdout. Copilot, Command Code, Mistral Vibe, Kimi, Kiro, Droid, Devin,
 * Grok, Cline, Qwen, Hermes, OMP and DeepSeek Harness all speak it, so one client runs them all:
 * initialize → session/new → (pick the model) → session/prompt, with the reply streamed as
 * session/update notifications and every permission the app asks for sent to the owner.
 *
 * The parsers below are pure; AcpConnection is the only part that touches a process.
 */

const MODEL_ID = /^[\w.:/@+[\]~-]{1,160}$/
const MAX_MODELS = 200
const MAX_RESULT = 4_000

type Json = Record<string, unknown>

function record(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Json)
    : undefined
}

function nonempty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

// ---------- models ----------

/** How the session takes a model: a `model` config option, the older session/set_model, or not at all. */
export type ModelSetter = { kind: "config"; configId: string } | { kind: "set_model" } | null

export interface AcpModelList {
  models: ReportedModel[]
  current: string | null
  setter: ModelSetter
  /** The session's thinking-effort option (OpenCode `effort`, Copilot `reasoning_effort`…), if any. */
  effort: { configId: string; values: string[]; current: string | null } | null
}

const EFFORT_WORD = /^[a-z]{1,10}$/

/** "fireworks-ai/DeepSeek Flash" → "fireworks-ai · DeepSeek Flash", as OpenMausBot shows them. */
export function modelLabel(name: string): string {
  const match = /^([\w.-]+)\/(.+)$/.exec(name.trim())
  return (match ? `${match[1]} · ${match[2]}` : name.trim()).slice(0, 120)
}

/** Values of a select option, flattening grouped options ({ name, options: [...] }). */
function selectValues(entries: unknown, depth = 0, out: Array<{ id: string; label: string }> = []) {
  if (!Array.isArray(entries) || depth > 6) return out
  for (const raw of entries) {
    const entry = record(raw)
    if (!entry) continue
    const id = nonempty(entry.value)
    if (id) {
      if (!out.some((row) => row.id === id)) out.push({ id, label: nonempty(entry.name) ?? id })
    } else {
      selectValues(entry.options, depth + 1, out)
    }
  }
  return out
}

/** The models a session/new (or session/load) result offers, and how to switch between them. */
export function acpModels(result: unknown): AcpModelList {
  const root = record(result)
  const options = Array.isArray(root?.configOptions)
    ? root.configOptions.map(record).filter(Boolean)
    : []
  const effortOption = options.find(
    (entry) =>
      entry?.type === "select" &&
      nonempty(entry.id) &&
      (["effort", "reasoning_effort", "thought_level", "effortLevel"].includes(String(entry.id)) ||
        entry.category === "thought_level"),
  )
  const effortValues = effortOption
    ? selectValues(effortOption.options)
        .map((row) => row.id)
        .filter((id) => id !== "default" && EFFORT_WORD.test(id))
    : []
  const effortCurrent = nonempty(effortOption?.currentValue)
  const effort =
    effortOption && effortValues.length
      ? {
          configId: String(effortOption.id),
          values: effortValues,
          current: effortCurrent && effortCurrent !== "default" ? effortCurrent : null,
        }
      : null
  const option =
    options.find((entry) => entry?.type === "select" && entry.id === "model") ??
    options.find(
      (entry) => entry?.type === "select" && entry.category === "model" && nonempty(entry.id),
    )
  let rows: Array<{ id: string; label: string }> = []
  let current: string | null = null
  let setter: ModelSetter = null
  if (option) {
    rows = selectValues(option.options)
    current = nonempty(option.currentValue) ?? null
    setter = { kind: "config", configId: String(option.id) }
  } else {
    const models = record(root?.models)
    if (models && Array.isArray(models.availableModels)) {
      for (const raw of models.availableModels) {
        const model = record(raw)
        const id = nonempty(model?.modelId)
        if (id && !rows.some((row) => row.id === id))
          rows.push({ id, label: nonempty(model?.name) ?? id })
      }
      current = nonempty(models.currentModelId) ?? null
      setter = { kind: "set_model" }
    }
  }
  // The app's current model first, so a long catalog still shows it.
  const valid = rows.filter((row) => MODEL_ID.test(row.id))
  const usable = [
    ...valid.filter((row) => row.id === current),
    ...valid.filter((row) => row.id !== current),
  ].slice(0, MAX_MODELS)
  return {
    // Effort levels belong to the session's current model (each model has its own), so only that
    // model says which it takes; the runner reads them again after switching models.
    models: usable.map((row) => ({
      id: row.id,
      label: modelLabel(row.label),
      ...(effort && row.id === current ? { effort: effort.values } : {}),
      ...(effort?.current && row.id === current ? { defaultEffort: effort.current } : {}),
      ...(row.id === current ? { isDefault: true } : {}),
    })),
    current,
    setter: usable.length ? setter : null,
    effort,
  }
}

/** The request that puts the session on `model`, or null when the session can't switch. */
export function modelRequest(
  setter: ModelSetter,
  sessionId: string,
  model: string,
): { method: string; params: Json } | null {
  if (!setter) return null
  if (setter.kind === "config") {
    return {
      method: "session/set_config_option",
      params: { sessionId, configId: setter.configId, value: model },
    }
  }
  return { method: "session/set_model", params: { sessionId, modelId: model } }
}

/** The request that sets the session's thinking effort, when the app offers that level. */
export function effortRequest(
  effort: AcpModelList["effort"],
  sessionId: string,
  level: string | null,
): { method: string; params: Json } | null {
  if (!effort || !level || !effort.values.includes(level)) return null
  return {
    method: "session/set_config_option",
    params: { sessionId, configId: effort.configId, value: level },
  }
}

// ---------- the reply and its steps ----------

export interface AcpUpdate {
  delta?: string
  activity: Activity[]
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content
  const block = record(content)
  if (block?.type === "text" && typeof block.text === "string") return block.text
  // tool_call content: [{ type: "content", content: { type: "text", text } }, { type: "diff", ... }]
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const item = record(part)
        if (item?.type === "content") return contentText(item.content)
        if (item?.type === "diff" && typeof item.path === "string") return `edited ${item.path}`
        return contentText(part)
      })
      .filter(Boolean)
      .join("\n")
  }
  return ""
}

function toolArgs(update: Json): Json {
  const raw = record(update.rawInput)
  if (raw) return raw
  const title = nonempty(update.title)
  return title ? { title } : {}
}

/** One session/update: text to add to the reply, and tool steps for the room's live cards. */
export function acpUpdate(params: unknown): AcpUpdate {
  const update = record(record(params)?.update)
  if (!update) return { activity: [] }
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentText(update.content)
      return text ? { delta: text, activity: [] } : { activity: [] }
    }
    case "tool_call": {
      const key = nonempty(update.toolCallId)
      if (!key) return { activity: [] }
      const activity: Activity[] = [
        { type: "started", key, toolName: toolName(update), args: toolArgs(update) },
      ]
      if (update.status === "completed" || update.status === "failed") {
        activity.push(finished(key, update))
      }
      return { activity }
    }
    case "tool_call_update": {
      const key = nonempty(update.toolCallId)
      if (!key || (update.status !== "completed" && update.status !== "failed"))
        return { activity: [] }
      return { activity: [finished(key, update)] }
    }
    default:
      return { activity: [] }
  }
}

function finished(key: string, update: Json): Activity {
  const result = contentText(update.content) || contentText(record(update.rawOutput)?.output)
  return {
    type: "finished",
    key,
    ok: update.status === "completed",
    ...(result ? { result: result.slice(0, MAX_RESULT) } : {}),
  }
}

/** A short tool name for the room's card: the app's own title, else the ACP kind. */
export function toolName(update: Json): string {
  const title = nonempty(update.title) ?? nonempty(record(update.toolCall)?.title)
  const kind = nonempty(update.kind) ?? nonempty(record(update.toolCall)?.kind)
  return (title ?? kind ?? "tool").slice(0, 80)
}

// ---------- permissions ----------

export interface PermissionOption {
  optionId: string
  kind: string
}

/** The answer to session/request_permission: the app's own allow-once (or reject) option. */
export function permissionOutcome(options: unknown, allow: boolean): Json {
  const list: PermissionOption[] = Array.isArray(options)
    ? options.flatMap((raw) => {
        const option = record(raw)
        const optionId = nonempty(option?.optionId)
        return optionId ? [{ optionId, kind: String(option?.kind ?? "") }] : []
      })
    : []
  const want = allow ? "allow" : "reject"
  const picked =
    list.find((option) => option.kind === `${want}_once`) ??
    list.find((option) => option.kind.startsWith(want))
  return picked
    ? { outcome: { outcome: "selected", optionId: picked.optionId } }
    : { outcome: { outcome: "cancelled" } }
}

// ---------- the connection ----------

export class AcpError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
  ) {
    super(message)
  }
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

/**
 * JSON-RPC over the child's stdio. `onRequest` answers what the app asks the client (permissions);
 * anything else the app asks for (files, terminals) is refused, as this client never offers them.
 */
export class AcpConnection {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private buffer = ""
  private closed = false
  stderr = ""

  constructor(
    private child: ChildProcess,
    private handlers: {
      onNotification: (method: string, params: unknown) => void
      onRequest: (method: string, params: unknown) => Promise<unknown>
    },
  ) {
    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => this.read(chunk))
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString("utf8")).slice(-4_000)
    })
    const end = (why: string) => this.fail(new AcpError(why, null))
    child.on("close", (code) => end(this.exitMessage(code)))
    child.on("error", (error) => end(error.message))
    child.stdin?.on("error", () => {})
  }

  private exitMessage(code: number | null): string {
    const tail = this.stderr.trim().split("\n").slice(-3).join(" ").slice(0, 400)
    return tail || `The app stopped (exit code ${code ?? "unknown"}).`
  }

  private read(chunk: string) {
    this.buffer += chunk
    if (this.buffer.length > 8 * 1024 * 1024) this.buffer = ""
    let newline: number
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line) this.dispatch(line)
    }
  }

  private dispatch(line: string) {
    let message: Json
    try {
      const parsed: unknown = JSON.parse(line)
      const value = record(parsed)
      if (!value) return
      message = value
    } catch {
      return // apps sometimes log to stdout; only JSON-RPC lines count
    }
    const id = message.id
    if (typeof message.method === "string") {
      if (id === undefined || id === null) {
        this.handlers.onNotification(message.method, message.params)
        return
      }
      void this.handlers.onRequest(message.method, message.params).then(
        (result) => this.send({ jsonrpc: "2.0", id, result: result ?? null }),
        (error: unknown) =>
          this.send({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: error instanceof Error ? error.message : "Not supported",
            },
          }),
      )
      return
    }
    if (typeof id !== "number") return
    const waiting = this.pending.get(id)
    if (!waiting) return
    this.pending.delete(id)
    if (waiting.timer) clearTimeout(waiting.timer)
    const error = record(message.error)
    if (error) {
      waiting.reject(
        new AcpError(
          nonempty(error.message) ?? "The app refused the request.",
          typeof error.code === "number" ? error.code : null,
        ),
      )
    } else {
      waiting.resolve(message.result)
    }
  }

  private send(message: Json) {
    if (this.closed) return
    try {
      this.child.stdin?.write(`${JSON.stringify(message)}\n`)
    } catch {
      // the close handler reports it
    }
  }

  request(method: string, params: Json, timeoutMs: number | null = 60_000): Promise<unknown> {
    if (this.closed) return Promise.reject(new AcpError(this.exitMessage(null), null))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer =
        timeoutMs === null
          ? null
          : setTimeout(() => {
              this.pending.delete(id)
              reject(new AcpError(`The app didn't answer ${method} in time.`, null))
            }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ jsonrpc: "2.0", id, method, params })
    })
  }

  notify(method: string, params: Json) {
    this.send({ jsonrpc: "2.0", method, params })
  }

  private fail(error: Error) {
    if (this.closed) return
    this.closed = true
    for (const waiting of this.pending.values()) {
      if (waiting.timer) clearTimeout(waiting.timer)
      waiting.reject(error)
    }
    this.pending.clear()
  }

  close() {
    this.fail(new AcpError("Closed", null))
    try {
      this.child.stdin?.end()
    } catch {
      // already closed
    }
    this.child.kill("SIGTERM")
  }
}

export const ACP_CLIENT_INFO = { name: "sayabot", title: "Sayabot", version: "1" }

/** initialize with no file or terminal access: the app works with its own tools in its own folder. */
export function initializeParams(): Json {
  return {
    protocolVersion: 1,
    clientInfo: ACP_CLIENT_INFO,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
  }
}

/** A login error from the app, in words the room can show. */
export function isAuthError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error)
  return (
    (error instanceof AcpError && error.code === -32000) ||
    /not (?:authenticated|signed in|logged in)|log ?in|sign ?in|unauthori[sz]ed|api key|credentials?/i.test(
      text,
    )
  )
}

/**
 * The models an ACP app offers its signed-in account: initialize and session/new in a throwaway
 * folder, read the session's model option, then stop. Nothing is prompted, so nothing is billed.
 */
export async function discoverAcpModels(
  binary: string,
  args: readonly string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number },
): Promise<ReportedModel[] | null> {
  const child = spawn(binary, [...args], {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["pipe", "pipe", "pipe"],
  })
  const connection = new AcpConnection(child, {
    onNotification: () => {},
    onRequest: async (method, params) => {
      if (method === "session/request_permission")
        return permissionOutcome(record(params)?.options, false)
      throw new Error("Not supported")
    },
  })
  const timeout = opts.timeoutMs ?? 45_000
  try {
    await connection.request("initialize", initializeParams(), timeout)
    const session = await connection.request(
      "session/new",
      { cwd: opts.cwd, mcpServers: [] },
      timeout,
    )
    const sessionId = nonempty(record(session)?.sessionId)
    const { models } = acpModels(session)
    if (sessionId)
      await connection.request("session/close", { sessionId }, 2_000).catch(() => undefined)
    return models.length ? models : null
  } catch {
    return null
  } finally {
    connection.close()
  }
}
