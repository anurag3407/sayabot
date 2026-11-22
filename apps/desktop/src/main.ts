import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  Notification,
  session,
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
import { AgentLogin } from "./agent-login"
import { detectLocalAgents } from "./local-agents"
import { LocalMcpHost } from "./local-mcp"
import { LocalRunner, type ApprovalNotice } from "./runner"
import { readJsonFile, removeJsonFile, writeJsonAtomic } from "./durable-json"
import { platformMcpConfig } from "./platform-mcp"
import { normalizeServerUrl } from "./server-url"
import { VaultRunner } from "./vault-cli"
import {
  startEmbeddedEngine,
  stopEmbeddedEngine,
  createLocalSession,
  getEmbeddedEngineStatus,
} from "./embedded-engine"

export const DEFAULT_SERVER_URL =
  process.env.SAYABOT_SERVER_URL || process.env.DEFAULT_SERVER_URL || "https://sayabot.sayalabs.in"
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
      name: url.includes("localhost") ? "Local Server" : new URL(url).host,
      edition: "self-hosted",
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
        const enabled = Boolean(reply?.settings?.runnerEnabled)
        localRunnerRunning = enabled
        void runner?.maybeRun(reply?.queuedJobs ?? 0, enabled)
        void vaults?.maybeRun(reply?.secretJobs ?? 0)
        void localMcp?.maybeRun(reply?.mcpCalls ?? 0)
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

export function loadConfig(): DesktopConfig {
  try {
    const data = readJsonFile<Partial<DesktopConfig>>(path.join(getUserDataDir(), CONFIG_FILE))
    if (data) {
      if (
        !process.env.SAYABOT_SERVER_URL &&
        (data.serverUrl === "http://localhost:7431" || data.serverUrl === "http://127.0.0.1:7431")
      ) {
        data.serverUrl = DEFAULT_SERVER_URL
        data.serverChosen = true
        data.serverName = "This Mac"
        saveSession(null)
      }
      return { serverUrl: DEFAULT_SERVER_URL, enableLocalRunner: true, ...data }
    }
  } catch (err) {
    console.error("Failed to load desktop config:", err)
  }
  return { serverUrl: DEFAULT_SERVER_URL, enableLocalRunner: true }
}

/** True only after Sayabot → Change Server…, until this Mac is used again or a server is saved. */
let serverSetupRequested = false

/**
 * First launch: uses Sayabot on this Mac by default. A server address is entered later from Change Server.
 * If SAYABOT_SERVER_URL environment variable is provided, connect to it automatically.
 */
export function useThisMacOnFirstLaunch(): void {
  const config = loadConfig()
  if (config.serverChosen === true) return
  const serverUrl =
    normalizeServerUrl(process.env.SAYABOT_SERVER_URL || config.serverUrl) ?? DEFAULT_SERVER_URL
  saveConfig({
    ...config,
    serverUrl,
    serverChosen: true,
    serverName: "This Mac",
    serverGuestMode: true,
  })
}

export function saveConfig(config: DesktopConfig): void {
  try {
    writeJsonAtomic(path.join(getUserDataDir(), CONFIG_FILE), config, 0o644)
  } catch (err) {
    console.error("Failed to save desktop config:", err)
  }
}

export function loadSession(): AuthSession | null {
  const session = readJsonFile<AuthSession>(path.join(getUserDataDir(), SESSION_FILE))
  if (!session) return null
  const config = loadConfig()
  const configUrl = normalizeServerUrl(config.serverUrl)
  const sessionUrl = normalizeServerUrl(session.serverUrl)
  if (configUrl && sessionUrl && configUrl !== sessionUrl) {
    saveSession(null)
    return null
  }
  return session
}

export function saveSession(session: AuthSession | null): void {
  try {
    const filePath = path.join(getUserDataDir(), SESSION_FILE)
    if (session) writeJsonAtomic(filePath, session, 0o600)
    else removeJsonFile(filePath)
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

/** Opens the server address form. A relaunch with no new address keeps using this Mac. */
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
  serverSetupRequested = true
  saveConfig({ ...config, serverChosen: true })
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  else loadLocalHtml()
  mainWindow?.show()
}

/** Copies an MCP snippet for the server this Mac is using. The key is a placeholder. */
async function copyPlatformMcpConfig(): Promise<void> {
  const serverUrl = normalizeServerUrl(loadConfig().serverUrl)
  if (!serverUrl) {
    await dialog.showMessageBox({
      type: "info",
      message: "Connect to a server first",
      detail: "Choose the local workspace or your own server, then copy the MCP config.",
    })
    return
  }
  const snippet = platformMcpConfig(serverUrl)
  if (!snippet.ok) {
    await dialog.showMessageBox({
      type: "warning",
      message: "Couldn't build the MCP config",
      detail: snippet.error,
    })
    return
  }
  clipboard.writeText(snippet.text)
  await dialog.showMessageBox({
    type: "info",
    message: "MCP config copied",
    detail: snippet.note,
  })
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

// A menu-check launch must not take the installed app's single-instance lock.
// Unset, this does nothing and the packaged app keeps its normal name.
if (process.env.SAYABOT_MENU_CHECK === "1") {
  app.setName("SayabotMenuCheck")
}

// Register protocol handler for macOS. Skip during a menu check so this
// process does not become the handler for sayabot://.
if (process.env.SAYABOT_MENU_CHECK !== "1") {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient("sayabot", process.execPath, [path.resolve(process.argv[1])])
    }
  } else {
    app.setAsDefaultProtocolClient("sayabot")
  }
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

/**
 * Quits so the helper can swap the app. The login file and the cookie database are flushed
 * first: a hard exit mid-write is what made an update look like a brand-new empty account.
 */
function quitForUpdate(): void {
  void (async () => {
    try {
      await flushLiveSessionFromPage()
      await session.defaultSession.flushStorageData()
      await session.defaultSession.cookies.flushStore()
    } catch (err) {
      console.warn("[Sayabot Desktop] Could not flush local data before update:", err)
    }
    setTimeout(() => app.exit(0), 8_000).unref()
    app.quit()
  })()
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

/** True while the menu is being rebuilt, so navigation from setApplicationMenu cannot recurse. */
let rebuildingMenu = false

export function appMenuTemplate(): MenuItemConstructorOptions[] {
  const canGoBack = Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoBack(),
  )
  const canGoForward = Boolean(
    mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoForward(),
  )
  return [
    {
      label: "Sayabot",
      submenu: [
        { label: "About Sayabot", role: "about" },
        updateMenuItem(),
        { type: "separator" },
        {
          label: "Return to Controller",
          click: () => loadLocalHtml(),
        },
        {
          label: "Open Workspace in Window",
          click: () => {
            void openWorkspaceInWindow()
          },
        },
        {
          label: "Run Locally (Zero-Config)",
          click: async () => {
            const res = await startEmbeddedEngine()
            if (res.ok && res.serverUrl) {
              const localSession = createLocalSession(res.serverUrl)
              saveConfig({
                ...loadConfig(),
                serverUrl: res.serverUrl,
                serverChosen: true,
                serverName: "Local Workspace",
              })
              saveSession(localSession)
              startHost()
              void openWorkspaceInWindow()
            }
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
        {
          label: "Copy MCP Config…",
          click: () => void copyPlatformMcpConfig(),
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
      label: "History",
      submenu: [
        {
          label: "Back",
          accelerator: process.platform === "darwin" ? "Command+[" : "Alt+Left",
          enabled: canGoBack,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoBack()) {
              mainWindow.webContents.goBack()
            }
          },
        },
        {
          label: "Forward",
          accelerator: process.platform === "darwin" ? "Command+]" : "Alt+Right",
          enabled: canGoForward,
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.canGoForward()) {
              mainWindow.webContents.goForward()
            }
          },
        },
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
}

function buildAppMenu() {
  if (rebuildingMenu) return
  rebuildingMenu = true
  try {
    const template = appMenuTemplate()
    const menu = Menu.buildFromTemplate(template)
    Menu.setApplicationMenu(menu)
    if (process.env.SAYABOT_MENU_CHECK === "1") {
      const parts: string[] = []
      const collect = (items: MenuItemConstructorOptions[]) => {
        for (const item of items) {
          const label = item.label ?? item.role ?? ""
          if (label) parts.push(item.accelerator ? `${label} ${item.accelerator}` : label)
          if (Array.isArray(item.submenu)) collect(item.submenu)
        }
      }
      collect(template)
      console.log(`MENU_CHECK ${parts.join(" | ")}`)
    }
  } finally {
    rebuildingMenu = false
  }
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

  let recentNavigations: { url: string; time: number }[] = []

  mainWindow.webContents.on("did-navigate", (_event, url) => {
    buildAppMenu()
    try {
      const now = Date.now()
      recentNavigations.push({ url, time: now })
      recentNavigations = recentNavigations.filter((n) => now - n.time < 3000)
      const loopHits = recentNavigations.filter((n) => n.url === url).length
      if (loopHits >= 3) {
        console.warn(
          `[Sayabot Desktop] Detected redirect loop on ${url}. Breaking loop and returning to controller.`,
        )
        recentNavigations = []
        saveSession(null)
        loadLocalHtml()
        return
      }

      const u = new URL(url)
      const config = loadConfig()
      const serverUrl = normalizeServerUrl(config.serverUrl)
      if (serverUrl && u.origin === new URL(serverUrl).origin) {
        if (u.pathname === "/login") {
          // Server explicitly landed on /login (session expired, rejected, or logged out).
          // Do NOT force reload /auth/complete! Doing so triggers an infinite redirect loop.
          const session = loadSession()
          if (session) {
            console.log("[Sayabot Desktop] Server routed to /login; clearing invalidated session.")
            saveSession(null)
          }
          loadLocalHtml()
          return
        }
        if (u.pathname === "/") {
          const session = loadSession()
          if (!session || !session.accessToken) {
            loadLocalHtml()
          }
        }
      }
    } catch {
      // ignore
    }
  })
  mainWindow.webContents.on("did-navigate-in-page", () => {
    buildAppMenu()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  // Prevent Google / Supabase OAuth from loading inside the Electron webview,
  // where Google blocks embedded webviews with "disallowed_useragent" or prompts credentials.
  const isAuthOrOAuthUrl = (urlStr: string) => {
    try {
      const u = new URL(urlStr)
      if (
        u.hostname === "accounts.google.com" ||
        u.hostname === "github.com" ||
        (u.hostname.endsWith(".supabase.co") &&
          (u.pathname.startsWith("/auth/v1/authorize") || u.pathname.includes("/oauth"))) ||
        u.pathname.startsWith("/auth/v1/authorize")
      ) {
        return true
      }
      return false
    } catch {
      return false
    }
  }

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAuthOrOAuthUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (isAuthOrOAuthUrl(url)) {
      event.preventDefault()
      void shell.openExternal(url)
    }
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

/** True when the last file refresh was rejected. The window's cookies may still be the live login. */
let lastRefreshRejected = false
let refreshInFlight: Promise<AuthSession | null> | null = null

function accessTokenNearExpiry(accessToken: string, force: boolean): boolean {
  if (force) return true
  try {
    const parts = accessToken.split(".")
    if (parts.length !== 3) return true
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64").toString()) as { exp?: unknown }
    if (typeof payload.exp !== "number") return true
    return payload.exp - Math.floor(Date.now() / 1000) < 600
  } catch {
    return true
  }
}

/** The workspace page's cookies already hold a login. Reloading with an older file token would replace it. */
async function hasBrowserSession(serverUrl: string): Promise<boolean> {
  try {
    const cookies = await session.defaultSession.cookies.get({ url: serverUrl })
    return cookies.some(
      (cookie) => cookie.name.startsWith("sb-") && cookie.name.includes("auth-token"),
    )
  } catch {
    return false
  }
}

/** Ask the open workspace page for the login it is using, and store that copy. */
async function flushLiveSessionFromPage(): Promise<boolean> {
  const win = mainWindow
  if (!win || win.isDestroyed()) return false
  const url = win.webContents.getURL()
  if (!url.startsWith("http")) return false
  try {
    const saved = await win.webContents.executeJavaScript(
      `(async () => {
        const read = window.__sayabotReadSession
        if (typeof read !== "function" || !window.sayabotDesktop || !window.sayabotDesktop.saveLiveSession) return false
        const live = await read()
        if (!live) return false
        await window.sayabotDesktop.saveLiveSession(live)
        return true
      })()`,
      true,
    )
    return saved === true
  } catch {
    return false
  }
}

async function refreshSessionOnce(force = false): Promise<AuthSession | null> {
  const saved = loadSession()
  if (!saved || !saved.refreshToken) return null
  if (!accessTokenNearExpiry(saved.accessToken, force)) {
    lastRefreshRejected = false
    return saved
  }

  console.log("[Sayabot Desktop] Refreshing auth token...")
  try {
    const cleanUrl = saved.serverUrl.replace(/\/+$/, "")
    const res = await fetch(`${cleanUrl}/api/desktop/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: saved.refreshToken }),
    })
    if (res.status === 401) {
      // The page often already rotated this token. Deleting the file made the next launch
      // start a new empty guest. Leave the file; the window keeps its own cookies.
      lastRefreshRejected = true
      console.warn(
        "[Sayabot Desktop] Saved refresh token was rejected. Keeping the window's login.",
      )
      return null
    }
    if (!res.ok) {
      console.warn(`[Sayabot Desktop] Refresh token request failed (HTTP ${res.status})`)
      lastRefreshRejected = false
      return saved
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
        ...saved,
        accessToken: data.accessToken,
        refreshToken: data.refreshToken,
        email: data.email || saved.email,
        userId: data.userId || saved.userId,
        isGuest: typeof data.isAnonymous === "boolean" ? data.isAnonymous : saved.isGuest,
      }
      saveSession(updated)
      lastRefreshRejected = false
      if (host) startHost()
      console.log("[Sayabot Desktop] Refreshed and persisted new session tokens.")
      return updated
    }
  } catch (err) {
    console.error("[Sayabot Desktop] Token refresh error:", err)
  }
  lastRefreshRejected = false
  return saved
}

function refreshSessionIfNeeded(force = false): Promise<AuthSession | null> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = refreshSessionOnce(force).finally(() => {
    refreshInFlight = null
  })
  return refreshInFlight
}

// The page refreshes its own cookies. Copy those into the file. Only refresh the file when
// no window is holding a login, so two refreshes cannot revoke the account.
setInterval(
  () => {
    void (async () => {
      if (await flushLiveSessionFromPage()) return
      const saved = loadSession()
      if (!saved || (await hasBrowserSession(saved.serverUrl))) return
      await refreshSessionIfNeeded()
    })()
  },
  15 * 60 * 1000,
)

async function openWorkspaceInWindow() {
  const config = loadConfig()
  const saved = loadSession()
  if (!mainWindow) return
  if (!saved) {
    loadLocalHtml()
    return
  }
  if (normalizeServerUrl(saved.serverUrl) !== normalizeServerUrl(config.serverUrl)) {
    saveSession(null)
    loadLocalHtml()
    return
  }
  let cleanUrl = saved.serverUrl.replace(/\/+$/, "")
  const isLocal = cleanUrl.includes("localhost") || cleanUrl.includes("127.0.0.1")
  if (isLocal) {
    if (!getEmbeddedEngineStatus().running) {
      console.log(
        "[Sayabot Desktop] Local engine not running; starting embedded engine for workspace...",
      )
      const res = await startEmbeddedEngine()
      if (res.ok && res.serverUrl) {
        cleanUrl = res.serverUrl.replace(/\/+$/, "")
        saved.serverUrl = res.serverUrl
        saveSession(saved)
        saveConfig({ ...config, serverUrl: res.serverUrl })
      }
    }
  }
  if (await hasBrowserSession(saved.serverUrl)) {
    // Cookies are the login that survived the last run. Do not hand the file's older
    // refresh token to the page; the server treats a reused token as theft and revokes it.
    mainWindow.loadURL(cleanUrl)
    return
  }
  const refreshed = await refreshSessionIfNeeded()
  const next = refreshed ?? (lastRefreshRejected ? null : saved)
  if (!next) {
    saveSession(null)
    loadLocalHtml()
    return
  }
  const targetUrl = `${cleanUrl}/auth/complete#access_token=${next.accessToken}&refresh_token=${next.refreshToken}`
  mainWindow.loadURL(targetUrl)
}

// IPC Handlers
ipcMain.handle("auth:get-session", () => {
  return loadSession()
})

/** The workspace page rotated the login. Keep the file on that same account. */
ipcMain.handle(
  "auth:save-live-session",
  (
    _event,
    input: {
      accessToken?: string
      refreshToken?: string
      email?: string
      userId?: string
      isGuest?: boolean
    },
  ) => {
    const current = loadSession()
    if (!current || !input?.accessToken || !input.refreshToken) return { ok: false }
    if (input.userId && current.userId && input.userId !== current.userId) return { ok: false }
    if (input.accessToken === current.accessToken && input.refreshToken === current.refreshToken) {
      return { ok: true }
    }
    saveSession({
      ...current,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      email: input.email || current.email,
      userId: input.userId || current.userId,
      isGuest: typeof input.isGuest === "boolean" ? input.isGuest : current.isGuest,
    })
    return { ok: true }
  },
)

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
  localMode?: boolean
}

/**
 * Creates an anonymous Supabase user for this Mac. The server only says whether guests are
 * allowed and where Supabase is; the sign-up goes from this Mac so its own IP is rate limited.
 * For local zero-config instances, creates an instant local session directly without network calls.
 */
async function createGuestSession(serverUrl: string): Promise<AuthSession> {
  let base = serverUrl.replace(/\/+$/, "")
  const isLocal = base.includes("localhost") || base.includes("127.0.0.1")

  if (isLocal) {
    if (!getEmbeddedEngineStatus().running) {
      console.log(
        "[Sayabot Desktop] Local server configured but embedded engine not running; starting...",
      )
      const embedded = await startEmbeddedEngine()
      if (embedded.ok && embedded.serverUrl) {
        base = embedded.serverUrl
        saveConfig({
          ...loadConfig(),
          serverUrl: embedded.serverUrl,
          serverChosen: true,
          serverName: "Local Workspace",
        })
      }
    }
    return createLocalSession(base)
  }

  let configRes: Response | null = null
  try {
    configRes = await fetch(`${base}/api/desktop/guest`, { signal: AbortSignal.timeout(1500) })
  } catch {
    configRes = null
  }
  if (!configRes || !configRes.ok) {
    // If remote server unreachable or slow, start zero-config embedded engine automatically
    console.log(
      "[Sayabot Desktop] Remote server unreachable or slow; booting local zero-config embedded engine…",
    )
    const embedded = await startEmbeddedEngine()
    if (embedded.ok && embedded.serverUrl) {
      saveConfig({
        ...loadConfig(),
        serverUrl: embedded.serverUrl,
        serverChosen: true,
        serverName: "Local Workspace",
      })
      return createLocalSession(embedded.serverUrl)
    }
    throw new Error(`Workspace server unreachable (${configRes?.status ?? "network error"})`)
  }
  const config = (await configRes.json()) as GuestConfig
  if (config.localMode) {
    return createLocalSession(base)
  }
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
  const guestAllowed = config.serverGuestMode !== false
  const needsServerChoice = (!config.serverChosen || serverSetupRequested) && !signedIn
  return {
    needsServerChoice,
    autoStart: !signedIn && !needsServerChoice && !config.guestDeclined && guestAllowed,
    guestAllowed,
  }
})

ipcMain.handle("config:cancel-server-setup", () => {
  serverSetupRequested = false
  const config = loadConfig()
  saveConfig({ ...config, serverChosen: true, guestDeclined: false })
})

ipcMain.handle("config:server-info", () => {
  const config = loadConfig()
  const url = normalizeServerUrl(config.serverUrl) ?? DEFAULT_SERVER_URL
  const name =
    config.serverName ||
    (url.includes("localhost") || url.includes("127.0.0.1") ? "Local Server" : new URL(url).host)
  return {
    url,
    name,
    isCloud: false,
    chosen: Boolean(config.serverChosen),
  }
})

ipcMain.handle("config:check-server", (_event, input: string) => checkServer(input))

/** The start screen's choice: connect to a self-hosted server typed or default. */
ipcMain.handle("config:choose-server", async (_event, input: string | null) => {
  const target = input || DEFAULT_SERVER_URL
  const info = await checkServer(target)
  if (!info.ok) {
    if (!input) {
      serverSetupRequested = false
      const fallbackName = target.includes("localhost") ? "Local Server" : new URL(target).host
      await useServer({
        ok: true,
        url: target,
        name: fallbackName,
        edition: "self-hosted",
        guestMode: true,
      })
      return { ok: true, url: target, name: fallbackName, guestMode: true }
    }
    return info
  }
  serverSetupRequested = false
  await useServer(info)
  return {
    ok: true,
    url: info.url,
    name: info.name,
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

ipcMain.handle("embedded:start", async () => {
  const res = await startEmbeddedEngine()
  if (res.ok && res.serverUrl) {
    const localSession = createLocalSession(res.serverUrl)
    saveConfig({
      ...loadConfig(),
      serverUrl: res.serverUrl,
      serverChosen: true,
      serverName: "Local Workspace",
    })
    saveSession(localSession)
    startHost()
  }
  return res
})

ipcMain.handle("embedded:stop", async () => {
  await stopEmbeddedEngine()
  return { ok: true }
})

ipcMain.handle("embedded:status", () => {
  return getEmbeddedEngineStatus()
})

ipcMain.handle("workspace:return-to-controller", () => {
  loadLocalHtml()
})

ipcMain.handle("runner:get-status", () => {
  return { running: localRunnerRunning, busy: runner?.running ?? false, port: 4100 }
})

// Signing an agent app in through its own login (Antigravity's `agy acp --login`): the link
// opens in the browser and the person pastes the code back; Sayabot never touches the tokens.
const agentLogin = new AgentLogin()
ipcMain.handle("agents:sign-in-start", async (_event, appId: unknown) => {
  const started = await agentLogin.start(typeof appId === "string" ? appId : "")
  if (started.ok) void shell.openExternal(started.url)
  return started
})
ipcMain.handle("agents:sign-in-submit", async (_event, code: unknown) => {
  const finished = await agentLogin.submit(code)
  if (finished.ok) host?.rescanAgents()
  return finished
})
ipcMain.handle("agents:sign-in-cancel", () => {
  agentLogin.cancel()
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
  useThisMacOnFirstLaunch()
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
  void stopEmbeddedEngine()
  runner?.stop()
  host?.stop()
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
