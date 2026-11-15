"use client"

import type { RealtimeChannel } from "@supabase/supabase-js"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import {
  messageFromRow,
  sortMessages,
  sortToolCalls,
  toolCallFromRow,
  type PersonLookup,
  type RawMessageRow,
  type RawToolCallRow,
} from "@/lib/message-map"
import type {
  MessageView,
  RoomAgentView,
  MemberView,
  SessionView,
  ToolCallView,
  TurnStateView,
} from "@/lib/types"

type Connection = "connecting" | "connected" | "error" | "offline"

export const MESSAGE_PAGE_SIZE = 80
const OLDER_PAGE_SIZE = 50
const JUMP_WINDOW = 1_000

interface PresenceMeta {
  userId: string
  name: string
  typing: boolean
}

export interface PresencePerson {
  id: string
  name: string
  typing: boolean
}

export interface RunActivityState {
  runId: string
  step?: number
  label?: string
  status?: string
  plan?: Array<{ id: string; title: string; status: string; note?: string }>
}

function eventPayload<T>(payload: unknown): T {
  return payload as T
}

export function useRoomRealtime(args: {
  roomId: string
  user: { id: string; email: string | null }
  displayName: string
  initialMessages: MessageView[]
  initialToolCalls: ToolCallView[]
  initialSession: SessionView | null
  initialThreadCounts: Record<string, number>
  focusMessageId?: string | null
  roomAgents: RoomAgentView[]
  members: MemberView[]
}) {
  const [messages, setMessages] = useState<MessageView[]>(() => sortMessages(args.initialMessages))
  const [toolCalls, setToolCalls] = useState<ToolCallView[]>(() =>
    sortToolCalls(args.initialToolCalls),
  )
  const [turnState, setTurnState] = useState<TurnStateView | null>(() =>
    args.initialSession
      ? {
          sessionId: args.initialSession.id,
          activeAgentId: null,
          queue: args.initialSession.queue.map((item) => item.agentId),
        }
      : null,
  )
  const [presence, setPresence] = useState<PresencePerson[]>([])
  const [threadCounts, setThreadCounts] = useState<Record<string, number>>(
    args.initialThreadCounts,
  )
  const [runActivity, setRunActivity] = useState<RunActivityState | null>(null)
  const [connection, setConnection] = useState<Connection>("connecting")
  const [hasOlder, setHasOlder] = useState(args.initialMessages.length >= MESSAGE_PAGE_SIZE)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const router = useRouter()
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const supabaseRef = useRef(createSupabaseBrowserClient())
  const channelRef = useRef<RealtimeChannel | null>(null)
  const typingRef = useRef(false)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deltaSeq = useRef(new Map<string, number>())

  const lookup: PersonLookup = useMemo(
    () => ({
      agents: new Map(
        args.roomAgents.map(({ agent }) => [
          agent.id,
          { displayName: agent.displayName, handle: agent.handle },
        ]),
      ),
      members: new Map(
        args.members.map((member) => [member.userId, { displayName: member.displayName }]),
      ),
    }),
    [args.roomAgents, args.members],
  )
  const lookupRef = useRef(lookup)
  lookupRef.current = lookup
  const userRef = useRef({ id: args.user.id, name: args.displayName })
  userRef.current = { id: args.user.id, name: args.displayName }
  const roomIdRef = useRef(args.roomId)
  roomIdRef.current = args.roomId

  const mergeMessage = useCallback((incoming: MessageView, authoritative = false) => {
    setMessages((prev) => {
      const index = prev.findIndex((message) => message.id === incoming.id)
      if (index === -1) return sortMessages([...prev, incoming])
      const current = prev[index]!
      let content = incoming.content
      if (!authoritative) {
        if (incoming.content.length < current.content.length && incoming.status === "streaming") {
          content = current.content
        }
      }
      const next = {
        ...current,
        ...incoming,
        content,
        metadata: { ...current.metadata, ...incoming.metadata },
      }
      const copy = [...prev]
      copy[index] = next
      return copy
    })
  }, [])

  const refreshMessage = useCallback(
    async (messageId: string) => {
      const supabase = supabaseRef.current
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("id", messageId)
        .maybeSingle()
      if (data) mergeMessage(messageFromRow(data as RawMessageRow, lookupRef.current), true)
    },
    [mergeMessage],
  )

  const mergeToolCall = useCallback((incoming: ToolCallView) => {
    setToolCalls((prev) => {
      const index = prev.findIndex((call) => call.id === incoming.id)
      if (index === -1) return sortToolCalls([...prev, incoming])
      const copy = [...prev]
      copy[index] = { ...copy[index]!, ...incoming }
      return copy
    })
  }, [])

  const mergeHistory = useCallback(
    (rows: RawMessageRow[]) => {
      for (const row of rows) {
        const mapped = messageFromRow(row, lookupRef.current)
        mergeMessage(mapped, row.status !== "streaming")
      }
    },
    [mergeMessage],
  )

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => router.refresh(), 500)
  }, [router])

  const mergeToolRows = useCallback(
    async (messageIds: string[]) => {
      if (!messageIds.length) return
      const { data } = await supabaseRef.current
        .from("tool_calls")
        .select("*")
        .in("message_id", messageIds)
      for (const row of (data ?? []) as RawToolCallRow[]) mergeToolCall(toolCallFromRow(row))
    },
    [mergeToolCall],
  )

  const messagesRef = useRef(messages)
  messagesRef.current = messages

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current.find((message) => message.threadRootId === null)
    if (!oldest) return
    setLoadingOlder(true)
    try {
      const { data } = await supabaseRef.current
        .from("messages")
        .select("*")
        .eq("room_id", roomIdRef.current)
        .is("thread_root_id", null)
        .lt("created_at", oldest.createdAt)
        .order("created_at", { ascending: false })
        .limit(OLDER_PAGE_SIZE)
      const rows = (data ?? []) as RawMessageRow[]
      mergeHistory(rows)
      await mergeToolRows(rows.map((row) => row.id))
      setHasOlder(rows.length >= OLDER_PAGE_SIZE)
    } finally {
      setLoadingOlder(false)
    }
  }, [mergeHistory, mergeToolRows])

  // A link from search can point at a message older than the loaded window.
  useEffect(() => {
    const target = args.focusMessageId
    if (!target || messagesRef.current.some((message) => message.id === target)) return
    let cancelled = false
    void (async () => {
      const supabase = supabaseRef.current
      const { data: row } = await supabase
        .from("messages")
        .select("created_at")
        .eq("id", target)
        .eq("room_id", roomIdRef.current)
        .maybeSingle()
      if (!row || cancelled) return
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("room_id", roomIdRef.current)
        .is("thread_root_id", null)
        .gte("created_at", row.created_at)
        .order("created_at", { ascending: true })
        .limit(JUMP_WINDOW)
      if (cancelled) return
      const rows = (data ?? []) as RawMessageRow[]
      mergeHistory(rows)
      await mergeToolRows(rows.map((item) => item.id))
      setHasOlder(true)
    })()
    return () => {
      cancelled = true
    }
  }, [args.focusMessageId, mergeHistory, mergeToolRows])

  useEffect(() => {
    const supabase = supabaseRef.current
    let disposed = false
    void supabase.auth.getSession().then(({ data }) => {
      if (disposed) return
      if (data.session?.access_token) {
        supabase.realtime.setAuth(data.session.access_token)
      }
      const channel = supabase.channel(`room:${args.roomId}`, {
        config: {
          private: true,
          presence: { key: args.user.id },
        },
      })
      channelRef.current = channel

    const applyPresence = () => {
      const state = channel.presenceState<PresenceMeta>()
      const byId = new Map<string, PresencePerson>()
      for (const [key, entries] of Object.entries(state)) {
        for (const meta of entries) {
          const id = meta.userId || key
          const current = byId.get(id)
          byId.set(id, {
            id,
            name: meta.name || current?.name || "someone",
            typing: Boolean(meta.typing) || Boolean(current?.typing),
          })
        }
      }
      setPresence([...byId.values()])
    }

    channel
      .on("broadcast", { event: "message.delta" }, ({ payload }) => {
        const event = eventPayload<{ messageId: string; seq: number; delta: string }>(payload)
        const last = deltaSeq.current.get(event.messageId) ?? -1
        if (event.seq <= last) return
        deltaSeq.current.set(event.messageId, event.seq)
        setMessages((prev) => {
          const index = prev.findIndex((message) => message.id === event.messageId)
          if (index === -1) {
            return sortMessages([
              ...prev,
              {
                id: event.messageId,
                roomId: roomIdRef.current,
                threadRootId: null,
                senderType: "agent",
                senderId: null,
                content: event.delta,
                status: "streaming",
                mentions: [],
                runId: null,
                metadata: {},
                createdAt: new Date().toISOString(),
                senderName: "agent",
                senderHandle: null,
              },
            ])
          }
          const current = prev[index]!
          if (current.status !== "streaming") return prev
          const copy = [...prev]
          copy[index] = { ...current, content: current.content + event.delta }
          return copy
        })
      })
      .on("broadcast", { event: "message.done" }, ({ payload }) => {
        const event = eventPayload<{ messageId: string; status: MessageView["status"] }>(payload)
        setRunActivity(null)
        setMessages((prev) => {
          const index = prev.findIndex((message) => message.id === event.messageId)
          if (index === -1) return prev
          const copy = [...prev]
          copy[index] = { ...copy[index]!, status: event.status }
          return copy
        })
        void refreshMessage(event.messageId)
      })
      .on("broadcast", { event: "message.removed" }, ({ payload }) => {
        // A failed attempt the server retried; the retry arrives as its own message.
        const event = eventPayload<{ messageId: string }>(payload)
        setMessages((prev) => prev.filter((message) => message.id !== event.messageId))
      })
      .on("broadcast", { event: "run.step" }, ({ payload }) => {
        const event = eventPayload<{ runId: string; step: number; kind: string; label: string }>(payload)
        setRunActivity((prev) => ({
          runId: event.runId,
          step: event.step,
          label: event.label,
          status: prev?.status,
          plan: prev?.plan,
        }))
      })
      .on("broadcast", { event: "run.status" }, ({ payload }) => {
        const event = eventPayload<{ runId: string; status: string }>(payload)
        setRunActivity((prev) => ({
          runId: event.runId,
          step: prev?.step,
          label: prev?.label,
          status: event.status,
          plan: prev?.plan,
        }))
      })
      .on("broadcast", { event: "run.plan" }, ({ payload }) => {
        const event = eventPayload<{ runId: string; plan: Array<{ id: string; title: string; status: string; note?: string }> }>(payload)
        setRunActivity((prev) => ({
          runId: event.runId,
          step: prev?.step,
          label: prev?.label,
          status: prev?.status,
          plan: event.plan,
        }))
      })
      .on("broadcast", { event: "turn.state" }, ({ payload }) => {
        const event = eventPayload<TurnStateView>(payload)
        if (event.threadRootId) return
        setTurnState(event)
      })
      .on("broadcast", { event: "tool.approval_requested" }, ({ payload }) => {
        const event = eventPayload<{
          toolCallId: string
          agentId: string
          toolName: string
          args: Record<string, unknown>
        }>(payload)
        setToolCalls((prev) => {
          if (prev.some((call) => call.id === event.toolCallId)) {
            return prev.map((call) =>
              call.id === event.toolCallId ? { ...call, status: "pending_approval" } : call,
            )
          }
          return sortToolCalls([
            ...prev,
            {
              id: event.toolCallId,
              runId: null,
              roomId: roomIdRef.current,
              messageId: null,
              toolName: event.toolName,
              args: event.args,
              result: null,
              status: "pending_approval",
              approvedBy: null,
              resolvedAt: null,
              error: null,
              createdAt: new Date().toISOString(),
            },
          ])
        })
      })
      .on("broadcast", { event: "tool.approval_resolved" }, ({ payload }) => {
        const event = eventPayload<{ toolCallId: string; status: "approved" | "rejected" }>(payload)
        setToolCalls((prev) =>
          prev.map((call) =>
            call.id === event.toolCallId ? { ...call, status: event.status } : call,
          ),
        )
      })
      .on("broadcast", { event: "tool.started" }, ({ payload }) => {
        const event = eventPayload<{
          toolCallId: string
          agentId: string
          toolName: string
          args: Record<string, unknown>
        }>(payload)
        setToolCalls((prev) => {
          if (prev.some((call) => call.id === event.toolCallId)) {
            return prev
          }
          return sortToolCalls([
            ...prev,
            {
              id: event.toolCallId,
              runId: null,
              roomId: roomIdRef.current,
              messageId: null,
              toolName: event.toolName,
              args: event.args ?? {},
              result: null,
              status: "running",
              approvedBy: null,
              resolvedAt: null,
              error: null,
              createdAt: new Date().toISOString(),
              liveOutput: "",
            },
          ])
        })
      })
      .on("broadcast", { event: "tool.finished" }, ({ payload }) => {
        const event = eventPayload<{
          toolCallId: string
          status: "done" | "error" | "rejected"
          durationMs: number
        }>(payload)
        setToolCalls((prev) =>
          prev.map((call) =>
            call.id === event.toolCallId
              ? {
                  ...call,
                  status: event.status === "error" ? "error" : event.status === "rejected" ? "rejected" : "done",
                  resolvedAt: new Date().toISOString(),
                }
              : call,
          ),
        )
      })
      .on("broadcast", { event: "tool.output" }, ({ payload }) => {
        const event = eventPayload<{
          toolCallId: string
          seq: number
          chunk: string
        }>(payload)
        setToolCalls((prev) =>
          prev.map((call) =>
            call.id === event.toolCallId
              ? {
                  ...call,
                  liveOutput: (call.liveOutput ?? "") + event.chunk,
                }
              : call,
          ),
        )
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `room_id=eq.${args.roomId}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as { id?: string }
            if (old.id) setMessages((prev) => prev.filter((m) => m.id !== old.id))
            return
          }
          const row = payload.new as RawMessageRow
          mergeMessage(messageFromRow(row, lookupRef.current))
          if (payload.eventType === "INSERT" && row.thread_root_id) {
            setThreadCounts((prev) => ({
              ...prev,
              [row.thread_root_id as string]: (prev[row.thread_root_id as string] ?? 0) + 1,
            }))
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tool_calls", filter: `room_id=eq.${args.roomId}` },
        (payload) => {
          if (payload.eventType === "DELETE") return
          mergeToolCall(toolCallFromRow(payload.new as RawToolCallRow))
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "canvases", filter: `room_id=eq.${args.roomId}` },
        (payload) => {
          // Content edits arrive through the canvas sync; only the list of canvases refreshes here.
          if (payload.eventType !== "UPDATE") scheduleRefresh()
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meetings", filter: `room_id=eq.${args.roomId}` },
        () => scheduleRefresh(),
      )
      .on("presence", { event: "sync" }, applyPresence)
      .on("presence", { event: "join" }, applyPresence)
      .on("presence", { event: "leave" }, applyPresence)
      .subscribe(async (status) => {
        if (disposed) return
        if (status === "SUBSCRIBED") {
          setConnection(navigator.onLine ? "connected" : "offline")
          await channel.track({
            userId: userRef.current.id,
            name: userRef.current.name,
            typing: false,
          } satisfies PresenceMeta)
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnection("error")
        } else if (status === "CLOSED") {
          setConnection("error")
        }
      })

    })

    const onOffline = () => setConnection("offline")
    const onOnline = () => {
      // A short network drop can leave the channel joined, in which case no new SUBSCRIBED
      // event arrives and the room would look disconnected forever.
      const joined = (channelRef.current as unknown as { state?: string } | null)?.state === "joined"
      setConnection(joined ? "connected" : "connecting")
    }
    window.addEventListener("offline", onOffline)
    window.addEventListener("online", onOnline)

    return () => {
      disposed = true
      window.removeEventListener("offline", onOffline)
      window.removeEventListener("online", onOnline)
      if (typingTimer.current) clearTimeout(typingTimer.current)
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      const active = channelRef.current
      channelRef.current = null
      if (active) void supabase.removeChannel(active)
    }
  }, [args.roomId, args.user.id, mergeMessage, mergeToolCall, refreshMessage, scheduleRefresh])

  useEffect(() => {
    if (connection === "connected" || connection === "offline") return
    const timer = setInterval(async () => {
      const supabase = supabaseRef.current
      const [messagesResult, toolsResult] = await Promise.all([
        supabase
          .from("messages")
          .select("*")
          .eq("room_id", roomIdRef.current)
          .order("created_at", { ascending: false })
          .limit(MESSAGE_PAGE_SIZE),
        supabase
          .from("tool_calls")
          .select("*")
          .eq("room_id", roomIdRef.current)
          .order("created_at", { ascending: false })
          .limit(60),
      ])
      for (const row of (messagesResult.data ?? []) as RawMessageRow[]) {
        mergeMessage(messageFromRow(row, lookupRef.current), row.status !== "streaming")
      }
      for (const row of (toolsResult.data ?? []) as RawToolCallRow[]) {
        mergeToolCall(toolCallFromRow(row))
      }
    }, 4_000)
    return () => clearInterval(timer)
  }, [connection, mergeMessage, mergeToolCall])

  const trackTyping = useCallback(() => {
    const channel = channelRef.current
    if (!channel) return
    if (!typingRef.current) {
      typingRef.current = true
      void channel.track({
        userId: userRef.current.id,
        name: userRef.current.name,
        typing: true,
      } satisfies PresenceMeta)
    }
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      typingRef.current = false
      void channel.track({
        userId: userRef.current.id,
        name: userRef.current.name,
        typing: false,
      } satisfies PresenceMeta)
    }, 2_500)
  }, [])

  return {
    messages,
    toolCalls,
    turnState,
    runActivity,
    presence,
    threadCounts,
    connection,
    trackTyping,
    mergeHistory,
    hasOlder,
    loadingOlder,
    loadOlder,
  }
}
