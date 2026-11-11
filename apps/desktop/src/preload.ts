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
  openWorkspaceInWindow: () => Promise<void>
  openWorkspaceInBrowser: () => Promise<void>
  returnToController: () => Promise<void>
  getLocalRunnerStatus: () => Promise<{ running: boolean; port: number }>
  toggleLocalRunner: () => Promise<{ running: boolean; port: number }>
  restartApp: () => Promise<void>
  getVersion: () => Promise<string>
  onSessionUpdate: (callback: (session: AuthSession | null) => void) => () => void
}

const bridge: DesktopBridge = {
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  startBrowserAuth: () => ipcRenderer.invoke("auth:start-browser-auth"),
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
  onSessionUpdate: (callback) => {
    const listener = (_event: any, session: AuthSession | null) => callback(session)
    ipcRenderer.on("auth:session-updated", listener)
    return () => {
      ipcRenderer.removeListener("auth:session-updated", listener)
    }
  },
}

contextBridge.exposeInMainWorld("sayabotDesktop", bridge)
