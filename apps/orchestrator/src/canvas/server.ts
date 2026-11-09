import { canvases } from "@sayabot/db"
import { Hocuspocus } from "@hocuspocus/server"
import { createClient } from "@supabase/supabase-js"
import { eq } from "drizzle-orm"
import * as Y from "yjs"
import { canUserReadRoom } from "../authz"
import { getDb } from "../db"
import { getEnv } from "../env"

export interface CollabContext {
  userId?: string | null
  canvasId?: string
  roomId?: string
  agentId?: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** How long someone removed from a room can stay on its canvas, at most. */
const ACCESS_SWEEP_MS = 30_000

let instance: Hocuspocus<CollabContext> | null = null
let accessSweep: ReturnType<typeof setInterval> | null = null

/**
 * Access is only checked when a socket authenticates, so closes connections whose
 * user has since lost the room. A failed lookup keeps the connection: a database
 * blip must not throw everyone off the canvas.
 */
export async function revokeStaleCanvasConnections(
  server: Pick<Hocuspocus<CollabContext>, "documents">,
  canRead: (userId: string, roomId: string) => Promise<boolean> = canUserReadRoom,
): Promise<number> {
  const decisions = new Map<string, Promise<boolean>>()
  let revoked = 0
  for (const document of [...server.documents.values()]) {
    for (const connection of document.getConnections()) {
      const { userId, roomId } = connection.context as CollabContext
      if (!userId || !roomId) continue
      const key = `${userId}:${roomId}`
      let decision = decisions.get(key)
      if (!decision) {
        decision = canRead(userId, roomId).catch(() => true)
        decisions.set(key, decision)
      }
      if (await decision) continue
      connection.close({ code: 4403, reason: "Forbidden" })
      revoked += 1
    }
  }
  return revoked
}

export async function loadCanvas(canvasId: string) {
  if (!UUID_RE.test(canvasId)) return null
  const [canvas] = await getDb()
    .select()
    .from(canvases)
    .where(eq(canvases.id, canvasId))
    .limit(1)
  return canvas ?? null
}

export function createHocuspocus(): Hocuspocus<CollabContext> {
  if (instance) return instance
  const env = getEnv()
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  instance = new Hocuspocus<CollabContext>({
    debounce: 2_000,
    maxDebounce: 10_000,
    quiet: true,
    async onAuthenticate({ token, documentName }) {
      if (!token) throw new Error("Missing Supabase token")
      const { data, error } = await supabase.auth.getUser(token)
      if (error || !data.user) throw new Error("Invalid Supabase token")
      const canvas = await loadCanvas(documentName)
      if (!canvas) throw new Error("Canvas not found")
      if (!(await canUserReadRoom(data.user.id, canvas.roomId))) throw new Error("Forbidden")
      return { userId: data.user.id, canvasId: canvas.id, roomId: canvas.roomId }
    },
    async onLoadDocument({ document, documentName }) {
      const canvas = await loadCanvas(documentName)
      if (!canvas) throw new Error("Canvas not found")
      if (canvas.ydocState && canvas.ydocState.length > 0) {
        Y.applyUpdate(document, new Uint8Array(canvas.ydocState))
      } else if (canvas.snapshotText) {
        document.getText("content").insert(0, canvas.snapshotText)
      }
      return document
    },
    async onStoreDocument({ document, documentName }) {
      if (!UUID_RE.test(documentName)) return
      await persistCanvasState(documentName, document)
    },
  })
  const server = instance
  accessSweep = setInterval(() => {
    void revokeStaleCanvasConnections(server).catch((error) =>
      console.error("[collab] access sweep failed", error),
    )
  }, ACCESS_SWEEP_MS)
  accessSweep.unref()
  return instance
}

export function getHocuspocus(): Hocuspocus<CollabContext> {
  if (!instance) throw new Error("Canvas server is not initialised")
  return instance
}

export async function persistCanvasState(canvasId: string, document: Y.Doc, text?: string): Promise<string> {
  const snapshotText = text ?? document.getText("content").toString()
  await getDb()
    .update(canvases)
    .set({
      ydocState: Buffer.from(Y.encodeStateAsUpdate(document)),
      snapshotText,
      updatedAt: new Date(),
    })
    .where(eq(canvases.id, canvasId))
  return snapshotText
}

export async function destroyHocuspocus(): Promise<void> {
  if (!instance) return
  if (accessSweep) clearInterval(accessSweep)
  accessSweep = null
  await instance.flushPendingStores()
  instance.closeConnections()
  instance = null
}
