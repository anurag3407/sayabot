import AsyncStorage from "@react-native-async-storage/async-storage"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { ENV } from "../config/env"

/**
 * The Supabase project this phone signs in against. It belongs to the Sayabot server the person
 * picked: Sayabot Cloud by default, or a self-hosted server's own Supabase (from its
 * /api/instance). Restored before the first screen renders (see App.tsx).
 */
const SERVER_KEY = "@sayabot/server_v1"

export interface SavedServer {
  webApiUrl: string
  name: string
  supabaseUrl: string
  supabaseAnonKey: string
}

export function makeClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
}

let current: SupabaseClient = makeClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY)
let currentUrl = ENV.SUPABASE_URL

/** The Supabase project this phone signs in against right now. */
export function currentSupabaseUrl(): string {
  return currentUrl
}
const setups: Array<() => void> = []

/**
 * For module-level setup that subscribes to the client (auth listeners): runs now, and again if
 * the saved server's client replaces the default one at startup.
 */
export function onSupabaseClient(setup: () => void): void {
  setups.push(setup)
  setup()
}

/**
 * Everyone imports `supabase`; it always points at the current server's client. Methods are
 * bound to the real client so `supabase.from(...)` keeps working after a switch.
 */
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const value = Reflect.get(current, prop, current) as unknown
    return typeof value === "function"
      ? (value as (...a: unknown[]) => unknown).bind(current)
      : value
  },
})

export async function loadSavedServer(): Promise<SavedServer | null> {
  try {
    const raw = await AsyncStorage.getItem(SERVER_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<SavedServer>
    if (!saved.webApiUrl || !saved.supabaseUrl || !saved.supabaseAnonKey) return null
    return { name: saved.name || saved.webApiUrl, ...saved } as SavedServer
  } catch {
    return null
  }
}

/** Called once at startup, before anything signs in or subscribes. */
export async function restoreServerClient(): Promise<SavedServer | null> {
  const saved = await loadSavedServer()
  if (saved && saved.supabaseUrl !== ENV.SUPABASE_URL) {
    current = makeClient(saved.supabaseUrl, saved.supabaseAnonKey)
    currentUrl = saved.supabaseUrl
    for (const setup of setups) setup()
  }
  return saved
}

/** Remember the server; the app restarts into it so every screen uses the new client. */
export async function saveServer(server: SavedServer | null): Promise<void> {
  if (server) await AsyncStorage.setItem(SERVER_KEY, JSON.stringify(server))
  else await AsyncStorage.removeItem(SERVER_KEY)
}
