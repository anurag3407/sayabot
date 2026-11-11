import { contextBridge, ipcRenderer } from "electron"

export interface AuthSession {
  accessToken: string
  refreshToken: string
  email: string
  userId: string
  serverUrl: string
}

export interface DesktopBridge {
  getSession: () => Promise<AuthSession | null>
  startBrowserAuth: () => Promise<void>
  signOut: () => Promise<void>
  getServerUrl: () => Promise<string>
  setServerUrl: (url: string) => Promise<string>
  openWorkspaceInBrowser: () => Promise<void>
  getLocalRunnerStatus: () => Promise<{ running: boolean; port: number }>
  toggleLocalRunner: () => Promise<{ running: boolean; port: number }>
  onSessionUpdate: (callback: (session: AuthSession | null) => void) => () => void
}

const bridge: DesktopBridge = {
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  startBrowserAuth: () => ipcRenderer.invoke("auth:start-browser-auth"),
  signOut: () => ipcRenderer.invoke("auth:sign-out"),
  getServerUrl: () => ipcRenderer.invoke("config:get-server-url"),
  setServerUrl: (url: string) => ipcRenderer.invoke("config:set-server-url", url),
  openWorkspaceInBrowser: () => ipcRenderer.invoke("workspace:open-in-browser"),
  getLocalRunnerStatus: () => ipcRenderer.invoke("runner:get-status"),
  toggleLocalRunner: () => ipcRenderer.invoke("runner:toggle"),
  onSessionUpdate: (callback) => {
    const listener = (_event: any, session: AuthSession | null) => callback(session)
    ipcRenderer.on("auth:session-updated", listener)
    return () => {
      ipcRenderer.removeListener("auth:session-updated", listener)
    }
  },
}

contextBridge.exposeInMainWorld("sayabotDesktop", bridge)
