import AsyncStorage from "@react-native-async-storage/async-storage"
import { useCallback, useEffect, useState } from "react"
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
 * One shared copy of the home data for the whole app (Chats, More, Tasks, agent pages all read
 * it): shown instantly from the phone's last copy, refreshed from the server, and kept live by a
 * single realtime subscription that runs while any screen is using it.
 */
interface HomeState {
  data: HomeData | null
  loading: boolean
  error: string | null
}
let state: HomeState = { data: null, loading: true, error: null }
const listeners = new Set<(s: HomeState) => void>()
let users = 0
let orgSlugNow = ""
let stopLive: (() => void) | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let inflight: Promise<void> | null = null

function set(next: Partial<HomeState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l(state))
}

void AsyncStorage.getItem(CACHE_KEY).then((raw) => {
  if (!raw || state.data) return
  try {
    set({ data: JSON.parse(raw) as HomeData, loading: false })
  } catch {
    // ignore a bad cache
  }
})

export function refreshHome(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) return
      const res = await fetch(`${currentWebApiUrl()}/api/mobile/home?orgSlug=${encodeURIComponent(orgSlugNow)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = (await res.json().catch(() => ({}))) as HomeData & { error?: string }
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`)
      set({ data: json, error: null, loading: false })
      void AsyncStorage.setItem(CACHE_KEY, JSON.stringify(json))
      if (json.org?.slug && json.org.slug !== orgSlugNow) {
        orgSlugNow = json.org.slug
        void applySettings({ orgSlug: json.org.slug })
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Could not load your chats", loading: false })
    } finally {
      inflight = null
    }
  })()
  return inflight
}

function soon() {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => void refreshHome(), 700)
}

function startLive() {
  const channel = supabase
    .channel(`home:${Math.random().toString(36).slice(2)}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, soon)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, soon)
    .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, soon)
    .subscribe()
  const timer = setInterval(() => void refreshHome(), 45_000)
  stopLive = () => {
    clearInterval(timer)
    void supabase.removeChannel(channel)
  }
}

export function useHome() {
  const { settings } = useSettings()
  const [snapshot, setSnapshot] = useState<HomeState>(state)

  useEffect(() => {
    listeners.add(setSnapshot)
    users += 1
    if (users === 1) startLive()
    return () => {
      listeners.delete(setSnapshot)
      users -= 1
      if (users === 0) {
        stopLive?.()
        stopLive = null
      }
    }
  }, [])

  useEffect(() => {
    if (settings.orgSlug !== orgSlugNow || !state.data) {
      orgSlugNow = settings.orgSlug
      void refreshHome()
    }
  }, [settings.orgSlug])

  const refresh = useCallback(() => refreshHome(), [])
  return { data: snapshot.data, loading: snapshot.loading, error: snapshot.error, refresh }
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
