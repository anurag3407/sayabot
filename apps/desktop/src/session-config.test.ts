import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const testUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "sayabot-desktop-test-"))

vi.mock("electron", () => ({
  app: {
    requestSingleInstanceLock: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    setName: vi.fn(),
    quit: vi.fn(),
    exit: vi.fn(),
    isReady: vi.fn(() => false),
    whenReady: vi.fn(() => new Promise(() => {})),
    getPath: vi.fn(() => testUserDataDir),
    getVersion: vi.fn(() => "1.0.0"),
    getName: vi.fn(() => "Sayabot"),
    isPackaged: false,
  },
  BrowserWindow: Object.assign(vi.fn(), { getAllWindows: vi.fn(() => []) }),
  Menu: {
    buildFromTemplate: vi.fn((template: unknown) => template),
    setApplicationMenu: vi.fn(),
  },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
  Notification: Object.assign(vi.fn(), { isSupported: vi.fn(() => false) }),
  session: {
    defaultSession: {
      cookies: { get: vi.fn(async () => []), flushStore: vi.fn() },
      flushStorageData: vi.fn(),
    },
  },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
  globalShortcut: {
    register: vi.fn(),
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
}))

import {
  loadConfig,
  saveConfig,
  loadSession,
  saveSession,
  useThisMacOnFirstLaunch,
} from "./main"

describe("desktop session and config management", () => {
  beforeEach(() => {
    try {
      fs.rmSync(path.join(testUserDataDir, "sayabot-config.json"), { force: true })
      fs.rmSync(path.join(testUserDataDir, "sayabot-session.json"), { force: true })
      fs.rmSync(path.join(testUserDataDir, "sayabot-session.json.bak"), { force: true })
    } catch {
      // ignore
    }
  })

  afterEach(() => {
    delete process.env.SAYABOT_SERVER_URL
  })

  it("migrates dead localhost config and preserves DEFAULT_SERVER_URL", () => {
    saveConfig({
      serverUrl: "http://localhost:3000",
      enableLocalRunner: true,
      serverChosen: true,
      serverName: "This Mac",
      serverGuestMode: true,
    })

    const config = loadConfig()
    expect(config.serverUrl).toBe("https://sayabot.sayalabs.in")
    expect(config.serverChosen).toBe(true)
    expect(config.serverName).toBe("This Mac")
  })

  it("useThisMacOnFirstLaunch defaults to This Mac with serverChosen: true", () => {
    useThisMacOnFirstLaunch()
    const config = loadConfig()
    expect(config.serverUrl).toBe("https://sayabot.sayalabs.in")
    expect(config.serverChosen).toBe(true)
    expect(config.serverName).toBe("This Mac")
    expect(config.serverGuestMode).toBe(true)
  })

  it("clears sessions when session.serverUrl mismatches config.serverUrl", () => {
    saveConfig({
      serverUrl: "https://sayabot.sayalabs.in",
      enableLocalRunner: true,
      serverChosen: true,
      serverName: "This Mac",
    })
    saveSession({
      accessToken: "token-other",
      refreshToken: "refresh-other",
      email: "user@example.com",
      userId: "u-other",
      serverUrl: "https://another-server.example.com",
    })

    const session = loadSession()
    expect(session).toBeNull()
  })

  it("preserves valid sessions for the matching server", () => {
    saveConfig({
      serverUrl: "https://sayabot.sayalabs.in",
      enableLocalRunner: true,
      serverChosen: true,
      serverName: "This Mac",
    })
    saveSession({
      accessToken: "valid-token",
      refreshToken: "valid-refresh",
      email: "local@example.com",
      userId: "u-local",
      serverUrl: "https://sayabot.sayalabs.in",
    })

    const session = loadSession()
    expect(session).not.toBeNull()
    expect(session?.accessToken).toBe("valid-token")
    expect(session?.userId).toBe("u-local")
  })
})
