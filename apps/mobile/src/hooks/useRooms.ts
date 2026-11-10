import { useEffect, useState, useCallback } from "react"
import { supabase } from "../core/supabase"
import type { Room, RoomKind, TurnMode } from "../types"

export function useRooms() {
  const [rooms, setRooms] = useState<Room[]>([])
  const [orgSlug, setOrgSlug] = useState<string>("default")
  const [orgId, setOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchRooms = useCallback(async () => {
    setLoading(true)
    try {
      // 1. Fetch current org
      const { data: orgData } = await supabase
        .from("orgs")
        .select("id, slug")
        .limit(1)
        .maybeSingle()
        
      if (!orgData) return
      setOrgSlug(orgData.slug)
      setOrgId(orgData.id)

      // 2. Fetch rooms
      const { data: roomData, error } = await supabase
        .from("rooms")
        .select("id, org_id, name, kind, turn_mode, system_directive, timezone")
        .eq("org_id", orgData.id)
        .order("kind", { ascending: true })
        .order("name", { ascending: true })

      if (error) throw error

      if (roomData) {
        setRooms(
          roomData.map((r: any) => ({
            id: r.id,
            orgId: r.org_id,
            name: r.name,
            kind: r.kind,
            turnMode: r.turn_mode,
            systemDirective: r.system_directive,
            timezone: r.timezone || "UTC",
          }))
        )
      }
    } catch (err) {
      console.error("[useRooms] fetch error:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  const createRoom = useCallback(
    async (params: {
      name: string
      kind: RoomKind
      turnMode: TurnMode
      systemDirective?: string
    }): Promise<Room> => {
      let targetOrgId = orgId
      if (!targetOrgId) {
        const { data: orgData } = await supabase
          .from("orgs")
          .select("id")
          .limit(1)
          .maybeSingle()
        if (orgData) targetOrgId = orgData.id
      }

      if (!targetOrgId) {
        throw new Error("No active organization found to create room in.")
      }

      const cleanName = params.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "-")

      const { data, error } = await supabase
        .from("rooms")
        .insert({
          org_id: targetOrgId,
          name: cleanName,
          kind: params.kind,
          turn_mode: params.turnMode,
          system_directive: params.systemDirective?.trim() || null,
          timezone: "UTC",
        })
        .select()
        .single()

      if (error) throw error

      const newRoom: Room = {
        id: data.id,
        orgId: data.org_id,
        name: data.name,
        kind: data.kind,
        turnMode: data.turn_mode,
        systemDirective: data.system_directive,
        timezone: data.timezone || "UTC",
      }

      setRooms((prev) => [newRoom, ...prev])
      return newRoom
    },
    [orgId]
  )

  useEffect(() => {
    fetchRooms()

    // Realtime channel to refresh room list on room creations/updates
    const channel = supabase
      .channel("rooms:list")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () => {
        fetchRooms()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchRooms])

  return { rooms, orgSlug, loading, refresh: fetchRooms, createRoom }
}
