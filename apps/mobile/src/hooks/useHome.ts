import AsyncStorage from "@react-native-async-storage/async-storage"
import { useCallback, useEffect, useRef, useState } from "react"
import { currentWebApiUrl } from "../core/settings"
import { supabase } from "../core/supabase"
import { applySettings, useSettings } from "./useSettings"

export interface HomeChat {
  id: string
  name: string
  kind: "public" | "private" | "dm"
  agentIds: string[]
  pinned: boolean
  muted: boolean
  unread: number
  questions: number
  workingAgentId: string | null
  lastMessage: { preview: string; senderName: string | null; at: string; streaming: boolean } | null
  updatedAt: string
}

export interface HomeAgent {
  id: string
  handle: string
  name: string
  kind: "llm" | "external"
  about: string | null
  model: string
  workingRoomId: string | null
  usage: { tokens: number; runs: number; costUsd: number; lastAt: string | null; topModel: string | null } | null
  roomIds: string[]
}

export interface HomeData {
  org: { slug: string; name: string }
  orgs: Array<{ id: string; slug: string; name: string }>
  user: { id: string; name: string; email: string }
  needsYou: { questions: number; approvals: number }
  chats: HomeChat[]
  agents: HomeAgent[]
}

const CACHE_KEY = "@sayabot/home_cache_v1"

/**
 * The home screen's data: shown instantly from the last copy on the phone, then refreshed from
 * the server and kept live (new messages, agents starting/finishing, questions arriving).
 */
export function useHome() {
  const { settings } = useSettings()
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    void AsyncStorage.getItem(CACHE_KEY).then((raw) => {
      if (!raw) return
      try {
        setData((current) => current ?? (JSON.parse(raw) as HomeData))
        setLoading(false)
      } catch {
        // ignore a bad cache
      }
    })
  }, [])

  const refresh = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`${currentWebApiUrl()}/api/mobile/home?orgSlug=${encodeURIComponent(settings.orgSlug)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = (await res.json().catch(() => ({}))) as HomeData & { error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      setData(json)
      setError(null)
      void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(json))
      if (json.org?.slug && json.org.slug !== settings.orgSlug) void applySettings({ orgSlug: json.org.slug })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your chats")
    } finally {
      setLoading(false)
    }
  }, [settings.orgSlug])

  const soon = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => void refresh(), 700)
  }, [refresh])

  useEffect(() => {
    void refresh()
    const channel = supabase
      .channel(`home:${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, soon)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, soon)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, soon)
      .subscribe()
    const timer = setInterval(() => void refresh(), 45_000)
    return () => {
      clearInterval(timer)
      if (debounce.current) clearTimeout(debounce.current)
      void supabase.removeChannel(channel)
    }
  }, [refresh, soon])

  return { data, loading, error, refresh }
}

/** "now", "3m", "2h", "Tue", "12 Nov". */
export function shortTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return "now"
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000 && new Date().getDate() === d.getDate()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  if (diff < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: "short" })
  return d.toLocaleDateString([], { day: "numeric", month: "short" })
}

export function compactNumber(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`
  return String(Math.round(n))
}
