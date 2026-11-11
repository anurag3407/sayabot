import { supabase } from "./supabase"
import { currentWebApiUrl } from "./settings"

/** Posts as the signed-in person, through the web API so agents are woken like any chat message. */
export async function postRoomMessage(orgSlug: string, roomId: string, content: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error("Sign in to send a message.")
  const res = await fetch(`${currentWebApiUrl()}/api/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ orgSlug, roomId, content }),
  })
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(err.error || `HTTP ${res.status}`)
  }
}
