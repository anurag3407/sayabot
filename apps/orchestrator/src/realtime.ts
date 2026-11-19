import type { RoomEvent } from "@sayabot/core"
import { getEnv } from "./env"

/**
 * Sends Realtime broadcast messages over the HTTP API. Broadcasting through
 * REST keeps the orchestrator stateless and avoids one websocket per room.
 */
export async function broadcast(roomId: string, event: RoomEvent): Promise<void> {
  const env = getEnv()
  const base = env.SUPABASE_URL.replace(/\/+$/, "")
  try {
    const response = await fetch(`${base}/realtime/v1/api/broadcast`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `room:${roomId}`,
            event: event.type,
            payload: event,
            private: true,
          },
        ],
      }),
    })
    if (!response.ok) {
      const body = await response.text().catch(() => "")
      console.error(
        `[realtime] broadcast ${event.type} failed: ${response.status} ${body.slice(0, 300)}`,
      )
    }
  } catch (error) {
    console.error(`[realtime] broadcast ${event.type} failed`, error)
  }
}
