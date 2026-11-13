import { spawn, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { DesktopHost } from "./host"

/**
 * Local MCP programs that need this computer (Obsidian, Paper, Apple apps).
 * The app id maps to one fixed command. Anything else is refused.
 */

interface McpCall {
  id: string
  serverId: string
  appId: string
  method: string
  params: Record<string, unknown>
  env: Record<string, string>
}

const APPS: Record<string, { command: string; args: string[] }> = {
  obsidian: { command: "npx", args: ["-y", "obsidian-mcp-server"] },
  paper: { command: "paper", args: ["mcp"] },
  "apple-apps": { command: "npx", args: ["-y", "mcp-icloud"] },
}

const ENV_KEYS = new Set(["OBSIDIAN_API_KEY", "OBSIDIAN_HOST", "OBSIDIAN_PORT"])

function commandFor(appId: string): { command: string; args: string[] } | null {
  const app = APPS[appId]
  if (!app) return null
  if (app.command === "paper") {
    const local = path.join(os.homedir(), ".paper", "bin", "paper")
    return { command: fs.existsSync(local) ? local : "paper", args: app.args }
  }
  return app
}

class StdioSession {
  private child: ChildProcess | null = null
  private buffer = Buffer.alloc(0)
  private nextId = 1
  private waiters = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  constructor(private command: string, private args: string[], private env: NodeJS.ProcessEnv) {}

  private async ensure(): Promise<void> {
    if (this.child && !this.child.killed) return
    const child = spawn(this.command, this.args, { env: this.env, stdio: ["pipe", "pipe", "ignore"] })
    this.child = child
    child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk))
    child.on("close", () => {
      for (const waiter of this.waiters.values()) waiter.reject(new Error("The local app stopped"))
      this.waiters.clear()
      this.child = null
    })
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sayabot", version: "1" },
    })
    this.notify("notifications/initialized", {})
  }

  private notify(method: string, params: unknown): void {
    this.child?.stdin?.write(frame({ jsonrpc: "2.0", method, params }))
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        reject(new Error("The local app didn't answer in time"))
      }, 20_000)
      this.waiters.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.child?.stdin?.write(frame({ jsonrpc: "2.0", id, method, params }))
    })
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n")
      if (headerEnd < 0) return
      const header = this.buffer.subarray(0, headerEnd).toString("utf8")
      const match = /content-length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.buffer = Buffer.alloc(0)
        return
      }
      const length = Number(match[1])
      const start = headerEnd + 4
      if (this.buffer.length < start + length) return
      const body = this.buffer.subarray(start, start + length).toString("utf8")
      this.buffer = this.buffer.subarray(start + length)
      let message: { id?: number; result?: unknown; error?: { message?: string } }
      try {
        message = JSON.parse(body)
      } catch {
        continue
      }
      if (typeof message.id !== "number") continue
      const waiter = this.waiters.get(message.id)
      if (!waiter) continue
      this.waiters.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message || "The local app returned an error"))
      else waiter.resolve(message.result ?? null)
    }
  }

  async call(method: string, params: unknown): Promise<unknown> {
    await this.ensure()
    return this.request(method, params)
  }

  stop(): void {
    this.child?.kill("SIGTERM")
  }
}

function frame(value: unknown): string {
  const body = JSON.stringify(value)
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
}

export class LocalMcpHost {
  private busy = false
  private sessions = new Map<string, StdioSession>()

  constructor(private host: DesktopHost) {}

  async maybeRun(queued: number): Promise<void> {
    if (this.busy || queued <= 0) return
    this.busy = true
    try {
      const claimed = await this.host.post<{ call: McpCall | null }>("/api/desktop/mcp/claim", {})
      if (claimed?.call) await this.run(claimed.call)
    } finally {
      this.busy = false
    }
  }

  private async run(call: McpCall): Promise<void> {
    if (call.method !== "tools/list" && call.method !== "tools/call") {
      await this.host.post(`/api/desktop/mcp/${call.id}`, { error: "That call isn't allowed." })
      return
    }
    const command = commandFor(call.appId)
    if (!command) {
      await this.host.post(`/api/desktop/mcp/${call.id}`, { error: "That app isn't allowed on this computer." })
      return
    }
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const [key, value] of Object.entries(call.env ?? {})) {
      if (ENV_KEYS.has(key) && typeof value === "string") env[key] = value
    }
    const session = this.sessions.get(call.serverId) ?? new StdioSession(command.command, command.args, env)
    this.sessions.set(call.serverId, session)
    try {
      const result = await session.call(call.method, call.params ?? {})
      await this.host.post(`/api/desktop/mcp/${call.id}`, { result })
    } catch (error) {
      this.sessions.delete(call.serverId)
      session.stop()
      await this.host.post(`/api/desktop/mcp/${call.id}`, { error: error instanceof Error ? error.message : "The local app failed" })
    }
  }
}
