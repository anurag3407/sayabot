import { useCallback, useEffect, useState } from "react"
import { currentWebApiUrl } from "../core/settings"
import { supabase } from "../core/supabase"
import type { Message, PendingApproval } from "../types"

export function useRoomRealtime(roomId: string, orgSlug: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [agentStatus, setAgentStatus] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [terminalLogs, setTerminalLogs] = useState<string[]>([])
  const [approval, setApproval] = useState<PendingApproval | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 1. Initial Load of Messages History
  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from("messages")
        .select("id, room_id, thread_root_id, sender_type, sender_id, content, status, mentions, metadata, created_at")
        .eq("room_id", roomId)
        .is("thread_root_id", null)
        .order("created_at", { ascending: true })
        .limit(80)

      if (error) throw error

      if (data) {
        setMessages(
          data.map((m: any) => ({
            id: m.id,
            roomId: m.room_id,
            threadRootId: m.thread_root_id,
            senderType: m.sender_type,
            senderId: m.sender_id,
            senderName: m.metadata?.agentName || (m.sender_type === "agent" ? "Agent" : "Human"),
            senderHandle: m.metadata?.agentHandle || null,
            content: m.content,
            status: m.status,
            mentions: m.mentions || [],
            metadata: m.metadata || {},
            createdAt: m.created_at,
          }))
        )
      }
    } catch (err) {
      console.error("[useRoomRealtime] loadHistory error:", err)
      setError(err instanceof Error ? err.message : "Could not load messages.")
    } finally {
      setLoading(false)
    }
  }, [roomId])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

  // 2. Realtime Channel Subscription
  useEffect(() => {
    const channel = supabase.channel(`room:${roomId}`, {
      config: { private: true },
    })

    channel
      // Realtime token streaming
      .on("broadcast", { event: "message.delta" }, ({ payload }) => {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === payload.messageId)
          if (idx === -1) {
            return [
              ...prev,
              {
                id: payload.messageId,
                roomId,
                senderType: "agent",
                senderId: null,
                content: payload.delta,
                status: "streaming",
                createdAt: new Date().toISOString(),
              },
            ]
          }
          const copy = [...prev]
          const existing = copy[idx]!
          copy[idx] = { ...existing, content: existing.content + payload.delta }
          return copy
        })
      })

      // Turn / message done
      .on("broadcast", { event: "message.done" }, ({ payload }) => {
        setAgentStatus(null)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === payload.messageId ? { ...m, status: payload.status } : m
          )
        )
      })

      // Turn state & active agent speaking
      .on("broadcast", { event: "turn.state" }, ({ payload }) => {
        setActiveAgentId(payload.activeAgentId)
      })

      // Terminal output from persistent Docker computer
      .on("broadcast", { event: "tool.output" }, ({ payload }) => {
        setTerminalLogs((prev) => [...prev.slice(-150), payload.chunk])
      })

      // Agent run progress / step
      .on("broadcast", { event: "run.step" }, ({ payload }) => {
        setAgentStatus(payload.label)
      })

      // Agent run status (thinking, running tool, etc.)
      .on("broadcast", { event: "run.status" }, ({ payload }) => {
        if (payload.status === "thinking") setAgentStatus("Agent is thinking...")
        else if (payload.status === "tool") setAgentStatus("Running computer command...")
        else if (payload.status === "compacting") setAgentStatus("Compacting memory...")
        else if (!payload.status.startsWith("waiting")) setAgentStatus(null)
      })

      // Danger tool human approval requested
      .on("broadcast", { event: "tool.approval_requested" }, ({ payload }) => {
        setApproval({
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          agentId: payload.agentId,
          args: (payload.args as Record<string, unknown>) || {},
        })
      })

      // Approval resolved
      .on("broadcast", { event: "tool.approval_resolved" }, () => {
        setApproval(null)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [roomId])

  // 3. Send Human Message
  const sendMessage = async (content: string) => {
    if (!content.trim()) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error("Sign in to send a message.")

    const res = await fetch(`${currentWebApiUrl()}/api/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        orgSlug,
        roomId,
        content: content.trim(),
      }),
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || `HTTP ${res.status}`)
    }

    return res.json()
  }

  // 4. Resolve Danger Tool Approval
  const resolveApproval = async (approved: boolean) => {
    if (!approval) return
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error("Sign in to approve or reject this tool.")

    const res = await fetch(`${currentWebApiUrl()}/api/v1/tools/${approval.toolCallId}/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ approved }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || "That decision was not saved. The tool is still waiting.")
    }
    setApproval(null)
  }

  return {
    messages,
    loading,
    error,
    agentStatus,
    activeAgentId,
    terminalLogs,
    approval,
    sendMessage,
    resolveApproval,
    clearTerminal: () => setTerminalLogs([]),
    reload: loadHistory,
  }
}
