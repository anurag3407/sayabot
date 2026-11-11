import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, screen, systemPreferences } from "electron"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Injector, KEY_CODES } from "./injector"
import { measureLocalStorage, type LocalStorageReport } from "./storage"

/**
 * This computer as a Sayabot "host": it registers once (getting its own token), sends a
 * heartbeat every few seconds, answers remote-desktop requests, and feeds the local runner.
 */

export interface HostAuth {
  hostId: string
  hostToken: string
  serverUrl: string
}

export interface HostDeps {
  getServerUrl: () => string
  getSession: () => { accessToken: string; refreshToken: string } | null
  detectLocalAgents: () => Promise<Array<{ id: string; name: string; status: string; version: string | null }>>
  onHeartbeat?: (reply: HeartbeatReply) => void
}

export interface HeartbeatReply {
  settings: { whoCanControl?: string; askOnComputer?: boolean; runnerEnabled?: boolean }
  sessions: Array<{ id: string; viewerName: string; isOwner: boolean; control: boolean; offer: string | null }>
  queuedJobs: number
}

const HOST_FILE = "sayabot-host.json"
const HEARTBEAT_MS = 2_500

function hostFile(): string {
  return path.join(app.getPath("userData"), HOST_FILE)
}

export function loadHostAuth(serverUrl: string): HostAuth | null {
  try {
    const saved = JSON.parse(fs.readFileSync(hostFile(), "utf-8")) as HostAuth
    return saved.serverUrl === serverUrl ? saved : null
  } catch {
    return null
  }
}

function saveHostAuth(auth: HostAuth | null): void {
  try {
    if (auth) fs.writeFileSync(hostFile(), JSON.stringify(auth, null, 2), { encoding: "utf-8", mode: 0o600 })
    else if (fs.existsSync(hostFile())) fs.unlinkSync(hostFile())
  } catch (err) {
    console.error("[host] could not save host auth", err)
  }
}

export function permissionState(): Record<string, string> {
  if (process.platform !== "darwin") return { screen: "unknown", accessibility: "unknown" }
  return {
    screen: systemPreferences.getMediaAccessStatus("screen"),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied",
  }
}

/** Mirrors @sayabot/core parseRemoteInput: only these shapes ever reach the injector. */
function parseInput(raw: string): Record<string, unknown> | null {
  let e: Record<string, unknown>
  try {
    e = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null)
  switch (e.t) {
    case "move":
    case "down":
    case "up": {
      const x = n(e.x)
      const y = n(e.y)
      if (x === null || y === null) return null
      return e.t === "move" ? { t: "move", x, y } : { t: e.t, x, y, b: e.b === 2 ? 2 : 0 }
    }
    case "scroll": {
      const clamp = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(-50, Math.min(50, Math.round(v))) : 0)
      return { t: "scroll", dy: clamp(e.dy), dx: clamp(e.dx) }
    }
    case "key":
      if (typeof e.key !== "string" || !e.key || e.key.length > 20) return null
      return {
        t: "key",
        key: e.key,
        mods: Array.isArray(e.mods) ? e.mods.filter((m) => ["cmd", "ctrl", "alt", "shift"].includes(String(m))) : [],
      }
    case "text":
      return typeof e.s === "string" && e.s.length > 0 && e.s.length <= 500 ? { t: "text", s: e.s } : null
    default:
      return null
  }
}

export class DesktopHost {
  private auth: HostAuth | null = null
  private timer: NodeJS.Timeout | null = null
  private captureWindow: BrowserWindow | null = null
  private handled = new Set<string>()
  private active = new Map<string, { control: boolean }>()
  private injector = new Injector()
  private beating = false
  private lastAgentsScan = 0
  private agents: Array<{ id: string; name: string; status: string; version: string | null }> = []
  private storage: LocalStorageReport | null = null
  private lastStorageScan = 0
  lastReply: HeartbeatReply | null = null

  constructor(private deps: HostDeps) {
    ipcMain.on("remote-host:answer", (_e, sessionId: string, answer: string) => void this.post(`/api/desktop/sessions/${sessionId}`, { action: "answer", answer }))
    ipcMain.on("remote-host:ended", (_e, sessionId: string, reason?: string) => {
      this.active.delete(sessionId)
      void this.post(`/api/desktop/sessions/${sessionId}`, { action: reason ? "fail" : "end", reason })
    })
    ipcMain.on("remote-host:input", (_e, sessionId: string, raw: string) => this.input(sessionId, raw))
  }

  get credentials(): HostAuth | null {
    return this.auth
  }

  async start(): Promise<void> {
    if (this.timer) return
    const serverUrl = this.deps.getServerUrl().replace(/\/+$/, "")
    this.auth = loadHostAuth(serverUrl) ?? (await this.register(serverUrl))
    if (!this.auth) return
    this.timer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS)
    void this.heartbeat()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.injector.stop()
    this.captureWindow?.destroy()
    this.captureWindow = null
  }

  forget(): void {
    this.stop()
    saveHostAuth(null)
    this.auth = null
  }

  private async register(serverUrl: string): Promise<HostAuth | null> {
    const session = this.deps.getSession()
    if (!session) return null
    try {
      const res = await fetch(`${serverUrl}/api/desktop/register`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({
          name: os.hostname().replace(/\.local$/, ""),
          platform: process.platform,
          version: app.getVersion(),
          refreshToken: session.refreshToken,
        }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as { hostId: string; hostToken: string }
      const auth = { hostId: data.hostId, hostToken: data.hostToken, serverUrl }
      saveHostAuth(auth)
      return auth
    } catch (err) {
      console.error("[host] register failed", err)
      return null
    }
  }

  /** Authenticated call to the server as this computer. */
  async post<T = unknown>(pathname: string, body: unknown): Promise<T | null> {
    if (!this.auth) return null
    try {
      const res = await fetch(`${this.auth.serverUrl}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-host-id": this.auth.hostId, "x-host-token": this.auth.hostToken },
        body: JSON.stringify(body),
      })
      if (res.status === 401) {
        // Removed on the web (or token rotated elsewhere): register again next start.
        this.forget()
        return null
      }
      return res.ok ? ((await res.json()) as T) : null
    } catch {
      return null
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.beating) return
    this.beating = true
    try {
      if (Date.now() - this.lastAgentsScan > 60_000) {
        this.lastAgentsScan = Date.now()
        this.agents = await this.deps.detectLocalAgents().catch(() => this.agents)
      }
      let storage: LocalStorageReport | undefined
      if (Date.now() - this.lastStorageScan > 10 * 60_000) {
        this.lastStorageScan = Date.now()
        this.storage = await measureLocalStorage().catch(() => this.storage)
        storage = this.storage ?? undefined
      }
      const reply = await this.post<HeartbeatReply>("/api/desktop/heartbeat", {
        permissions: permissionState(),
        localAgents: this.agents,
        ...(storage ? { storage } : {}),
      })
      if (!reply) return
      this.lastReply = reply
      this.deps.onHeartbeat?.(reply)
      for (const session of reply.sessions) {
        if (this.handled.has(session.id)) continue
        this.handled.add(session.id)
        void this.handleSession(session, reply.settings)
      }
    } finally {
      this.beating = false
    }
  }

  private async askAtComputer(viewerName: string, control: boolean): Promise<boolean> {
    const abort = new AbortController()
    const timeout = setTimeout(() => abort.abort(), 30_000)
    try {
      const result = await dialog.showMessageBox({
        type: "question",
        buttons: ["Allow", "Don't allow"],
        defaultId: 1,
        cancelId: 1,
        title: "Remote desktop",
        message: `${viewerName} wants to ${control ? "control" : "see"} this computer`,
        detail: "Only allow this if you asked for it. Without an answer in 30 seconds it is refused.",
        signal: abort.signal,
      })
      return result.response === 0
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }

  private async handleSession(session: HeartbeatReply["sessions"][number], settings: HeartbeatReply["settings"]): Promise<void> {
    const deny = (reason: string) => this.post(`/api/desktop/sessions/${session.id}`, { action: "deny", reason })
    if (!session.offer) return void deny("No connection offer")
    if (permissionState().screen !== "granted" && process.platform === "darwin") {
      // Asking makes macOS show its own prompt / add the app to the list.
      void desktopCapturer.getSources({ types: ["screen"] }).catch(() => {})
      return void deny("Screen Recording isn't allowed for Sayabot on this computer yet.")
    }
    if (settings.askOnComputer !== false && !(await this.askAtComputer(session.viewerName, session.control))) {
      return void deny("Not allowed on the computer")
    }
    const display = screen.getPrimaryDisplay()
    const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source) return void deny("No screen to share")

    const control = session.control && this.injector.supported && permissionState().accessibility === "granted"
    this.active.set(session.id, { control })
    const win = this.ensureCaptureWindow()
    const send = () => win.webContents.send("remote-host:start", { sessionId: session.id, offer: session.offer, sourceId: source.id })
    if (win.webContents.isLoading()) win.webContents.once("did-finish-load", send)
    else send()
  }

  private ensureCaptureWindow(): BrowserWindow {
    if (this.captureWindow && !this.captureWindow.isDestroyed()) return this.captureWindow
    this.captureWindow = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      webPreferences: {
        preload: path.join(__dirname, "remote-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    })
    const dist = path.join(__dirname, "renderer", "remote-host.html")
    const src = path.join(__dirname, "..", "src", "renderer", "remote-host.html")
    void this.captureWindow.loadFile(fs.existsSync(dist) ? dist : src)
    return this.captureWindow
  }

  private input(sessionId: string, raw: string): void {
    const session = this.active.get(sessionId)
    if (!session?.control) return
    const event = parseInput(raw)
    if (!event) return
    const { bounds } = screen.getPrimaryDisplay()
    if ("x" in event && "y" in event) {
      event.x = Math.round(bounds.x + (event.x as number) * bounds.width)
      event.y = Math.round(bounds.y + (event.y as number) * bounds.height)
    }
    if (event.t === "key" && typeof event.key === "string" && KEY_CODES[event.key] !== undefined) event.code = KEY_CODES[event.key]
    this.injector.send(event)
  }
}
