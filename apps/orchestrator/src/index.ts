import { destroyHocuspocus, createHocuspocus } from "./canvas/server"
import { closeDb, getPool } from "./db"
import { getEnv } from "./env"
import { createApp } from "./http"
import { enqueueRoomMessage, startJobs, stopJobs } from "./jobs"
import { setCollabEnqueue } from "./collab"
import { startMeetingScheduler, stopMeetingScheduler } from "./scheduler/meetings"
import { startMemoryScheduler } from "./memory/scheduler"
import { startRoutineScheduler } from "./scheduler/routines"
import { startApprovalListener } from "./tools/approvals"
import { startBotReplyListener } from "./bot-reply"
import { abortRoomRuns, abortRun } from "./active-runs"
import { serve } from "@hono/node-server"
import type { IncomingMessage } from "node:http"
import { WebSocketServer } from "ws"
import type { Duplex } from "node:stream"

const env = getEnv()
const hocuspocus = createHocuspocus()

await startApprovalListener().catch((error) =>
  console.error("[approvals] listener unavailable; falling back to polling", error),
)
await startBotReplyListener().catch((error) =>
  console.error("[bot-reply] listener unavailable; falling back to polling", error),
)

const control = await getPool().connect()
control.on("notification", (message) => {
  if (!message.payload) return
  try {
    const payload = JSON.parse(message.payload) as { roomId?: string; runId?: string }
    if (message.channel === "mesh_room_interrupt" && payload.roomId) {
      abortRoomRuns(payload.roomId)
    }
    if (message.channel === "mesh_stop_run" && payload.runId) {
      abortRun(payload.runId)
    }
  } catch {
    // ignore malformed control notifications
  }
})
control.on("error", (error) => console.error("[control] listener error", error))
await control.query("LISTEN mesh_room_interrupt")
await control.query("LISTEN mesh_stop_run")

await startJobs()
void import("./engine/resume").then(({ recoverStaleRuns }) =>
  recoverStaleRuns().then(
    (res) => res.recoveredCount > 0 && console.log(`[recovery] rescued ${res.recoveredCount} stale runs`),
    (err) => console.error("[recovery] failed to recover stale runs", err),
  ),
)
setCollabEnqueue(enqueueRoomMessage)
startMeetingScheduler()
startRoutineScheduler()
startMemoryScheduler()

const app = createApp()
const server = serve(
  { fetch: app.fetch, port: env.PORT },
  (info) => {
    console.log(`[sayabot] orchestrator listening on :${info.port}`)
    console.log(`[sayabot] canvas sync at ws://localhost:${info.port}/collab`)
  },
)

const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 })

function toFetchRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? `localhost:${env.PORT}`
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value)
    else if (Array.isArray(value)) headers.set(key, value.join(", "))
  }
  return new Request(`http://${host}${req.url ?? "/"}`, { method: req.method, headers })
}

server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
  if (url.pathname !== "/collab") {
    socket.destroy()
    return
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    try {
      const connection = hocuspocus.handleConnection(ws, toFetchRequest(req))
      ws.on("message", (data) => connection.handleMessage(new Uint8Array(data as Buffer)))
      ws.on("close", (code, reason) => connection.handleClose({ code, reason: reason.toString() } as CloseEvent))
      ws.on("pong", () => connection.touch())
      ws.on("error", (error) => console.error("[collab] socket error", error))
    } catch (error) {
      console.error("[collab] failed to establish connection", error)
      ws.close(1011, "connection failed")
    }
  })
})

let shuttingDown = false
async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[mesh] shutting down (${signal})…`)
  try {
    stopMeetingScheduler()
    await stopJobs()
    await destroyHocuspocus()
    control.release()
    wss.close()
    server.close()
    await closeDb()
  } catch (error) {
    console.error("[mesh] shutdown error", error)
  }
  process.exit(0)
}

process.on("SIGINT", () => void shutdown("SIGINT"))
process.on("SIGTERM", () => void shutdown("SIGTERM"))
