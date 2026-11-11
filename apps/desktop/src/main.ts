import { app, BrowserWindow, ipcMain, shell } from "electron"
import * as path from "node:path"
import * as fs from "node:fs"

const DEFAULT_SERVER_URL = "https://sayabot.sayalabs.in"
const CONFIG_FILE = "sayabot-config.json"
const SESSION_FILE = "sayabot-session.json"

interface AuthSession {
  accessToken: string
  refreshToken: string
  email: string
  userId: string
  serverUrl: string
}

interface DesktopConfig {
  serverUrl: string
  enableLocalRunner: boolean
}

let mainWindow: BrowserWindow | null = null
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

function handleDeepLink(urlStr: string): void {
  console.log("[Sayabot Desktop] Received deep link:", urlStr)
  try {
    const parsed = new URL(urlStr)
    if (parsed.protocol !== "sayabot:") return

    // Expected format: sayabot://auth/callback?access_token=...&refresh_token=...&email=...
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
        }
        saveSession(session)

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("auth:session-updated", session)
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.focus()
        }
      }
    }
  } catch (err) {
    console.error("Error processing deep link:", err)
  }
}

// Register protocol handler for macOS & Windows
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

  // Load renderer
  const distRendererPath = path.join(__dirname, "renderer", "index.html")
  const srcRendererPath = path.join(__dirname, "..", "src", "renderer", "index.html")
  const targetHtml = fs.existsSync(distRendererPath) ? distRendererPath : srcRendererPath
  mainWindow.loadFile(targetHtml)

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: "deny" }
  })

  mainWindow.on("closed", () => {
    mainWindow = null
  })

  if (pendingDeepLinkUrl) {
    setTimeout(() => {
      handleDeepLink(pendingDeepLinkUrl!)
      pendingDeepLinkUrl = null
    }, 500)
  }
}

// IPC Handlers
ipcMain.handle("auth:get-session", () => {
  return loadSession()
})

ipcMain.handle("auth:start-browser-auth", () => {
  const config = loadConfig()
  const authUrl = `${config.serverUrl.replace(/\/+$/, "")}/login?next=/auth/desktop`
  console.log("[Sayabot Desktop] Launching browser auth:", authUrl)
  shell.openExternal(authUrl)
})

ipcMain.handle("auth:sign-out", () => {
  saveSession(null)
  if (mainWindow && !mainWindow.isDestroyed()) {
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

ipcMain.handle("workspace:open-in-browser", () => {
  const config = loadConfig()
  shell.openExternal(config.serverUrl)
})

ipcMain.handle("runner:get-status", () => {
  return { running: localRunnerRunning, port: 4100 }
})

ipcMain.handle("runner:toggle", () => {
  localRunnerRunning = !localRunnerRunning
  return { running: localRunnerRunning, port: 4100 }
})

app.whenReady().then(() => {
  createWindow()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})
