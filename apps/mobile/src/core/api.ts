import { manipulateAsync, SaveFormat } from "expo-image-manipulator"
import { currentWebApiUrl } from "./settings"
import { onSupabaseClient, supabase } from "./supabase"

/**
 * Talking to the Sayabot web API as the signed-in person, plus a cached access token for things
 * that need it synchronously (loading protected images).
 */

let cachedToken: string | null = null
onSupabaseClient(() => {
  void supabase.auth.getSession().then(({ data }) => (cachedToken = data.session?.access_token ?? null))
  supabase.auth.onAuthStateChange((_event, session) => (cachedToken = session?.access_token ?? null))
})

export function accessTokenNow(): string | null {
  return cachedToken
}

export async function authHeaders(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error("Please sign in again.")
  cachedToken = session.access_token
  return { Authorization: `Bearer ${session.access_token}` }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${currentWebApiUrl()}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { ...(await authHeaders()), ...(init.body ? { "Content-Type": "application/json" } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error((json as { error?: string }).error || `HTTP ${res.status}`)
  return json
}

/** Our own protected file links need the bearer token; anything else loads as-is. */
export function isSayabotFile(url: string): boolean {
  return url.startsWith(`${currentWebApiUrl()}/api/files/`)
}

export interface Picked {
  uri: string
  name: string
  type: string
  size?: number | null
  isImage: boolean
}

/** Photos are resized (longest side 1600px) and re-encoded so they send quickly on mobile data. */
export async function prepareForUpload(file: Picked): Promise<Picked> {
  if (!file.isImage || file.type === "image/gif") return file
  try {
    const out = await manipulateAsync(file.uri, [{ resize: { width: 1600 } }], { compress: 0.72, format: SaveFormat.JPEG })
    return { ...file, uri: out.uri, type: "image/jpeg", name: file.name.replace(/\.(heic|heif|png|webp|jpe?g)$/i, "") + ".jpg" }
  } catch {
    return file
  }
}

export async function uploadToRoom(roomId: string, file: Picked): Promise<{ url: string; name: string; type: string }> {
  const ready = await prepareForUpload(file)
  const form = new FormData()
  form.append("roomId", roomId)
  form.append("file", { uri: ready.uri, name: ready.name, type: ready.type } as unknown as Blob)
  const res = await fetch(`${currentWebApiUrl()}/api/mobile/upload`, { method: "POST", headers: await authHeaders(), body: form })
  const json = (await res.json().catch(() => ({}))) as { url?: string; name?: string; type?: string; error?: string }
  if (!res.ok || !json.url) throw new Error(json.error || `Upload failed (HTTP ${res.status})`)
  return { url: json.url, name: json.name ?? ready.name, type: json.type ?? ready.type }
}

/** Markdown that the web app and the phone both render: images inline, other files as links. */
export function attachmentMarkdown(a: { url: string; name: string; type: string }): string {
  const label = a.name.replace(/[[\]]/g, "")
  return a.type.startsWith("image/") ? `![${label}](${a.url})` : `[📎 ${label}](${a.url})`
}

/** Opens a web page signed in as this person (the session is handed over in the URL fragment). */
export async function signedInWebUrl(path: string): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const base = currentWebApiUrl()
  if (!session) return `${base}${path}`
  return `${base}/auth/complete?next=${encodeURIComponent(path)}#access_token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}`
}
