import * as Updates from "expo-updates"
import { DevSettings } from "react-native"
import { ENV } from "../config/env"
import { normalizeServerUrl } from "./server-url"
import { saveSettings } from "./settings"
import { saveServer, supabase, type SavedServer } from "./supabase"

/**
 * Picking the Sayabot server this phone uses: Sayabot Cloud, or someone's own server. The
 * address is checked first (it must answer /api/instance as a Sayabot server), and a self-hosted
 * server's own Supabase is used for signing in, so nothing goes through Sayabot Cloud.
 */

export { normalizeServerUrl }

export type ServerCheck = { ok: true; server: SavedServer } | { ok: false; error: string }

export async function checkServer(input: string): Promise<ServerCheck> {
  const url = normalizeServerUrl(input)
  if (!url) return { ok: false, error: "That doesn't look like a web address." }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    const res = await fetch(`${url}/api/instance`, { signal: controller.signal })
    const data = res.ok
      ? ((await res.json().catch(() => null)) as Record<string, unknown> | null)
      : null
    if (!data || data.sayabot !== true) {
      return {
        ok: false,
        error: "That server answered, but it isn't running Sayabot (or it needs an update).",
      }
    }
    const sb = (data.supabase ?? {}) as { url?: unknown; anonKey?: unknown }
    if (typeof sb.url !== "string" || typeof sb.anonKey !== "string") {
      return { ok: false, error: "That server isn't set up for the phone app yet." }
    }
    return {
      ok: true,
      server: {
        webApiUrl: url,
        name:
          typeof data.name === "string" && data.name ? data.name : url.replace(/^https?:\/\//, ""),
        supabaseUrl: sb.url,
        supabaseAnonKey: sb.anonKey,
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (/abort/i.test(message))
      return { ok: false, error: "The server didn't answer in time. Is it running?" }
    return {
      ok: false,
      error: "Couldn't reach that server. Check the address and your connection.",
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function restartApp(): Promise<void> {
  try {
    await Updates.reloadAsync()
  } catch {
    DevSettings.reload()
  }
}

/** Switch to a checked server: sign out of the old one, remember the new one, restart. */
export async function useServer(server: SavedServer): Promise<void> {
  await supabase.auth.signOut().catch(() => {})
  await saveServer(server)
  await saveSettings({ webApiUrl: server.webApiUrl })
  await restartApp()
}

/** Back to Sayabot Cloud. */
export async function useCloud(): Promise<void> {
  await supabase.auth.signOut().catch(() => {})
  await saveServer(null)
  await saveSettings({ webApiUrl: ENV.WEB_API_URL })
  await restartApp()
}
