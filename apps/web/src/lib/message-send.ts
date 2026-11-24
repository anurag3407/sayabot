import "server-only"
import { extractHandles } from "@sayabot/core"
import { z } from "zod"

const contentSchema = z.string().min(1).max(100_000)
const uuidSchema = z.string().uuid()

export async function insertHumanMessage(args: {
  supabase: any
  userId: string
  roomId: string
  content: string
  threadRootId?: string | null
  clientId?: string | null
  id?: string | null
  /** "/goal": the bots loop until it's done. "/btw": a side note that doesn't interrupt them. */
  command?: "goal" | "btw" | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const content = args.content.trim()
  if (!contentSchema.safeParse(content).success) {
    return { ok: false, error: "Message must be between 1 and 100,000 characters" }
  }
  if (!uuidSchema.safeParse(args.roomId).success) {
    return { ok: false, error: "Invalid room" }
  }
  let threadRootId: string | null = null
  if (args.threadRootId) {
    if (!uuidSchema.safeParse(args.threadRootId).success) {
      return { ok: false, error: "Invalid thread" }
    }
    const { data: root } = await args.supabase
      .from("messages")
      .select("id, room_id, thread_root_id")
      .eq("id", args.threadRootId)
      .maybeSingle()
    if (!root || root.room_id !== args.roomId) {
      return { ok: false, error: "Thread not found in this room" }
    }
    threadRootId = root.thread_root_id ?? root.id
  }
  if (args.id && uuidSchema.safeParse(args.id).success) {
    const { data: existing } = await args.supabase
      .from("messages")
      .select("id")
      .eq("id", args.id)
      .eq("room_id", args.roomId)
      .eq("sender_id", args.userId)
      .maybeSingle()
    if (existing) return { ok: true, id: existing.id }
  } else if (args.clientId) {
    const { data: existing } = await args.supabase
      .from("messages")
      .select("id")
      .eq("room_id", args.roomId)
      .eq("sender_id", args.userId)
      .filter("metadata->>clientId", "eq", args.clientId)
      .maybeSingle()
    if (existing) return { ok: true, id: existing.id }
  }
  const metadata: Record<string, unknown> = {}
  if (args.clientId) metadata.clientId = args.clientId.slice(0, 80)
  if (args.command === "goal" || args.command === "btw") metadata.command = args.command

  const insertPayload: Record<string, unknown> = {
    room_id: args.roomId,
    thread_root_id: threadRootId,
    sender_type: "human",
    sender_id: args.userId,
    content,
    status: "complete",
    mentions: extractHandles(content),
    metadata,
  }
  if (args.id && uuidSchema.safeParse(args.id).success) {
    insertPayload.id = args.id
  }

  const { data, error } = await args.supabase
    .from("messages")
    .insert(insertPayload)
    .select("id")
    .single()
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not save the message" }
  }
  return { ok: true, id: data.id }
}
