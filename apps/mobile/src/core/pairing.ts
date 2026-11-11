import { Platform } from "react-native"
import { ENV } from "../config/env"
import { cleanPairCode, supabaseMismatch } from "./pair-link"
import { currentWebApiUrl, loadSettings, saveSettings } from "./settings"
import { supabase } from "./supabase"

function deviceLabel(): string {
  const constants = Platform.constants as { Model?: string; Brand?: string; Manufacturer?: string } | undefined
  if (Platform.OS === "android") {
    const brand = constants?.Brand || constants?.Manufacturer || ""
    const model = constants?.Model || "Android phone"
    return `${brand && !model.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ` : ""}${model}`.trim()
  }
  return Platform.OS === "ios" ? "iPhone" : "Phone"
}

/**
 * Signs this phone in with a one-time code from "Add a phone" on a computer. The server
 * answers with a single-use token hash that Supabase redeems for a session here.
 */
// Several screens mount useAuth; a scanned link must still pair once, not once per listener.
const inflight = new Map<string, Promise<void>>()

export function pairWithCode(rawCode: string, serverUrl?: string | null): Promise<void> {
  const code = cleanPairCode(rawCode)
  const existing = inflight.get(code)
  if (existing) return existing
  const run = pairOnce(code, serverUrl).finally(() => inflight.delete(code))
  inflight.set(code, run)
  return run
}

async function pairOnce(code: string, serverUrl?: string | null): Promise<void> {
  if (code.length !== 8) throw new Error("Codes have 8 letters and numbers. Check the one on your computer.")
  const server = (serverUrl || currentWebApiUrl()).replace(/\/+$/, "")
  const res = await fetch(`${server}/api/mobile/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName: deviceLabel(), platform: Platform.OS === "ios" ? "iOS" : "Android" }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    error?: string
    token_hash?: string
    org_slug?: string | null
    device_id?: string
    device_token?: string
    supabase_url?: string
  }
  if (!res.ok || !data.token_hash) throw new Error(data.error || `Could not sign in (HTTP ${res.status})`)
  if (supabaseMismatch(ENV.SUPABASE_URL, data.supabase_url)) {
    throw new Error("This copy of the app is set up for a different Sayabot server. Install the app from that server's download page.")
  }
  const { error } = await supabase.auth.verifyOtp({ token_hash: data.token_hash, type: "magiclink" })
  if (error) throw new Error(error.message)
  await saveSettings({
    webApiUrl: server,
    ...(data.org_slug ? { orgSlug: data.org_slug } : {}),
    deviceId: data.device_id ?? "",
    deviceToken: data.device_token ?? "",
  })
}

/** Asks the server whether this phone was removed. Network failures never sign anyone out. */
export async function phoneWasRemoved(): Promise<boolean> {
  const settings = await loadSettings()
  if (!settings.deviceId || !settings.deviceToken) return false
  try {
    const res = await fetch(`${currentWebApiUrl()}/api/mobile/device`, {
      headers: { "x-device-id": settings.deviceId, "x-device-token": settings.deviceToken },
    })
    if (!res.ok) return false
    const data = (await res.json()) as { status?: string }
    return data.status === "revoked"
  } catch {
    return false
  }
}

export async function forgetPairing(): Promise<void> {
  await saveSettings({ deviceId: "", deviceToken: "" })
}
