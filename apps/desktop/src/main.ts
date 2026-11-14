import { app, BrowserWindow, dialog, ipcMain, Menu, MenuItemConstructorOptions, shell } from "electron"
import * as path from "node:path"
import * as fs from "node:fs"
import { DesktopHost } from "./host"
import { detectLocalAgents } from "./local-agents"
import { LocalMcpHost } from "./local-mcp"
import { LocalRunner } from "./runner"
import { VaultRunner } from "./vault-cli"

const DEFAULT_SERVER_URL = "https://sayabot.sayalabs.in"
const CONFIG_FILE = "sayabot-config.json"
const SESSION_FILE = "sayabot-session.json"

interface AuthSession {
  accessToken: string
  refreshToken: string
  email: string
  userId: string
  serverUrl: string
  /** Started without an account (Supabase anonymous user); cleared once the account is saved. */
  isGuest?: boolean
}

interface DesktopConfig {
  serverUrl: string
  enableLocalRunner: boolean
  /** Set after an explicit sign-out, so we show the sign-in card instead of a fresh guest. */
  guestDeclined?: boolean
}

let mainWindow: BrowserWindow | null = null
let host: DesktopHost | null = null
let runner: LocalRunner | null = null
let vaults: VaultRunner | null = null
let localMcp: LocalMcpHost | null = null

/** Remote desktop + local runner: this computer as a Sayabot host, once someone is signed in. */
function startHost(): void {
  if (!loadSession()) return
  if (!host) {
    host = new DesktopHost({
      getServerUrl: () => loadSession()?.serverUrl ?? loadConfig().serverUrl,
      getSession: () => loadSession(),
      onSessionUpdate: (updated) => {
        const cur = loadSession()
        if (cur) {
          saveSession({ ...cur, accessToken: updated.accessToken, refreshToken: updated.refreshToken })
        }
      },
      detectLocalAgents: async () =>
        (await detectLocalAgents()).map((a) => ({ id: a.id, name: a.name, status: a.status, version: a.version })),
      // The local runner picks up work after each heartbeat (one job at a time).
      onHeartbeat: (reply) => {
        localRunnerRunning = Boolean(reply.settings.runnerEnabled)
        void runner?.maybeRun(reply.queuedJobs, Boolean(reply.settings.runnerEnabled))
        void vaults?.maybeRun(reply.secretJobs ?? 0)
        void localMcp?.maybeRun(reply.mcpCalls ?? 0)
      },
    })
    runner = new LocalRunner(host)
    vaults = new VaultRunner(host)
    localMcp = new LocalMcpHost(host)
  }
  void host.start()
}
let pendingDeepLinkUrl: string | null = null
let localRunnerRunning = false

function getUserDataDir(): string {
  return app.getPath("userData")
}

function loadConfig(): DesktopConfig {
  try {
    const filePath = path.join(getUserDataDir(), CONFIG_FILE)
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8")
      return { serverUrl: DEFAULT_SERVER_URL, enableLocalRunner: true, ...JSON.parse(data) }
    }
  } catch (err) {
    console.error("Failed to load desktop config:", err)
  }
  return { serverUrl: DEFAULT_SERVER_URL, enableLocalRunner: true }
}

function saveConfig(config: DesktopConfig): void {
  try {
    const filePath = path.join(getUserDataDir(), CONFIG_FILE)
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf-8")
  } catch (err) {
    console.error("Failed to save desktop config:", err)
  }
}

function loadSession(): AuthSession | null {
  try {
    const filePath = path.join(getUserDataDir(), SESSION_FILE)
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf-8")
      return JSON.parse(data)
    }
  } catch (err) {
    console.error("Failed to load session:", err)
  }
  return null
}

function saveSession(session: AuthSession | null): void {
  try {
    const filePath = path.join(getUserDataDir(), SESSION_FILE)
    if (session) {
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2), "utf-8")
    } else if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch (err) {
    console.error("Failed to write session file:", err)
  }
}

function loadLocalHtml() {
  if (!mainWindow) return
  const distRendererPath = path.join(__dirname, "renderer", "index.html")
  const srcRendererPath = path.join(__dirname, "..", "src", "renderer", "index.html")
  const targetHtml = fs.existsSync(distRendererPath) ? distRendererPath : srcRendererPath
  mainWindow.loadFile(targetHtml)
}

function handleDeepLink(urlStr: string): void {
  console.log("[Sayabot Desktop] Received deep link:", urlStr)
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== "sayabot:") return

    if (parsed.host === "auth" || parsed.pathname.includes("callback")) {
      const params = parsed.searchParams
      const accessToken = params.get("access_token")
      const refreshToken = params.get("refresh_token")
      const email = params.get("email") || ""
      const userId = params.get("user_id") || ""
      const serverUrl = params.get("server_url") || loadConfig().serverUrl

      if (accessToken && refreshToken) {
        const session: AuthSession = {
          accessToken,
          refreshToken,
          email,
          userId,
          serverUrl,
          isGuest: false,
        }
        // Switching accounts: this Mac registers again under the new user. Coming from a
        // guest, the merge already moved this computer into the new account, so keep it.
        const previous = loadSession()
        if (previous && previous.userId !== userId && !previous.isGuest) host?.forget()
        saveSession(session)
        startHost()

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("auth:session-updated", session)
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
          void openWorkspaceInWindow()
        }
      }
    }
  } catch (err) {
    console.error("Error processing deep link:", err)
  }
}

// Register protocol handler for macOS
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("sayabot", process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient("sayabot")
}

// Single instance enforcement
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
    const deepLinkArg = argv.find((arg) => arg.startsWith("sayabot://"))
    if (deepLinkArg) {
      handleDeepLink(deepLinkArg)
    }
  })
}

// macOS open-url event
app.on("open-url", (event, urlStr) => {
  event.preventDefault()
  if (app.isReady() && mainWindow) {
    handleDeepLink(urlStr)
  } else {
    pendingDeepLinkUrl = urlStr
  }
})

function parseSemver(v: string): [number, number, number] {
  const parts = v
    .replace(/^v/, "")
    .split(".")
    .map((x) => parseInt(x, 10) || 0)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function isNewerVersion(current: string, latest: string): boolean {
  const [cMaj, cMin, cPat] = parseSemver(current)
  const [lMaj, lMin, lPat] = parseSemver(latest)
  if (lMaj > cMaj) return true
  if (lMaj === cMaj && lMin > cMin) return true
  if (lMaj === cMaj && lMin === cMin && lPat > cPat) return true
  return false
}

export interface DesktopUpdateResult {
  isUpdateAvailable: boolean
  currentVersion: string
  latestVersion?: string
  dmgUrl?: string
  releaseNotes?: string
  error?: string
}

/** The release has one DMG per architecture; send Intel Macs to the Intel one. */
function dmgForThisMac(url: string): string {
  return process.arch === "x64" ? url.replace("Sayabot-arm64.dmg", "Sayabot-x64.dmg") : url
}

/** Automatic checks prompt once per new version per launch, so "Later" isn't nagged again. */
let promptedUpdateVersion: string | null = null

async function checkDesktopUpdates(manual = false): Promise<DesktopUpdateResult> {
  const currentVersion = app.getVersion()
  const config = loadConfig()
  const session = loadSession()
  const base = (session?.serverUrl || config.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, "")

  try {
    const res = await fetch(`${base}/api/version`, {
      headers: { Accept: "application/json" },
    })
    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`)
    }
    const data = (await res.json()) as {
      version?: string
      latestDesktopVersion?: string
      dmgUrl?: string
      releaseNotes?: string
    }

    const latest = data.latestDesktopVersion || data.version || currentVersion
    const updateAvailable = isNewerVersion(currentVersion, latest)
    const dmgUrl = dmgForThisMac(
      data.dmgUrl ||
        "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-arm64.dmg",
    )
    const releaseNotes =
      data.releaseNotes || "A new version of Sayabot for Mac is available."

    if (updateAvailable) {
      const shouldPrompt = manual || promptedUpdateVersion !== latest
      if (shouldPrompt && mainWindow && !mainWindow.isDestroyed()) {
        promptedUpdateVersion = latest
        const choice = await dialog.showMessageBox(mainWindow, {
          type: "info",
          title: "Update Available",
          message: `Sayabot v${latest} is now available!`,
          detail: `${releaseNotes}\n\n(Current version: v${currentVersion})`,
          buttons: ["Download Update", "Later"],
          defaultId: 0,
          cancelId: 1,
        })
        if (choice.response === 0) {
          void shell.openExternal(dmgUrl)
        }
      }
      return {
        isUpdateAvailable: true,
        currentVersion,
        latestVersion: latest,
        dmgUrl,
        releaseNotes,
      }
    }

    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "You're Up to Date",
        message: "You're running the latest version of Sayabot for Mac.",
        detail: `Version: v${currentVersion}`,
        buttons: ["OK"],
      })
    }

    return {
      isUpdateAvailable: false,
      currentVersion,
      latestVersion: latest,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn("[Sayabot Desktop] Update check failed:", msg)
    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "Update Check Failed",
        message: "Could not check for updates.",
        detail: msg,
        buttons: ["OK"],
      })
    }
    return {
      isUpdateAvailable: false,
      currentVersion,
      error: msg,
    }
  }
}

function buildAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Sayabot",
      submenu: [
        { label: "About Sayabot", role: "about" },
        {
          label: "Check for Updates…",
          click: () => {
            void checkDesktopUpdates(true)
          },
        },
        {
          label: "Restart to Apply Update",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            app.relaunch()
            app.exit(0)
          },
        },
        { type: "separator" },
        {
          label: "Return to Controller",
          accelerator: "CmdOrCtrl+H",
          click: () => loadLocalHtml(),
        },
        {
          label: "Open Workspace in Window",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            void openWorkspaceInWindow()
          },
        },
        {
          // Guests: sign in (or sign up) in the browser and bring the guest data along.
          label: "Sign In to Existing Account…",
          click: () => void signInFromMenu(),
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#070907",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  buildAppMenu()

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  const session = loadSession()
  if (session && session.accessToken) {
    console.log("[Sayabot Desktop] Active session found, opening workspace directly...")
    void openWorkspaceInWindow()
  } else {
    // The controller page starts guest mode (or shows the sign-in card) on its own.
    console.log("[Sayabot Desktop] No session found, loading controller...")
    loadLocalHtml()
  }

  if (pendingDeepLinkUrl) {
    setTimeout(() => {
      handleDeepLink(pendingDeepLinkUrl!)
      pendingDeepLinkUrl = null
    }, 500)
  }
}

async function refreshSessionIfNeeded(force = false): Promise<AuthSession | null> {
  const session = loadSession()
  if (!session || !session.refreshToken) return null

  let isNearExpiry = force
  if (!isNearExpiry && session.accessToken) {
    try {
      const parts = session.accessToken.split(".")
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1]!, "base64").toString())
        if (typeof payload.exp === "number") {
          const nowSec = Math.floor(Date.now() / 1000)
          isNearExpiry = payload.exp - nowSec < 600 // Expiring within 10 minutes
        }
      }
    } catch {
      isNearExpiry = true
    }
  }

  if (!isNearExpiry) return session

  console.log("[Sayabot Desktop] Refreshing auth token...")
  try {
    const cleanUrl = session.serverUrl.replace(/\/+$/, "")
    const res = await fetch(`${cleanUrl}/api/desktop/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    })
    if (res.status === 401) {
      // The login is gone for good (revoked, expired, or the user was deleted, e.g. a merged
      // guest). Drop it so the start page can begin guest mode or ask to sign in again.
      console.warn("[Sayabot Desktop] Saved login is no longer valid; signing out locally")
      saveSession(null)
      return null
    }
    if (!res.ok) {
      console.warn(`[Sayabot Desktop] Refresh token request failed (HTTP ${res.status})`)
      return session
    }
    const data = (await res.json()) as {
      accessToken?: string
      refreshToken?: string
      isAnonymous?: boolean
      email?: string
      userId?: string
    }
    if (data.accessToken && data.refreshToken) {
      const updated: AuthSession = {
        ...session,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        email: data.email || session.email,
        userId: data.userId || session.userId,
        isGuest: typeof data.isAnonymous === "boolean" ? data.isAnonymous : session.isGuest,
      }
      saveSession(updated)
      if (host) {
        startHost()
      }
      console.log("[Sayabot Desktop] Refreshed and persisted new session tokens.")
      return updated
    }
  } catch (err) {
    console.error("[Sayabot Desktop] Token refresh error:", err)
  }
  return session
}

// Background session keeper: refresh tokens every 15 minutes so they never expire
setInterval(() => {
  void refreshSessionIfNeeded()
}, 15 * 60 * 1000)

async function openWorkspaceInWindow() {
  const session = await refreshSessionIfNeeded()
  if (!mainWindow) return
  if (!session) {
    loadLocalHtml()
    return
  }
  const cleanUrl = session.serverUrl.replace(/\/+$/, "")
  // Authenticate seamlessly via /auth/complete hash tokens
  const targetUrl = `${cleanUrl}/auth/complete#access_token=${session.accessToken}&refresh_token=${session.refreshToken}`
  mainWindow.loadURL(targetUrl)
}

// IPC Handlers
ipcMain.handle("auth:get-session", () => {
  return loadSession()
})

function openBrowserAuth(): void {
  const config = loadConfig()
  const authUrl = `${config.serverUrl.replace(/\/+$/, "")}/login?force=true&next=/auth/desktop`
  console.log("[Sayabot Desktop] Launching browser auth:", authUrl)
  void shell.openExternal(authUrl)
}

ipcMain.handle("auth:start-browser-auth", () => openBrowserAuth())

/**
 * A guest signing in keeps their data: ask the server for a merge link (authenticated with the
 * guest's own token) and finish in the browser. The browser hands the new login back via
 * sayabot://auth/callback once the person confirms.
 */
async function signInFromMenu(): Promise<void> {
  const session = await refreshSessionIfNeeded()
  if (!session?.isGuest) {
    openBrowserAuth()
    return
  }
  try {
    const base = session.serverUrl.replace(/\/+$/, "")
    const res = await fetch(`${base}/api/account/merge`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${session.accessToken}` },
      body: JSON.stringify({ next: "/auth/desktop" }),
    })
    const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
    if (!res.ok || !data.url) throw new Error(data.error || `HTTP ${res.status}`)
    console.log("[Sayabot Desktop] Opening browser to save guest account")
    void shell.openExternal(data.url)
  } catch (err) {
    // Plain sign-in still works; the guest workspace just stays with the guest.
    console.warn("[Sayabot Desktop] Could not start guest merge, falling back to sign-in:", err)
    openBrowserAuth()
  }
}

// ---------- Guest mode: open the app without signing in ----------

interface GuestConfig {
  enabled?: boolean
  supabaseUrl?: string
  anonKey?: string
}

/**
 * Creates an anonymous Supabase user for this Mac. The server only says whether guests are
 * allowed and where Supabase is; the sign-up goes from this Mac so its own IP is rate limited.
 */
async function createGuestSession(serverUrl: string): Promise<AuthSession> {
  const base = serverUrl.replace(/\/+$/, "")
  const configRes = await fetch(`${base}/api/desktop/guest`)
  if (!configRes.ok) throw new Error(`guest mode unavailable (HTTP ${configRes.status})`)
  const config = (await configRes.json()) as GuestConfig
  if (!config.enabled || !config.supabaseUrl || !config.anonKey) {
    throw new Error("guest mode is turned off on this server")
  }

  const signupRes = await fetch(`${config.supabaseUrl.replace(/\/+$/, "")}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: config.anonKey,
      authorization: `Bearer ${config.anonKey}`,
    },
    // No email or password: Supabase creates an anonymous user.
    body: JSON.stringify({ data: { signup_source: "desktop_guest" } }),
  })
  const body = (await signupRes.json().catch(() => ({}))) as {
    access_token?: string
    refresh_token?: string
    user?: { id?: string }
    msg?: string
    message?: string
    error_description?: string
  }
  if (!signupRes.ok || !body.access_token || !body.refresh_token || !body.user?.id) {
    const reason = body.msg || body.message || body.error_description || `HTTP ${signupRes.status}`
    throw new Error(`could not start guest session: ${reason}`)
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    email: "",
    userId: body.user.id,
    serverUrl: base,
    isGuest: true,
  }
}

let guestInFlight: Promise<{ ok: boolean; error?: string }> | null = null

ipcMain.handle("auth:guest-status", () => ({
  autoStart: !loadSession() && !loadConfig().guestDeclined,
}))

ipcMain.handle("auth:start-guest", () => {
  if (loadSession()) return { ok: true }
  guestInFlight ??= (async () => {
    try {
      const config = loadConfig()
      const session = await createGuestSession(config.serverUrl)
      if (config.guestDeclined) saveConfig({ ...config, guestDeclined: false })
      saveSession(session)
      startHost()
      console.log("[Sayabot Desktop] Started guest session.")
      void openWorkspaceInWindow()
      return { ok: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn("[Sayabot Desktop] Guest mode failed:", message)
      return { ok: false, error: message }
    } finally {
      guestInFlight = null
    }
  })()
  return guestInFlight
})

ipcMain.handle("auth:sign-out", async () => {
  // Don't drop a signed-out person straight into a new guest workspace on next launch.
  saveConfig({ ...loadConfig(), guestDeclined: true })
  saveSession(null)
  host?.forget()
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      await mainWindow.webContents.session.clearStorageData()
    } catch (e) {
      // ignore
    }
    loadLocalHtml()
    mainWindow.webContents.send("auth:session-updated", null)
  }
})

ipcMain.handle("config:get-server-url", () => {
  return loadConfig().serverUrl
})

ipcMain.handle("config:set-server-url", (_event, url: string) => {
  const cleanUrl = (url || DEFAULT_SERVER_URL).trim().replace(/\/+$/, "")
  const config = loadConfig()
  config.serverUrl = cleanUrl
  saveConfig(config)
  return cleanUrl
})

ipcMain.handle("workspace:open-in-window", async () => {
  await openWorkspaceInWindow()
})

ipcMain.handle("workspace:open-in-browser", () => {
  const session = loadSession()
  const config = loadConfig()
  const base = session?.serverUrl || config.serverUrl
  shell.openExternal(`${base.replace(/\/+$/, "")}/login`)
})

ipcMain.handle("workspace:return-to-controller", () => {
  loadLocalHtml()
})

ipcMain.handle("runner:get-status", () => {
  return { running: localRunnerRunning, busy: runner?.running ?? false, port: 4100 }
})

ipcMain.handle("host:get-status", () => ({
  registered: Boolean(host?.credentials),
  settings: host?.lastReply?.settings ?? null,
}))

// The runner is turned on per computer in Sayabot (Settings → Computers), so every device
// sees the same switch; here we only report what the server says.
ipcMain.handle("runner:toggle", () => {
  return { running: localRunnerRunning, busy: runner?.running ?? false, port: 4100 }
})

ipcMain.handle("app:restart", () => {
  console.log("[Sayabot Desktop] Restarting application upon update request...")
  app.relaunch()
  app.exit(0)
})

ipcMain.handle("app:get-version", () => {
  return app.getVersion()
})

ipcMain.handle("app:check-for-updates", async (_event, manual?: boolean) => {
  return await checkDesktopUpdates(manual ?? true)
})

// ---------- Usage: plan limits and coding-tool token history read on this Mac ----------

interface UsageModule {
  readPlanLimits: (force?: boolean) => Promise<unknown[]>
  readLocalUsage: (days: number) => Promise<{ available: boolean; events: unknown[] }>
}

let usageModule: UsageModule | null = null

/** Built separately (esbuild) because it bundles @sayabot/core; loaded on first use. */
function usage(): UsageModule {
  if (!usageModule) usageModule = require(path.join(__dirname, "usage.js")) as UsageModule
  return usageModule
}

/** Only the Sayabot workspace (or this app's own screens) may ask for usage. */
function fromWorkspace(event: Electron.IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? ""
  if (url.startsWith("file://")) return true
  const base = loadSession()?.serverUrl ?? loadConfig().serverUrl
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

ipcMain.handle("usage:plan-limits", async (event, force?: boolean) => {
  if (!fromWorkspace(event)) return []
  try {
    return await usage().readPlanLimits(force === true)
  } catch (error) {
    console.error("[Sayabot Desktop] Could not read plan limits", error)
    return []
  }
})

ipcMain.handle("usage:local", async (event, days?: number) => {
  if (!fromWorkspace(event)) return { available: false, events: [] }
  try {
    return await usage().readLocalUsage(Number(days) || 30)
  } catch (error) {
    console.error("[Sayabot Desktop] Could not read local usage", error)
    return { available: false, events: [] }
  }
})

app.whenReady().then(() => {
  createWindow()
  startHost()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Look for a newer Mac app shortly after launch, then every 6 hours.
  setTimeout(() => void checkDesktopUpdates(false), 15_000)
  setInterval(() => void checkDesktopUpdates(false), 6 * 60 * 60 * 1000)
})

app.on("before-quit", () => {
  runner?.stop()
  host?.stop()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
