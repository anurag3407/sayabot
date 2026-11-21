import { planCanvasPatch } from "@sayabot/core"
import { canvases, canvasVersions } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { getDb } from "../db"
import type { ToolSpec } from "../tools/audited"
import { getHocuspocus, loadCanvas, persistCanvasState } from "./server"

const canvasKindSchema = z.enum(["markdown", "code", "svg", "html"])
type CanvasKind = z.infer<typeof canvasKindSchema>

interface CanvasToolArgs {
  roomId: string
  agentId: string
}

async function listRoomCanvases(roomId: string) {
  return getDb()
    .select({ id: canvases.id, title: canvases.title, kind: canvases.kind })
    .from(canvases)
    .where(eq(canvases.roomId, roomId))
    .limit(20)
}

function titleFromContent(content: string): string {
  const heading = content.match(/^#\s+(.{1,80})/m)
  const raw = heading?.[1]?.trim() || "Canvas"
  return raw.slice(0, 60)
}

function missingCanvasResult(canvasesInRoom: { id: string; title: string; kind: string }[]) {
  return {
    ok: false as const,
    error: "Canvas not found in this room",
    canvases: canvasesInRoom,
    hint:
      canvasesInRoom.length === 0
        ? "This room has no canvas. Call canvas_create, or canvas_write with content, to make one."
        : "Use one of these canvas ids, or call canvas_create to add another.",
  }
}

/** Insert a canvas in this room. A raced insert of the same id is reused when it is already here. */
async function insertRoomCanvas(args: {
  roomId: string
  id?: string
  title: string
  kind: CanvasKind
  language?: string | null
  content: string
}) {
  const values = {
    ...(args.id ? { id: args.id } : {}),
    roomId: args.roomId,
    title: args.title.slice(0, 60),
    kind: args.kind,
    language: args.kind === "code" ? (args.language ?? null) : null,
    snapshotText: args.content,
  }
  try {
    const [row] = await getDb().insert(canvases).values(values).returning()
    if (!row) throw new Error("Could not create the canvas")
    return row
  } catch (error) {
    if (args.id) {
      const existing = await loadCanvas(args.id)
      if (existing?.roomId === args.roomId) return existing
    }
    throw error
  }
}

async function recordVersion(canvasId: string, authorId: string, text: string) {
  await getDb()
    .insert(canvasVersions)
    .values({ canvasId, authorType: "agent", authorId, snapshotText: text })
}

export function canvasCreateTool(args: CanvasToolArgs): ToolSpec {
  return {
    name: "canvas_create",
    description:
      "Create a shared canvas in this room and return its id. Use this when the room has no canvas, or when you need another one. canvas_write also creates a canvas when the id is new or the room has none.",
    schema: z.object({
      title: z.string().min(1).max(60).default("Canvas"),
      kind: canvasKindSchema.default("markdown"),
      language: z.string().max(40).optional(),
      content: z.string().max(200_000).optional(),
    }),
    dangerous: false,
    execute: async (input: {
      title?: string
      kind?: CanvasKind
      language?: string
      content?: string
    }) => {
      const content = input.content ?? ""
      const kind = input.kind ?? "markdown"
      const row = await insertRoomCanvas({
        roomId: args.roomId,
        title: input.title?.trim() || "Canvas",
        kind,
        language: input.language,
        content,
      })
      if (content) await recordVersion(row.id, args.agentId, content)
      return {
        ok: true,
        created: true,
        canvasId: row.id,
        title: row.title,
        kind: row.kind,
        characters: content.length,
      }
    },
  }
}

export function canvasReadTool(args: CanvasToolArgs): ToolSpec {
  return {
    name: "canvas_read",
    description:
      "Read a room canvas. Pass canvasId, or omit it to read the room's only canvas. When the id is missing, the result lists canvases in this room and how to create one.",
    schema: z.object({
      canvasId: z.string().uuid().optional(),
    }),
    dangerous: false,
    execute: async (input: { canvasId?: string }) => {
      let canvasId = input.canvasId
      if (!canvasId) {
        const inRoom = await listRoomCanvases(args.roomId)
        if (inRoom.length !== 1) return missingCanvasResult(inRoom)
        canvasId = inRoom[0]?.id
      }
      const canvas = canvasId ? await loadCanvas(canvasId) : null
      if (!canvas || canvas.roomId !== args.roomId) {
        return missingCanvasResult(await listRoomCanvases(args.roomId))
      }
      return {
        ok: true,
        canvasId: canvas.id,
        title: canvas.title,
        kind: canvas.kind,
        language: canvas.language,
        content: canvas.snapshotText,
      }
    },
  }
}

export function canvasWriteTool(args: CanvasToolArgs): ToolSpec {
  return {
    name: "canvas_write",
    description:
      "Replace the entire contents of a room canvas. If canvasId is new, or omitted when the room has no canvas, the canvas is created in this room first. If the room has several canvases, pass canvasId. Prefer canvas_patch for small changes so concurrent human edits survive.",
    schema: z.object({
      canvasId: z
        .string()
        .uuid()
        .optional()
        .describe("Existing canvas, or a new id to create. Omit to use the room's only canvas."),
      content: z.string().max(200_000),
      title: z.string().min(1).max(60).optional(),
      kind: canvasKindSchema.optional(),
    }),
    dangerous: false,
    execute: async (input: {
      canvasId?: string
      content: string
      title?: string
      kind?: CanvasKind
    }) => {
      let canvasId = input.canvasId
      let created = false
      if (!canvasId) {
        const inRoom = await listRoomCanvases(args.roomId)
        if (inRoom.length > 1) return missingCanvasResult(inRoom)
        canvasId = inRoom[0]?.id
      }
      if (canvasId) {
        const existing = await loadCanvas(canvasId)
        if (existing && existing.roomId !== args.roomId) {
          throw new Error("Canvas not found in this room")
        }
        if (!existing) {
          await insertRoomCanvas({
            roomId: args.roomId,
            id: canvasId,
            title: input.title || titleFromContent(input.content),
            kind: input.kind ?? "markdown",
            content: "",
          })
          created = true
        }
      } else {
        const row = await insertRoomCanvas({
          roomId: args.roomId,
          title: input.title || titleFromContent(input.content),
          kind: input.kind ?? "markdown",
          content: "",
        })
        canvasId = row.id
        created = true
      }
      if (!canvasId) throw new Error("Could not create the canvas")
      const connection = await getHocuspocus().openDirectConnection(canvasId, {
        agentId: args.agentId,
      })
      try {
        let newText = ""
        await connection.transact((doc) => {
          const text = doc.getText("content")
          text.delete(0, text.length)
          if (input.content) text.insert(0, input.content)
          newText = text.toString()
        })
        if (connection.document) await persistCanvasState(canvasId, connection.document, newText)
        await recordVersion(canvasId, args.agentId, newText)
        return {
          ok: true,
          created,
          canvasId,
          characters: newText.length,
          preview: newText.slice(0, 400),
        }
      } finally {
        await connection.disconnect()
      }
    },
  }
}

export function canvasPatchTool(args: CanvasToolArgs): ToolSpec {
  return {
    name: "canvas_patch",
    description:
      "Apply search/replace edits to a room canvas as live Yjs splices. Each search string must match exactly once. Edits are applied in order, so later searches see earlier replacements. Concurrent human edits are preserved.",
    schema: z.object({
      canvasId: z.string().uuid(),
      edits: z
        .array(z.object({ search: z.string().min(1), replace: z.string() }))
        .min(1)
        .max(50),
    }),
    dangerous: false,
    execute: async (input: { canvasId: string; edits: { search: string; replace: string }[] }) => {
      const existing = await loadCanvas(input.canvasId)
      if (!existing || existing.roomId !== args.roomId) {
        return missingCanvasResult(await listRoomCanvases(args.roomId))
      }
      const connection = await getHocuspocus().openDirectConnection(input.canvasId, {
        agentId: args.agentId,
      })
      try {
        let newText = ""
        await connection.transact((doc) => {
          const text = doc.getText("content")
          const plan = planCanvasPatch(text.toString(), input.edits)
          for (const splice of plan.splices) {
            text.delete(splice.from, splice.to - splice.from)
            if (splice.insert) text.insert(splice.from, splice.insert)
          }
          newText = text.toString()
        })
        if (connection.document)
          await persistCanvasState(input.canvasId, connection.document, newText)
        await recordVersion(input.canvasId, args.agentId, newText)
        return {
          ok: true,
          canvasId: input.canvasId,
          edits: input.edits.length,
          characters: newText.length,
        }
      } finally {
        await connection.disconnect()
      }
    },
  }
}

/** Used by the web restore action through the internal HTTP endpoint. */
export async function restoreCanvasSnapshot(args: {
  canvasId: string
  roomId: string
  userId: string
  snapshot: string
}): Promise<{ characters: number }> {
  const connection = await getHocuspocus().openDirectConnection(args.canvasId, {
    userId: args.userId,
  })
  try {
    let newText = ""
    await connection.transact((doc) => {
      const text = doc.getText("content")
      text.delete(0, text.length)
      if (args.snapshot) text.insert(0, args.snapshot)
      newText = text.toString()
    })
    if (connection.document) await persistCanvasState(args.canvasId, connection.document, newText)
    await getDb().insert(canvasVersions).values({
      canvasId: args.canvasId,
      authorType: "human",
      authorId: args.userId,
      snapshotText: newText,
    })
    return { characters: newText.length }
  } finally {
    await connection.disconnect()
  }
}
