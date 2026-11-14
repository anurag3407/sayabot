import { contextBridge, ipcRenderer } from "electron"

export interface AuthSession {
  accessToken: string
  refreshToken: string
  email: string
  userId: string
  serverUrl: string
  isGuest?: boolean
}

export interface DesktopUpdateResult {
  isUpdateAvailable: boolean
  currentVersion: string
  latestVersion?: string
  dmgUrl?: string
  releaseNotes?: string
  error?: string
}

export type ServerCheck =
  | { ok: true; url: string; name: string; guestMode: boolean; edition?: "self-hosted" | "cloud" }
  | { ok: false; error: string }

export interface DesktopBridge {
  getSession: () => Promise<AuthSession | null>
  startBrowserAuth: () => Promise<void>
  /** Whether the controller should start a guest session by itself (no session, not declined). */
  getGuestStatus: () => Promise<{ autoStart: boolean; needsServerChoice: boolean; guestAllowed: boolean }>
  getServerInfo: () => Promise<{ url: string; name: string; isCloud: boolean; chosen: boolean }>
  checkServer: (input: string) => Promise<ServerCheck>
  chooseServer: (input: string | null) => Promise<ServerCheck>
  /** Opens Sayabot without an account; on success the main process opens the workspace. */
  startGuest: () => Promise<{ ok: boolean; error?: string }>
  signOut: () => Promise<void>
  getServerUrl: () => Promise<string>
  setServerUrl: (url: string) => Promise<string>
  openWorkspaceInWindow: () => Promise<void>
  openWorkspaceInBrowser: () => Promise<void>
  returnToController: () => Promise<void>
  getLocalRunnerStatus: () => Promise<{ running: boolean; port: number }>
  toggleLocalRunner: () => Promise<{ running: boolean; port: number }>
  restartApp: () => Promise<void>
  getVersion: () => Promise<string>
  checkForUpdates: (manual?: boolean) => Promise<DesktopUpdateResult>
  /** Claude / Codex / Antigravity plan limits, read with this Mac's own sign-ins. */
  getPlanLimits: (force?: boolean) => Promise<unknown[]>
  /** Token history from coding-tool logs on this Mac. */
  getLocalUsage: (days: number) => Promise<{ available: boolean; events: unknown[] }>
  onSessionUpdate: (callback: (session: AuthSession | null) => void) => () => void
}

const bridge: DesktopBridge = {
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  startBrowserAuth: () => ipcRenderer.invoke("auth:start-browser-auth"),
  getGuestStatus: () => ipcRenderer.invoke("auth:guest-status"),
  getServerInfo: () => ipcRenderer.invoke("config:server-info"),
  checkServer: (input) => ipcRenderer.invoke("config:check-server", input),
  chooseServer: (input) => ipcRenderer.invoke("config:choose-server", input),
  startGuest: () => ipcRenderer.invoke("auth:start-guest"),
  signOut: () => ipcRenderer.invoke("auth:sign-out"),
  getServerUrl: () => ipcRenderer.invoke("config:get-server-url"),
  setServerUrl: (url: string) => ipcRenderer.invoke("config:set-server-url", url),
  openWorkspaceInWindow: () => ipcRenderer.invoke("workspace:open-in-window"),
  openWorkspaceInBrowser: () => ipcRenderer.invoke("workspace:open-in-browser"),
  returnToController: () => ipcRenderer.invoke("workspace:return-to-controller"),
  getLocalRunnerStatus: () => ipcRenderer.invoke("runner:get-status"),
  toggleLocalRunner: () => ipcRenderer.invoke("runner:toggle"),
  restartApp: () => ipcRenderer.invoke("app:restart"),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: (manual) => ipcRenderer.invoke("app:check-for-updates", manual),
  getPlanLimits: (force) => ipcRenderer.invoke("usage:plan-limits", force),
  getLocalUsage: (days) => ipcRenderer.invoke("usage:local", days),
  onSessionUpdate: (callback) => {
    const listener = (_event: any, session: AuthSession | null) => callback(session)
    ipcRenderer.on("auth:session-updated", listener)
    return () => {
      ipcRenderer.removeListener("auth:session-updated", listener)
    }
  },
}

contextBridge.exposeInMainWorld("sayabotDesktop", bridge)
