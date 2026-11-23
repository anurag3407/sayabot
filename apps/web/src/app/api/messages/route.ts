import { NextResponse } from "next/server"
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js"
import { getRoomAccess } from "@/lib/auth"
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { insertHumanMessage } from "@/lib/message-send"
import { queueRoomMessage } from "@/lib/orchestrator"

export async function POST(request: Request) {
  let supabase: SupabaseClient<any> | null = null
  let user: User | null = null

  const authHeader = request.headers.get("authorization")
  if (authHeader && authHeader.slice(0, 7).toLowerCase() === "bearer ") {
    const token = authHeader.slice(7).trim()
    const tokenClient = createClient<any>(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await tokenClient.auth.getUser(token)
    if (!error && data?.user) {
      supabase = tokenClient
      user = data.user
    }
  }

  if (!user || !supabase) {
    const cookieClient = await createSupabaseServerClient()
    const {
      data: { user: cookieUser },
    } = await cookieClient.auth.getUser()
    supabase = cookieClient
    user = cookieUser
  }

  if (!user || !supabase) return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  const client: SupabaseClient<any> = supabase

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 })
  }
  const input = body as {
    orgSlug?: unknown
    roomId?: unknown
    content?: unknown
    threadRootId?: unknown
    clientId?: unknown
    messageId?: unknown
    id?: unknown
  }
  if (
    typeof input.orgSlug !== "string" ||
    typeof input.roomId !== "string" ||
    typeof input.content !== "string"
  ) {
    return NextResponse.json({ error: "invalid fields" }, { status: 400 })
  }
  const access = await getRoomAccess(input.orgSlug, input.roomId, { client, user })
  if (!access) return NextResponse.json({ error: "room not found" }, { status: 404 })
  const explicitId =
    typeof input.messageId === "string"
      ? input.messageId
      : typeof input.id === "string"
        ? input.id
        : typeof input.clientId === "string"
          ? input.clientId
          : null
  const inserted = await insertHumanMessage({
    supabase: client,
    userId: user.id,
    roomId: input.roomId,
    content: input.content,
    threadRootId: typeof input.threadRootId === "string" ? input.threadRootId : null,
    clientId: typeof input.clientId === "string" ? input.clientId : null,
    id: explicitId,
  })
  if (!inserted.ok) return NextResponse.json({ error: inserted.error }, { status: 400 })
  const queued = await queueRoomMessage(input.roomId, inserted.id)
  return NextResponse.json({
    messageId: inserted.id,
    queued: queued.ok,
    warning: queued.ok ? undefined : "Saved; the agent queue is unreachable.",
  })
}
