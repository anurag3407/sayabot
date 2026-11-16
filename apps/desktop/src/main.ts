import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  Notification,
  shell,
} from "electron"
import * as path from "node:path"
import * as fs from "node:fs"
import {
  canReplace,
  downloadFile,
  inspectDmg,
  installTarget,
  runDetached,
  stageMacUpdate,
} from "./mac-install"
import {
  canReplaceWin,
  inspectWinZip,
  installTargetWin,
  runDetachedWin,
  stageWinUpdate,
} from "./win-install"
import { DesktopUpdater, type VersionInfo } from "./updater"
import {
  fetchWorkspaceSnapshot,
  leaveCloudHome,
  type LocalWorkspaceSnapshot,
} from "./cloud-handoff"
import { DesktopHost, loadHostAuth } from "./host"
import { detectLocalAgents } from "./local-agents"
import { LocalMcpHost } from "./local-mcp"
import { LocalRunner, type ApprovalNotice } from "./runner"
import { normalizeServerUrl } from "./server-url"
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
  /** The person picked where to use Sayabot (Sayabot Cloud or their own server). */
  serverChosen?: boolean
  /** That server's name and whether it allows starting without an account (from /api/instance). */
  serverName?: string
  serverGuestMode?: boolean
}

/** What a Sayabot server says about itself (GET /api/instance). */
interface ServerInfo {
  ok: true
  url: string
  name: string
  edition: "self-hosted" | "cloud"
  guestMode: boolean
}

/** Asks a server whether it's Sayabot; plain-language errors for the start screen. */
async function checkServer(input: string): Promise<ServerInfo | { ok: false; error: string }> {
  const url = normalizeServerUrl(input)
  if (!url) return { ok: false, error: "That doesn't look like a web address." }
  try {
    // Ask the new and the older endpoints at once, so a check takes one round trip.
    const legacyCheck = checkLegacyServer(url)
    const res = await fetch(`${url}/api/instance`, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    })
    const data = res.ok
      ? ((await res.json().catch(() => null)) as Record<string, unknown> | null)
      : null
    if (!data || data.sayabot !== true) {
      // Servers on an older Sayabot have no /api/instance yet, but they do answer these two.
      const legacy = await legacyCheck
      if (legacy) return legacy
      if (res.status >= 500)
        return { ok: false, error: `The server answered with an error (${res.status}).` }
      return { ok: false, error: "That server answered, but it isn't running Sayabot." }
    }
    return {
      ok: true,
      url,
      name: typeof data.name === "string" && data.name ? data.name : new URL(url).host,
      edition: data.edition === "cloud" ? "cloud" : "self-hosted",
      guestMode: data.guestMode === true,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/timeout|aborted/i.test(msg))
      return { ok: false, error: "The server didn't answer in time. Is it running?" }
    if (/ENOTFOUND|getaddrinfo/i.test(msg))
      return { ok: false, error: "Couldn't find that address. Check the spelling." }
    if (/certificate|SSL|TLS/i.test(msg))
      return { ok: false, error: "The server's HTTPS certificate isn't valid." }
    return {
      ok: false,
      error: "Couldn't reach that server. Check the address and your connection.",
    }
  }
}

async function checkLegacyServer(url: string): Promise<ServerInfo | null> {
  try {
    const [version, guest] = await Promise.all([
      fetch(`${url}/api/version`, { redirect: "manual", signal: AbortSignal.timeout(6_000) }),
      fetch(`${url}/api/desktop/guest`, { redirect: "manual", signal: AbortSignal.timeout(6_000) })
        .then((r) => (r.ok ? (r.json() as Promise<{ enabled?: boolean }>) : null))
        .catch(() => null),
    ])
    const info = version.ok
      ? ((await version.json().catch(() => null)) as Record<string, unknown> | null)
      : null
    if (!info || typeof info.latestDesktopVersion !== "string") return null
    return {
      ok: true,
      url,
      name: url === DEFAULT_SERVER_URL ? "Sayabot Cloud" : new URL(url).host,
      edition: url === DEFAULT_SERVER_URL ? "cloud" : "self-hosted",
      guestMode: guest?.enabled === true,
    }
  } catch {
    return null
  }
}

/**
 * Point this Mac at another Sayabot server. Signing in belongs to one server, so switching signs
 * out here and this computer registers again with the new server.
 */
async function useServer(info: ServerInfo): Promise<void> {
  const config = loadConfig()
  const switching = normalizeServerUrl(config.serverUrl) !== info.url
  if (switching && info.edition !== "cloud") {
    const auth = loadHostAuth(config.serverUrl)
    const file = path.join(app.getPath("userData"), "cloud-home.json")
    if (auth) {
      let saved: LocalWorkspaceSnapshot = { bots: [], chats: [], routines: [], keys: [] }
      try {
        saved = JSON.parse(fs.readFileSync(file, "utf8")) as LocalWorkspaceSnapshot
      } catch {
        // The server still holds the copy when this Mac has no file yet.
      }
      const back = await leaveCloudHome({
        nextEdition: info.edition,
        serverUrl: auth.serverUrl,
        hostId: auth.hostId,
        hostToken: auth.hostToken,
        snapshot: saved,
        writeSnapshot: (next) => fs.writeFileSync(file, JSON.stringify(next, null, 2)),
      }).catch(() => false)
      if (back) {
        fs.writeFileSync(
          path.join(app.getPath("userData"), "cloud-home-return.json"),
          JSON.stringify({ cloudUrl: config.serverUrl }),
        )
      }
    }
  }
  if (switching && info.edition === "cloud") {
    const auth = loadHostAuth(config.serverUrl)
    if (auth) {
      const snapshot = await fetchWorkspaceSnapshot(
        auth.serverUrl,
        auth.hostId,
        auth.hostToken,
      ).catch(() => null)
      if (snapshot) {
        fs.writeFileSync(
          path.join(app.getPath("userData"), "cloud-home.json"),
          JSON.stringify(snapshot, null, 2),
        )
      }
    }
  }
  saveConfig({
    ...config,
    serverUrl: info.url,
    serverChosen: true,
    serverName: info.name,
    serverGuestMode: info.guestMode,
    ...(switching ? { guestDeclined: false } : {}),
  })
  if (switching) {
    saveSession(null)
    runner?.stop()
    host?.stop()
    host = null
    runner = null
    vaults = null
    localMcp = null
  }
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
          saveSession({
            ...cur,
            accessToken: updated.accessToken,
            refreshToken: updated.refreshToken,
          })
        }
      },
      detectLocalAgents: async (opts) =>
        (await detectLocalAgents(opts)).map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          version: a.version,
          ...(a.account ? { account: a.account } : {}),
          ...(a.models ? { models: a.models } : {}),
        })),
      // The local runner picks up work after each heartbeat (one job at a time).
      onHeartbeat: (reply) => {
        localRunnerRunning = Boolean(reply.settings.runnerEnabled)
        void runner?.maybeRun(reply.queuedJobs, Boolean(reply.settings.runnerEnabled))
        void vaults?.maybeRun(reply.secretJobs ?? 0)
        void localMcp?.maybeRun(reply.mcpCalls ?? 0)
      },
    })
    runner = new LocalRunner(host, notifyApproval)
    vaults = new VaultRunner(host)
    localMcp = new LocalMcpHost(host)
  }
  void host.start()
}
/**
 * An agent running on this Mac wants to do something that needs a yes. The card with Allow /
 * Deny is in the chat (on every device); this notification brings the Mac's owner to it.
 */
function notifyApproval(notice: ApprovalNotice): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({
    title: `${notice.agentName} needs your OK`,
    body: `Wants to ${notice.step}. Open the chat to allow or deny.`,
    silent: false,
  })
  notification.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow()
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    const session = loadSession()
    if (notice.roomPath && session?.serverUrl) {
      void mainWindow.loadURL(`${session.serverUrl.replace(/\/+$/, "")}${notice.roomPath}`)
    }
  })
  notification.show()
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

/** Back to the start screen's "Sayabot Cloud or my own server" choice. */
async function changeServerFromMenu(): Promise<void> {
  const config = loadConfig()
  if (loadSession()) {
    const where = config.serverName || normalizeServerUrl(config.serverUrl) || "this server"
    const choice = await dialog.showMessageBox({
      type: "question",
      message: "Change server?",
      detail: `You'll be signed out of ${where} on this computer. Your data stays on that server, and you can come back any time.`,
      buttons: ["Change Server", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response !== 0) return
  }
  saveSession(null)
  runner?.stop()
  host?.stop()
  host = null
  runner = null
  vaults = null
  localMcp = null
  saveConfig({ ...config, serverChosen: false })
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else loadLocalHtml()
  mainWindow?.show()
}

async function connectFromLink(server: string): Promise<void> {
  const info = await checkServer(server)
  if (!info.ok) {
    await dialog.showMessageBox({
      type: "warning",
      message: "Couldn't connect to that Sayabot server",
      detail: info.error,
      buttons: ["OK"],
    })
    return
  }
  const current = normalizeServerUrl(loadConfig().serverUrl)
  if (current === info.url && loadSession()) {
    mainWindow?.show()
    return
  }
  const signedIn = Boolean(loadSession())
  const choice = await dialog.showMessageBox({
    type: "question",
    message: `Connect Sayabot to ${info.name}?`,
    detail: `${info.url}\n\nOnly connect to servers you trust.${signedIn ? " You'll be signed out of the server you use now." : ""}`,
    buttons: ["Connect", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice.response !== 0) return
  await useServer(info)
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else loadLocalHtml()
  mainWindow?.show()
}

function handleDeepLink(urlStr: string): void {
  console.log("[Sayabot Desktop] Received deep link:", urlStr)
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== "sayabot:") return

    // sayabot://connect?server=https://sayabot.acme.com — shown by a self-hosted server's
    // download page. Always confirmed: a link must never move someone's app to a stranger's server.
    if (parsed.host === "connect") {
      void connectFromLink(parsed.searchParams.get("server") ?? "")
      return
    }

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

// ---------- Updates: one state for the menu, the notification and the workspace page ----------

function updateServerBase(): string {
  const session = loadSession()
  return (session?.serverUrl || loadConfig().serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, "")
}

const updater = new DesktopUpdater({
  currentVersion: app.getVersion(),
  arch: process.arch,
  platform: process.platform === "win32" ? "win32" : "darwin",
  fetchVersion: async () => {
    const res = await fetch(`${updateServerBase()}/api/version`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`The server answered HTTP ${res.status}.`)
    return (await res.json()) as VersionInfo
  },
  download: downloadFile,
  inspect: (file) => (process.platform === "win32" ? inspectWinZip(file) : inspectDmg(file)),
  dmgPath: (version) =>
    path.join(
      app.getPath("temp"),
      "sayabot-updates",
      process.platform === "win32" ? `Sayabot-${version}.zip` : `Sayabot-${version}.dmg`,
    ),
  install: async (artifactPath, version) => {
    if (process.platform === "win32") {
      const target = installTargetWin(app.getPath("exe"))
      if (!canReplaceWin(target)) {
        void shell.openPath(artifactPath)
        throw new Error(
          `Sayabot can't replace itself in ${target}. The new version was downloaded: close Sayabot and run Sayabot Setup, or extract the zip over that folder.`,
        )
      }
      runDetachedWin(stageWinUpdate({ zipPath: artifactPath, target, version }))
      quitForUpdate()
      return
    }
    const target = installTarget(app.getPath("exe"))
    if (!canReplace(target)) {
      // No permission to swap the app: open the disk image so it can be dragged over by hand.
      void shell.openPath(artifactPath)
      throw new Error(
        `Sayabot can't replace itself in ${path.dirname(target)}. The new version is open in Finder: drag it to Applications.`,
      )
    }
    runDetached(stageMacUpdate({ dmgPath: artifactPath, target, version }))
    quitForUpdate()
  },
})

/** Quits so the helper can swap the app; force-exits if something holds the quit up. */
function quitForUpdate(): void {
  setTimeout(() => app.exit(0), 5_000).unref()
  app.quit()
}

/** Tell people once per version, even when the workspace page is older and has no update toast. */
let notifiedVersion: string | null = null

updater.onChange((state) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("app:update-state", state)
  }
  buildAppMenu()
  if (
    state.status === "available" &&
    notifiedVersion !== state.latest &&
    Notification.isSupported()
  ) {
    notifiedVersion = state.latest
    const note = new Notification({
      title: `Sayabot ${state.latest} is available`,
      body: "Click to install. Sayabot reopens by itself in about a minute.",
    })
    note.on("click", () => void updater.install())
    note.show()
  }
})

/** "Check for Updates…": the same check, with the answer in a dialog. */
async function checkForUpdatesWithDialog(): Promise<void> {
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined
  const show = (options: Electron.MessageBoxOptions) =>
    parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
  const before = updater.current
  if (before.status === "downloading" || before.status === "installing") {
    await show({
      type: "info",
      message: `Sayabot ${before.latest} is ${before.status === "installing" ? "installing" : "downloading"}`,
      detail:
        before.status === "downloading" && before.percent !== null
          ? `${before.percent}% done.`
          : "",
      buttons: ["OK"],
    })
    return
  }
  const state = await updater.check(true)
  if (state.status === "available") {
    const choice = await show({
      type: "info",
      message: `Sayabot ${state.latest} is available`,
      detail: `${state.notes ? `${state.notes}\n\n` : ""}You have ${state.current}. Sayabot closes, updates and reopens by itself.`,
      buttons: ["Install Now", "Later"],
      defaultId: 0,
      cancelId: 1,
    })
    if (choice.response === 0) void updater.install()
  } else if (state.status === "error") {
    await show({
      type: "warning",
      message: "Could not check for updates",
      detail: state.message,
      buttons: ["OK"],
    })
  } else {
    await show({
      type: "info",
      message: "Sayabot is up to date",
      detail: `You have version ${state.current}, the newest one.`,
      buttons: ["OK"],
    })
  }
}

/** The update line in the Sayabot menu, which always says what is going on. */
function updateMenuItem(): MenuItemConstructorOptions {
  const state = updater.current
  switch (state.status) {
    case "available":
      return { label: `Install Sayabot ${state.latest}…`, click: () => void updater.install() }
    case "downloading":
      return {
        label: `Downloading Sayabot ${state.latest}${state.percent !== null ? ` (${state.percent}%)` : ""}…`,
        enabled: false,
      }
    case "installing":
      return { label: `Installing Sayabot ${state.latest}…`, enabled: false }
    case "checking":
      return { label: "Checking for Updates…", enabled: false }
    case "error":
      return state.latest
        ? {
            label: `Retry Installing Sayabot ${state.latest}…`,
            click: () => void updater.install(),
          }
        : { label: "Check for Updates…", click: () => void checkForUpdatesWithDialog() }
    default:
      return { label: "Check for Updates…", click: () => void checkForUpdatesWithDialog() }
  }
}

function buildAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "Sayabot",
      submenu: [
        { label: "About Sayabot", role: "about" },
        updateMenuItem(),
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
        {
          label: "Change Server…",
          click: () => void changeServerFromMenu(),
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
  const darwinChrome =
    process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } }
      : {}
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    ...darwinChrome,
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
setInterval(
  () => {
    void refreshSessionIfNeeded()
  },
  15 * 60 * 1000,
)

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
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${session.accessToken}`,
      },
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

ipcMain.handle("auth:guest-status", () => {
  const config = loadConfig()
  const signedIn = Boolean(loadSession())
  // Sayabot Cloud always allows starting without an account; a self-hosted server says so itself.
  const guestAllowed = config.serverGuestMode !== false
  return {
    needsServerChoice: !signedIn && !config.serverChosen,
    autoStart: !signedIn && Boolean(config.serverChosen) && !config.guestDeclined && guestAllowed,
    guestAllowed,
  }
})

ipcMain.handle("config:server-info", () => {
  const config = loadConfig()
  const url = normalizeServerUrl(config.serverUrl) ?? DEFAULT_SERVER_URL
  return {
    url,
    name: config.serverName || (url === DEFAULT_SERVER_URL ? "Sayabot Cloud" : new URL(url).host),
    isCloud: url === DEFAULT_SERVER_URL,
    chosen: Boolean(config.serverChosen),
  }
})

ipcMain.handle("config:check-server", (_event, input: string) => checkServer(input))

/** The start screen's choice: Sayabot Cloud, or a server the person typed (checked first). */
ipcMain.handle("config:choose-server", async (_event, input: string | null) => {
  const info = await checkServer(input || DEFAULT_SERVER_URL)
  if (!info.ok) {
    // Sayabot Cloud being briefly unreachable shouldn't block choosing it.
    if (!input) {
      await useServer({
        ok: true,
        url: DEFAULT_SERVER_URL,
        name: "Sayabot Cloud",
        edition: "cloud",
        guestMode: true,
      })
      return { ok: true, url: DEFAULT_SERVER_URL, name: "Sayabot Cloud", guestMode: true }
    }
    return info
  }
  await useServer(input ? info : { ...info, name: "Sayabot Cloud" })
  return {
    ok: true,
    url: info.url,
    name: input ? info.name : "Sayabot Cloud",
    guestMode: info.guestMode,
  }
})

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
  const cleanUrl = normalizeServerUrl(url) ?? DEFAULT_SERVER_URL
  const config = loadConfig()
  config.serverUrl = cleanUrl
  config.serverChosen = true
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

// Older workspace pages call this from their "update ready" toast. It only ever meant "load the
// newest page", so reload instead of relaunching the whole app (which updated nothing).
ipcMain.handle("app:restart", (event) => {
  event.sender.reloadIgnoringCache()
})

ipcMain.handle("app:get-version", () => {
  return app.getVersion()
})

ipcMain.handle("app:check-for-updates", async (_event, manual?: boolean) => {
  if (manual ?? true) await checkForUpdatesWithDialog()
  else await updater.check(false)
  return updater.current
})

ipcMain.handle("app:get-update-state", () => updater.current)

ipcMain.handle("app:install-update", () => {
  void updater.install()
  return updater.current
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
  // Windows delivers sayabot:// on the first process argv. macOS uses the open-url event.
  if (process.platform === "win32") {
    const deepLinkArg = process.argv.find((arg) => arg.startsWith("sayabot://"))
    if (deepLinkArg) pendingDeepLinkUrl = deepLinkArg
  }
  createWindow()
  startHost()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  // Look for a newer Mac app shortly after launch, every hour, and when you come back to the app
  // (at most every 10 minutes). Checks never interrupt you; the menu, a notification and the
  // workspace page say when one is ready.
  let lastUpdateCheck = Date.now()
  const checkSoon = () => {
    lastUpdateCheck = Date.now()
    void updater.check(false)
  }
  setTimeout(checkSoon, 15_000)
  setInterval(checkSoon, 60 * 60 * 1000)
  app.on("browser-window-focus", () => {
    if (Date.now() - lastUpdateCheck > 10 * 60 * 1000) checkSoon()
  })
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
