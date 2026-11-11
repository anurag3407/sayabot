import { useCallback, useEffect, useState } from "react"
import { currentWebApiUrl } from "../core/settings"
import { supabase } from "../core/supabase"

export interface InboxItem {
  key: string
  question: string
  hint: string | null
  options: string[]
  answer: string | null
}

export interface InboxQuestion {
  id: string
  roomId: string
  roomName: string
  title: string
  description: string
  agentHandle: string | null
  agentName: string
  askedCount: number
  updatedAt: string
  options: string[]
  items: InboxItem[]
}

async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error("Sign in to see your Inbox.")
  return { Authorization: `Bearer ${session.access_token}` }
}

/** Questions agents are waiting on, refreshed live when tasks change. */
export function useInbox(orgSlug: string) {
  const [questions, setQuestions] = useState<InboxQuestion[]>([])
  const [approvals, setApprovals] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!orgSlug) return
    try {
      const res = await fetch(`${currentWebApiUrl()}/api/mobile/inbox?orgSlug=${encodeURIComponent(orgSlug)}`, {
        headers: await authHeaders(),
      })
      const data = (await res.json().catch(() => ({}))) as { questions?: InboxQuestion[]; approvals?: number; error?: string }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setQuestions(data.questions ?? [])
      setApprovals(data.approvals ?? 0)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your Inbox")
    } finally {
      setLoading(false)
    }
  }, [orgSlug])

  const answer = useCallback(
    async (input: { taskId: string; answer?: string; itemAnswers?: Record<string, string>; alsoPost?: boolean }) => {
      const res = await fetch(`${currentWebApiUrl()}/api/mobile/inbox/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify({ orgSlug, ...input }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string }
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
      await refresh()
      return data.message ?? "Sent"
    },
    [orgSlug, refresh],
  )

  useEffect(() => {
    void refresh()
    const channel = supabase
      .channel(`inbox:live:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => void refresh())
      .subscribe()
    const timer = setInterval(() => void refresh(), 30_000)
    return () => {
      clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  return { questions, approvals, loading, error, refresh, answer }
}
