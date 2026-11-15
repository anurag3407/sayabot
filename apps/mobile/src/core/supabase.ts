import AsyncStorage from "@react-native-async-storage/async-storage"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { ENV } from "../config/env"
import { checkServer, isPlaceholderSupabaseUrl } from "./server-url"

/**
 * The Supabase project this phone signs in against. It belongs to the Sayabot server the person
 * picked: Sayabot Cloud by default, or a self-hosted server's own Supabase (from its
 * /api/instance). Restored before the first screen renders (see App.tsx).
 */
const SERVER_KEY = "@sayabot/server_v1"
// Sayabot Cloud's own Supabase settings, as last reported by its /api/instance.
const CLOUD_KEY = "@sayabot/cloud_v1"

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

function switchClient(url: string, anonKey: string): void {
  if (url === currentUrl) return
  current = makeClient(url, anonKey)
  currentUrl = url
  for (const setup of setups) setup()
}

async function loadCloudConfig(): Promise<SavedServer | null> {
  try {
    const raw = await AsyncStorage.getItem(CLOUD_KEY)
    if (!raw) return null
    const cloud = JSON.parse(raw) as Partial<SavedServer>
    if (cloud.webApiUrl !== ENV.WEB_API_URL || !cloud.supabaseUrl || !cloud.supabaseAnonKey)
      return null
    return cloud as SavedServer
  } catch {
    return null
  }
}

/** Asks Sayabot Cloud which Supabase project it signs people in on, and remembers the answer. */
async function fetchCloudConfig(): Promise<SavedServer | null> {
  const check = await checkServer(ENV.WEB_API_URL)
  if (!check.ok) return null
  const cloud: SavedServer = { ...check.server, webApiUrl: ENV.WEB_API_URL }
  await AsyncStorage.setItem(CLOUD_KEY, JSON.stringify(cloud)).catch(() => {})
  return cloud
}

/**
 * Called once at startup, before anything signs in or subscribes.
 *
 * A self-hosted server uses its saved Supabase. Sayabot Cloud is treated the same way: its
 * Supabase comes from Cloud's /api/instance (cached), so a build made without
 * EXPO_PUBLIC_SUPABASE_URL (or with a stale one) still signs in on the right project. The
 * values baked into the build are only a fallback for a first launch with no network.
 */
export async function restoreServerClient(): Promise<SavedServer | null> {
  const saved = await loadSavedServer()
  if (saved) {
    switchClient(saved.supabaseUrl, saved.supabaseAnonKey)
    return saved
  }
  const cached = await loadCloudConfig()
  if (cached) {
    switchClient(cached.supabaseUrl, cached.supabaseAnonKey)
    // Refresh quietly; a changed project takes effect on the next launch, never mid-session.
    void fetchCloudConfig().catch(() => null)
    return null
  }
  if (isPlaceholderSupabaseUrl(ENV.SUPABASE_URL)) {
    // Nothing usable built in: wait for Cloud's answer (checkServer gives up after 8 seconds).
    const cloud = await fetchCloudConfig().catch(() => null)
    if (cloud) switchClient(cloud.supabaseUrl, cloud.supabaseAnonKey)
  } else {
    void fetchCloudConfig().catch(() => null)
  }
  return null
}

/** Remember the server; the app restarts into it so every screen uses the new client. */
export async function saveServer(server: SavedServer | null): Promise<void> {
  if (server) await AsyncStorage.setItem(SERVER_KEY, JSON.stringify(server))
  else await AsyncStorage.removeItem(SERVER_KEY)
}
