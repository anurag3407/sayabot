import { useEffect, useState } from "react"
import { supabase } from "../core/supabase"

export interface RoomAgent {
  id: string
  handle: string
  displayName: string
  kind: "llm" | "external"
}

/** Agents in a room, for "who should do it?" when delegating from the phone. */
export function useRoomAgents(roomId: string | null) {
  const [agents, setAgents] = useState<RoomAgent[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!roomId) {
      setAgents([])
      return
    }
    let cancelled = false
    setLoading(true)
    void (async () => {
      const { data } = await supabase
        .from("room_agents")
        .select("agents!inner(id, handle, display_name, kind)")
        .eq("room_id", roomId)
        .order("position")
      if (cancelled) return
      const rows = (data ?? []) as unknown as {
        agents: { id: string; handle: string; display_name: string; kind: "llm" | "external" }
      }[]
      setAgents(
        rows.map((row) => ({
          id: row.agents.id,
          handle: row.agents.handle,
          displayName: row.agents.display_name,
          kind: row.agents.kind,
        })),
      )
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [roomId])

  return { agents, loading }
}
