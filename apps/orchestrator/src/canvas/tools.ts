import { planCanvasPatch } from "@sayabot/core"
import { canvasVersions } from "@sayabot/db"
import { z } from "zod"
import { getDb } from "../db"
import type { ToolSpec } from "../tools/audited"
import { getHocuspocus, loadCanvas, persistCanvasState } from "./server"

interface CanvasToolArgs {
  roomId: string
  agentId: string
}

async function requireCanvas(canvasId: string, roomId: string) {
  const canvas = await loadCanvas(canvasId)
  if (!canvas || canvas.roomId !== roomId) throw new Error("Canvas not found in this room")
  return canvas
}

async function recordVersion(canvasId: string, authorId: string, text: string) {
  await getDb()
    .insert(canvasVersions)
    .values({ canvasId, authorType: "agent", authorId, snapshotText: text })
}

export function canvasReadTool(args: CanvasToolArgs): ToolSpec {
  return {
    name: "canvas_read",
    description: "Read the current full contents and metadata of a room canvas by its id.",
    schema: z.object({
      canvasId: z.string().uuid(),
    }),
    dangerous: false,
    execute: async (input: { canvasId: string }) => {
      const canvas = await requireCanvas(input.canvasId, args.roomId)
      return {
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
      "Replace the entire contents of a room canvas. Use this for a full rewrite; prefer canvas_patch for small changes so concurrent human edits survive.",
    schema: z.object({
      canvasId: z.string().uuid(),
      content: z.string().max(200_000),
    }),
    dangerous: false,
    execute: async (input: { canvasId: string; content: string }) => {
      await requireCanvas(input.canvasId, args.roomId)
      const connection = await getHocuspocus().openDirectConnection(input.canvasId, {
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
        if (connection.document)
          await persistCanvasState(input.canvasId, connection.document, newText)
        await recordVersion(input.canvasId, args.agentId, newText)
        return {
          ok: true,
          canvasId: input.canvasId,
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
      await requireCanvas(input.canvasId, args.roomId)
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
