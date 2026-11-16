import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  systemPreferences,
} from "electron"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  fetchWorkspaceSnapshot,
  importWorkspaceSnapshot,
  computersFromRecord,
  snapshotHasRecords,
  syncCloudHandoff,
  type LocalWorkspaceSnapshot,
} from "./cloud-handoff"
import { hostAuthPlan } from "./host-auth"
import { Injector, KEY_CODES } from "./injector"
import { measureLocalStorage, type LocalStorageReport } from "./storage"
import type { ReportedModel } from "./local-models"

/**
 * This computer as a Sayabot "host": it registers once (getting its own token), sends a
 * heartbeat every few seconds, answers remote-desktop requests, and feeds the local runner.
 */

export interface HostAuth {
  hostId: string
  hostToken: string
  serverUrl: string
  /** The account that registered this computer; its heartbeats land on that account. */
  userId?: string
}

/** One app on this Mac as the server sees it (see LocalAgent). */
export interface ReportedAgent {
  id: string
  name: string
  status: string
  version: string | null
  account?: string | null
  models?: ReportedModel[]
}

export interface HostDeps {
  getServerUrl: () => string
  getSession: () => { accessToken: string; refreshToken: string; userId?: string } | null
  onSessionUpdate?: (session: { accessToken: string; refreshToken: string }) => void
  /** `fresh` skips the cached model lists (someone pressed refresh in the picker). */
  detectLocalAgents: (opts?: { fresh?: boolean }) => Promise<ReportedAgent[]>
  onHeartbeat?: (reply: HeartbeatReply) => void
}

export interface HeartbeatReply {
  settings: {
    whoCanControl?: string
    askOnComputer?: boolean
    runnerEnabled?: boolean
    /** Set when someone asks for fresh model lists; a new value means scan again now. */
    agentsRescanAt?: string
  }
  sessions: Array<{
    id: string
    viewerName: string
    isOwner: boolean
    control: boolean
    offer: string | null
  }>
  queuedJobs: number
  secretJobs?: number
  mcpCalls?: number
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
    if (auth)
      fs.writeFileSync(hostFile(), JSON.stringify(auth, null, 2), {
        encoding: "utf-8",
        mode: 0o600,
      })
    else if (fs.existsSync(hostFile())) fs.unlinkSync(hostFile())
  } catch (err) {
    console.error("[host] could not save host auth", err)
  }
}

export function permissionState(): Record<string, string> {
  if (process.platform === "win32") {
    const screen = systemPreferences.getMediaAccessStatus("screen")
    return {
      screen: screen === "denied" || screen === "restricted" ? screen : "granted",
      accessibility: "granted",
    }
  }
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
  const n = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null
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
      const clamp = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) ? Math.max(-50, Math.min(50, Math.round(v))) : 0
      return { t: "scroll", dy: clamp(e.dy), dx: clamp(e.dx) }
    }
    case "key":
      if (typeof e.key !== "string" || !e.key || e.key.length > 20) return null
      return {
        t: "key",
        key: e.key,
        mods: Array.isArray(e.mods)
          ? e.mods.filter((m) => ["cmd", "ctrl", "alt", "shift"].includes(String(m)))
          : [],
      }
    case "text":
      return typeof e.s === "string" && e.s.length > 0 && e.s.length <= 500
        ? { t: "text", s: e.s }
        : null
    default:
      return null
  }
}

function rows(value: unknown): Array<{ id: string }> {
  if (!Array.isArray(value)) return []
  return value.filter(
    (row): row is { id: string } =>
      Boolean(row) && typeof row === "object" && typeof (row as { id?: unknown }).id === "string",
  )
}

/** This Mac's copy. A saved file wins; otherwise the bots found on this computer are the snapshot. */
function readCloudSnapshot(
  file: string,
  agents: Array<{ id: string; name: string }>,
): LocalWorkspaceSnapshot {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
    if (parsed && typeof parsed === "object") {
      return {
        bots: rows(parsed.bots),
        chats: rows(parsed.chats),
        routines: rows(parsed.routines),
        keys: rows(parsed.keys),
        computers: computersFromRecord(parsed.computers),
      }
    }
  } catch {
    // First launch has no file yet.
  }
  return {
    bots: agents.map((agent) => ({ id: agent.id, name: agent.name })),
    chats: [],
    routines: [],
    keys: [],
  }
}

export class DesktopHost {
  private auth: HostAuth | null = null
  private timer: NodeJS.Timeout | null = null
  private starting: Promise<void> | null = null
  private captureWindow: BrowserWindow | null = null
  private handled = new Set<string>()
  private active = new Map<string, { control: boolean }>()
  private injector = new Injector()
  private beating = false
  private lastAgentsScan = 0
  private agents: ReportedAgent[] = []
  /** A scan runs beside the heartbeat: reading model lists can take half a minute. */
  private scanning: Promise<void> | null = null
  private scanned: ReportedAgent[] | null = null
  private rescanSeen: string | null = null
  private forceScan = false
  private storage: LocalStorageReport | null = null
  private lastStorageScan = 0
  private lastHandoff = 0
  lastReply: HeartbeatReply | null = null

  constructor(private deps: HostDeps) {
    ipcMain.on(
      "remote-host:answer",
      (_e, sessionId: string, answer: string) =>
        void this.post(`/api/desktop/sessions/${sessionId}`, { action: "answer", answer }),
    )
    ipcMain.on("remote-host:ended", (_e, sessionId: string, reason?: string) => {
      this.active.delete(sessionId)
      void this.post(`/api/desktop/sessions/${sessionId}`, {
        action: reason ? "fail" : "end",
        reason,
      })
    })
    ipcMain.on("remote-host:input", (_e, sessionId: string, raw: string) =>
      this.input(sessionId, raw),
    )
  }

  get credentials(): HostAuth | null {
    return this.auth
  }

  /**
   * Starts reporting as this computer, under the account signed in now. Called again whenever the
   * login changes; a registration made by another account is replaced, not reused.
   */
  start(): Promise<void> {
    this.starting ??= this.connect().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async connect(): Promise<void> {
    const serverUrl = this.deps.getServerUrl().replace(/\/+$/, "")
    const userId = this.deps.getSession()?.userId
    const saved = this.auth ?? loadHostAuth(serverUrl)
    const plan = hostAuthPlan(saved, serverUrl, userId)
    let next: HostAuth | null = saved
    if (plan !== "reuse") {
      // Offline: a legacy registration still works; another account's must not be used.
      next = (await this.register(serverUrl, saved)) ?? (plan === "verify" ? saved : null)
    }
    if (next?.hostId !== this.auth?.hostId) {
      // A different computer row: send the apps and storage right away, not in a minute.
      this.lastAgentsScan = 0
      this.lastStorageScan = 0
    }
    this.auth = next
    if (!this.auth) {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
      return
    }
    if (this.timer) return
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

  /** Registers under the signed-in account; with `previous`, the server keeps that row if it is this account's. */
  private async register(serverUrl: string, previous: HostAuth | null): Promise<HostAuth | null> {
    const session = this.deps.getSession()
    if (!session) return null
    const known: Record<string, string> =
      previous && previous.serverUrl === serverUrl
        ? { "x-host-id": previous.hostId, "x-host-token": previous.hostToken }
        : {}
    try {
      const res = await fetch(`${serverUrl}/api/desktop/register`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`,
          ...known,
        },
        body: JSON.stringify({
          name: os.hostname().replace(/\.local$/, ""),
          platform: process.platform,
          version: app.getVersion(),
          refreshToken: session.refreshToken,
        }),
      })
      if (!res.ok) return null
      const data = (await res.json()) as {
        hostId: string
        hostToken: string
        session?: { accessToken: string; refreshToken: string }
      }
      if (data.session?.accessToken && data.session?.refreshToken) {
        this.deps.onSessionUpdate?.(data.session)
      }
      const auth: HostAuth = {
        hostId: data.hostId,
        hostToken: data.hostToken,
        serverUrl,
        ...(session.userId ? { userId: session.userId } : {}),
      }
      saveHostAuth(auth)
      return auth
    } catch (err) {
      console.error("[host] register failed", err)
      return null
    }
  }

  /** Authenticated read from the server as this computer. */
  async get<T = unknown>(pathname: string): Promise<T | null> {
    if (!this.auth) return null
    try {
      const res = await fetch(`${this.auth.serverUrl}${pathname}`, {
        headers: { "x-host-id": this.auth.hostId, "x-host-token": this.auth.hostToken },
      })
      return res.ok ? ((await res.json()) as T) : null
    } catch {
      return null
    }
  }

  /** Authenticated call to the server as this computer. */
  async post<T = unknown>(pathname: string, body: unknown): Promise<T | null> {
    if (!this.auth) return null
    try {
      const res = await fetch(`${this.auth.serverUrl}${pathname}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-host-id": this.auth.hostId,
          "x-host-token": this.auth.hostToken,
        },
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

  /** After the plan ends, the copy is imported into the server this Mac uses now, once that server is not Cloud. */
  private async importReturnedHome(snapshotFile: string, flagFile: string): Promise<void> {
    if (!this.auth) return
    let pending: { cloudUrl?: string } | null = null
    try {
      pending = JSON.parse(fs.readFileSync(flagFile, "utf8")) as { cloudUrl?: string }
    } catch {
      return
    }
    if (!pending?.cloudUrl || pending.cloudUrl === this.auth.serverUrl) return
    const snapshot = readCloudSnapshot(snapshotFile, this.agents)
    if (!snapshotHasRecords(snapshot)) return
    const ok = await importWorkspaceSnapshot({
      serverUrl: this.auth.serverUrl,
      hostId: this.auth.hostId,
      hostToken: this.auth.hostToken,
      snapshot,
    }).catch(() => false)
    if (ok) fs.rmSync(flagFile, { force: true })
  }

  /** Copies this Mac's bots, chats, routines, and keys once when Cloud is ready, and writes them back when the plan ends. */
  private async maybeCloudHandoff(): Promise<void> {
    if (!this.auth || Date.now() - this.lastHandoff < 10 * 60_000) return
    this.lastHandoff = Date.now()
    const file = path.join(app.getPath("userData"), "cloud-home.json")
    try {
      let snapshot = readCloudSnapshot(file, this.agents)
      if (
        !snapshot.bots.some((row) => "handle" in row) &&
        !snapshot.chats.some((row) => "name" in row)
      ) {
        const live = await fetchWorkspaceSnapshot(
          this.auth.serverUrl,
          this.auth.hostId,
          this.auth.hostToken,
        )
        if (live) snapshot = live
      }
      const flag = path.join(app.getPath("userData"), "cloud-home-return.json")
      await syncCloudHandoff({
        serverUrl: this.auth.serverUrl,
        hostId: this.auth.hostId,
        hostToken: this.auth.hostToken,
        snapshot,
        writeSnapshot: (next) => fs.writeFileSync(file, JSON.stringify(next, null, 2)),
        onCopiedBack: () =>
          fs.writeFileSync(flag, JSON.stringify({ cloudUrl: this.auth?.serverUrl ?? "" })),
      })
      await this.importReturnedHome(file, flag)
    } catch (error) {
      console.warn("[desktop] cloud copy skipped", error)
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.beating) return
    this.beating = true
    try {
      // Apps and their model lists go up once a minute; the server keeps the last list between.
      // The scan runs on its own so a slow app never holds up the heartbeat (and the Mac never
      // looks offline while models are read); its result goes up with the next heartbeat.
      if (!this.scanning && (this.forceScan || Date.now() - this.lastAgentsScan > 60_000)) {
        const fresh = this.forceScan
        this.forceScan = false
        this.lastAgentsScan = Date.now()
        this.scanning = this.deps
          .detectLocalAgents({ fresh })
          .then((agents) => {
            this.agents = agents
            this.scanned = agents
          })
          .catch(() => undefined)
          .finally(() => {
            this.scanning = null
          })
      }
      const localAgents = this.scanned ?? undefined
      this.scanned = null
      let storage: LocalStorageReport | undefined
      if (Date.now() - this.lastStorageScan > 10 * 60_000) {
        this.lastStorageScan = Date.now()
        this.storage = await measureLocalStorage().catch(() => this.storage)
        storage = this.storage ?? undefined
      }
      const reply = await this.post<HeartbeatReply>("/api/desktop/heartbeat", {
        permissions: permissionState(),
        ...(localAgents ? { localAgents } : {}),
        ...(storage ? { storage } : {}),
      })
      if (!reply) {
        // Not delivered: send this list again with the next heartbeat.
        if (localAgents && !this.scanned) this.scanned = localAgents
        return
      }
      this.lastReply = reply
      const rescan = reply.settings.agentsRescanAt ?? null
      if (rescan && rescan !== this.rescanSeen) {
        // The first value seen is history; a new one is someone pressing refresh.
        if (this.rescanSeen !== null) this.forceScan = true
        this.rescanSeen = rescan
      }
      this.deps.onHeartbeat?.(reply)
      void this.maybeCloudHandoff()
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
        detail:
          "Only allow this if you asked for it. Without an answer in 30 seconds it is refused.",
        signal: abort.signal,
      })
      return result.response === 0
    } catch {
      return false
    } finally {
      clearTimeout(timeout)
    }
  }

  private async handleSession(
    session: HeartbeatReply["sessions"][number],
    settings: HeartbeatReply["settings"],
  ): Promise<void> {
    const deny = (reason: string) =>
      this.post(`/api/desktop/sessions/${session.id}`, { action: "deny", reason })
    if (!session.offer) return void deny("No connection offer")
    if (permissionState().screen !== "granted") {
      if (process.platform === "darwin") {
        // Asking makes macOS show its own prompt / add the app to the list.
        void desktopCapturer.getSources({ types: ["screen"] }).catch(() => {})
      }
      return void deny("Screen Recording isn't allowed for Sayabot on this computer yet.")
    }
    if (
      settings.askOnComputer !== false &&
      !(await this.askAtComputer(session.viewerName, session.control))
    ) {
      return void deny("Not allowed on the computer")
    }
    const display = screen.getPrimaryDisplay()
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
    })
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    if (!source) return void deny("No screen to share")

    const control =
      session.control && this.injector.supported && permissionState().accessibility === "granted"
    this.active.set(session.id, { control })
    const win = this.ensureCaptureWindow()
    const send = () =>
      win.webContents.send("remote-host:start", {
        sessionId: session.id,
        offer: session.offer,
        sourceId: source.id,
      })
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
    if (
      process.platform === "darwin" &&
      event.t === "key" &&
      typeof event.key === "string" &&
      KEY_CODES[event.key] !== undefined
    ) {
      event.code = KEY_CODES[event.key]
    }
    this.injector.send(event)
  }
}
