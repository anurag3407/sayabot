import { randomUUID } from "node:crypto"
import { NextResponse } from "next/server"
import { getAppUrl } from "@/lib/env"
import { userFromRequest } from "@/lib/route-bearer"
import { createAdminClient } from "@/lib/supabase/admin"

const MAX_BYTES = 15 * 1024 * 1024
const ALLOWED = /^(image\/(jpeg|png|webp|gif|heic|heif)|application\/pdf|text\/(plain|csv|markdown)|application\/(json|vnd\.openxmlformats-officedocument\.[a-z.]+|msword|vnd\.ms-excel))$/

/**
 * A file from the phone for one chat. Stored privately under the room; the returned link goes
 * through /api/files, which checks that the reader can see that room.
 */
export async function POST(request: Request) {
  const who = await userFromRequest(request)
  if (!who) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  const roomId = String(form?.get("roomId") ?? "")
  if (!(file instanceof File) || !/^[0-9a-f-]{36}$/i.test(roomId)) return NextResponse.json({ error: "file and roomId are required" }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Files can be up to 15 MB." }, { status: 413 })
  const type = file.type || "application/octet-stream"
  if (!ALLOWED.test(type)) return NextResponse.json({ error: "That kind of file can't be sent yet." }, { status: 415 })

  // RLS on rooms: the person must be able to read the room they're sending to.
  const { data: room } = await who.client.from("rooms").select("id").eq("id", roomId).maybeSingle()
  if (!room) return NextResponse.json({ error: "room not found" }, { status: 404 })

  const safeName = (file.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "file"
  const path = `rooms/${roomId}/${randomUUID()}/${safeName}`
  const { error } = await createAdminClient()
    .storage.from("attachments")
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: type, upsert: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({
    url: `${getAppUrl().replace(/\/+$/, "")}/api/files/${path}`,
    name: file.name || safeName,
    type,
    size: file.size,
  })
}
