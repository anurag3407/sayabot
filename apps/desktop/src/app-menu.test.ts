import { describe, expect, it, vi } from "vitest"
import type { MenuItemConstructorOptions } from "electron"

const { globalShortcutRegister } = vi.hoisted(() => ({
  globalShortcutRegister: vi.fn(),
}))

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
    getPath: vi.fn(() => "/tmp/sayabot-menu-test"),
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
    register: globalShortcutRegister,
    unregister: vi.fn(),
    unregisterAll: vi.fn(),
    isRegistered: vi.fn(() => false),
  },
}))

import { appMenuTemplate } from "./main"

type Item = MenuItemConstructorOptions & { submenu?: Item[] }

function walk(items: readonly Item[], visit: (item: Item) => void) {
  for (const item of items) {
    visit(item)
    if (item.submenu) walk(item.submenu, visit)
  }
}

function byLabel(items: readonly Item[], label: string): Item {
  let found: Item | undefined
  walk(items, (item) => {
    if (item.label === label) found = item
  })
  if (!found) throw new Error(`menu item not found: ${label}`)
  return found
}

function hasRole(items: readonly Item[], role: string): boolean {
  let found = false
  walk(items, (item) => {
    if (item.role === role) found = true
  })
  return found
}

describe("appMenuTemplate", () => {
  it("keeps standard roles and does not steal Hide or Close", () => {
    const template = appMenuTemplate() as Item[]

    expect(byLabel(template, "Return to Controller").accelerator).toBeUndefined()
    expect(byLabel(template, "Open Workspace in Window").accelerator).toBeUndefined()
    expect(byLabel(template, "Back").accelerator).toBe(
      process.platform === "darwin" ? "Command+[" : "Alt+Left",
    )
    expect(byLabel(template, "Forward").accelerator).toBe(
      process.platform === "darwin" ? "Command+]" : "Alt+Right",
    )
    expect(hasRole(template, "hide")).toBe(true)
    expect(hasRole(template, "close")).toBe(true)
    expect(hasRole(template, "reload")).toBe(true)
    expect(globalShortcutRegister).not.toHaveBeenCalled()
  })
})
