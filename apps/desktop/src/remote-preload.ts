import { contextBridge, ipcRenderer } from "electron"

/** Bridge for the hidden capture window that runs the WebRTC side of remote desktop. */
contextBridge.exposeInMainWorld("remoteHost", {
  onStart: (cb: (payload: { sessionId: string; offer: string; sourceId: string }) => void) => {
    ipcRenderer.on("remote-host:start", (_e, payload) => cb(payload))
  },
  answer: (sessionId: string, answer: string) => ipcRenderer.send("remote-host:answer", sessionId, answer),
  ended: (sessionId: string, reason?: string) => ipcRenderer.send("remote-host:ended", sessionId, reason),
  input: (sessionId: string, raw: string) => ipcRenderer.send("remote-host:input", sessionId, raw),
})
