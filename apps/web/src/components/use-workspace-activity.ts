"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { humanHandle } from "@/lib/human-handle"
import { desktopNotify, softBeep } from "@/lib/notify"
import { describeToolCall } from "@/lib/tool-summary"
import { ACTIVITY_REFRESH_EVENT, emitWorkspaceChange } from "@/lib/use-workspace-change"
import { showToast } from "@/components/ui/toast"
import type { ChatListItem, OrgRole } from "@/lib/types"

const REFRESH_DEBOUNCE_MS = 1_200
const FALLBACK_POLL_MS = 30_000

interface ActivityPayload {
  items: ChatListItem[]
  inboxCount: number
  adminRoomIds: string[]
}

interface MessageRow {
  id: string
  room_id: string
  thread_root_id: string | null
  sender_type: string
  sender_id: string | null
  content: string
  status: string
  mentions: string[] | null
}

interface ToolCallRow {
  id: string
  room_id: string
  tool_name: string
  args: unknown
  status: string
}

function isMuted(chat: ChatListItem | undefined): boolean {
  return Boolean(chat?.mutedUntil && new Date(chat.mutedUntil).getTime() > Date.now())
}

/**
 * Keeps the sidebar counts live and raises alerts for rooms the user is not looking at. Row
 * Level Security decides which changes reach this browser, so only readable rooms arrive.
 */
export function useWorkspaceActivity(args: {
  orgSlug: string
  role: OrgRole
  userId: string
  userName: string
  notifications: "all" | "mentions" | "off"
  sound: boolean
  chats: ChatListItem[]
  inboxCount: number
  currentRoomId: string | null
}) {
  const [chats, setChats] = useState(args.chats)
  const [inboxCount, setInboxCount] = useState(args.inboxCount)

  // Server navigations and router.refresh() hand down fresher data.
  useEffect(() => setChats(args.chats), [args.chats])
  useEffect(() => setInboxCount(args.inboxCount), [args.inboxCount])

  const latest = useRef(args)
  latest.current = args
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const adminRooms = useRef<Set<string>>(new Set())
  const alerted = useRef<Set<string>>(new Set())
  const timer = useRef<number | undefined>(undefined)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(latest.current.orgSlug)}/activity`,
        { cache: "no-store" },
      )
      if (!response.ok) return
      const data = (await response.json()) as ActivityPayload
      adminRooms.current = new Set(data.adminRoomIds)
      setChats(data.items)
      setInboxCount(data.inboxCount)
    } catch {
      // The next change or poll tries again.
    }
  }, [])

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => void refresh(), REFRESH_DEBOUNCE_MS)
  }, [refresh])

  const onMessage = useCallback(
    (row: MessageRow) => {
      if (row.status === "streaming") return
      scheduleRefresh()
      const { userId, userName, notifications, sound, currentRoomId, orgSlug } = latest.current
      if (row.status !== "complete" || row.sender_type === "system" || row.sender_id === userId)
        return
      const key = `message:${row.id}`
      if (alerted.current.has(key)) return
      alerted.current.add(key)
      if (notifications === "off") return
      const chat = chatsRef.current.find((item) => item.id === row.room_id)
      if (!chat || isMuted(chat)) return
      // The open room raises its own alerts.
      if (row.room_id === currentRoomId) return
      const mentioned = (row.mentions ?? [])
        .map((mention) => mention.toLowerCase())
        .includes(humanHandle(userName))
      if (notifications === "mentions" && !mentioned) return
      const url = `/${orgSlug}/r/${row.room_id}`
      if (document.visibilityState === "hidden") {
        void desktopNotify({
          title: chat.name,
          body: row.content.replace(/\s+/g, " ").slice(0, 140),
          tag: `mesh-${row.room_id}`,
          url,
        })
      } else if (mentioned) {
        if (sound) softBeep()
        showToast({
          message: `You were mentioned in ${chat.name}`,
          action: { label: "Open", href: url },
          durationMs: 8_000,
        })
      }
    },
    [scheduleRefresh],
  )

  const onToolCall = useCallback(
    (row: ToolCallRow, inserted: boolean) => {
      scheduleRefresh()
      emitWorkspaceChange("tool_calls")
      if (!inserted || row.status !== "pending_approval") return
      const { role, notifications, sound, currentRoomId, orgSlug } = latest.current
      const canApprove = role === "owner" || role === "admin" || adminRooms.current.has(row.room_id)
      const key = `tool:${row.id}`
      if (!canApprove || alerted.current.has(key)) return
      alerted.current.add(key)
      if (notifications === "off") return
      const chat = chatsRef.current.find((item) => item.id === row.room_id)
      const where = chat?.name ?? "a room"
      const summary = describeToolCall({ toolName: row.tool_name, input: row.args })
      if (document.visibilityState === "hidden") {
        void desktopNotify({
          title: `Approval needed in ${where}`,
          body: summary,
          tag: `mesh-approval-${row.id}`,
          url: `/${orgSlug}/inbox`,
        })
        return
      }
      if (row.room_id === currentRoomId) return
      if (sound) softBeep()
      showToast({
        message: `Approval needed in ${where}. It expires in 5 minutes.`,
        tone: "warning",
        action: { label: "Review", href: `/${orgSlug}/inbox` },
        durationMs: 20_000,
      })
    },
    [scheduleRefresh],
  )

  useEffect(() => {
    const supabase = createSupabaseBrowserClient()
    let disposed = false
    let subscribed = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    void refresh()
    void supabase.auth.getSession().then(({ data }) => {
      if (disposed) return
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token)
      channel = supabase
        .channel(`workspace-activity:${args.userId}:${args.orgSlug}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => onMessage(payload.new as MessageRow),
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "messages" },
          (payload) => onMessage(payload.new as MessageRow),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "tool_calls" },
          (payload) => {
            if (payload.eventType === "DELETE") return
            onToolCall(payload.new as ToolCallRow, payload.eventType === "INSERT")
          },
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {
          scheduleRefresh()
          emitWorkspaceChange("tasks")
        })
        .subscribe((status) => {
          subscribed = status === "SUBSCRIBED"
        })
    })

    const poll = window.setInterval(() => {
      if (!subscribed && document.visibilityState === "visible") void refresh()
    }, FALLBACK_POLL_MS)
    const onFocus = () => scheduleRefresh()
    const onRequest = () => void refresh()
    window.addEventListener("focus", onFocus)
    window.addEventListener(ACTIVITY_REFRESH_EVENT, onRequest)

    return () => {
      disposed = true
      window.clearInterval(poll)
      window.clearTimeout(timer.current)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener(ACTIVITY_REFRESH_EVENT, onRequest)
      if (channel) void supabase.removeChannel(channel)
    }
  }, [args.orgSlug, args.userId, onMessage, onToolCall, refresh, scheduleRefresh])

  return { chats, inboxCount }
}
