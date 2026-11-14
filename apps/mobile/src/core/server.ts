import * as Updates from "expo-updates"
import { DevSettings } from "react-native"
import { ENV } from "../config/env"
import { checkServer, normalizeServerUrl, type ServerCheck } from "./server-url"
import { saveSettings } from "./settings"
import { saveServer, supabase, type SavedServer } from "./supabase"

/**
 * Picking the Sayabot server this phone uses: Sayabot Cloud, or someone's own server. The
 * address is checked first (it must answer /api/instance as a Sayabot server), and a self-hosted
 * server's own Supabase is used for signing in, so nothing goes through Sayabot Cloud.
 */

export { checkServer, normalizeServerUrl, type ServerCheck }

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
