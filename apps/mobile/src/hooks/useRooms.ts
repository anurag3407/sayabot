import { useCallback, useEffect, useState } from "react"
import { supabase } from "../core/supabase"
import { roomNameSlug } from "../core/workspace-draft"
import type { Room, RoomKind, TurnMode } from "../types"

interface OrgChoice {
  id: string
  slug: string
  name: string
}

export function useRooms(preferredSlug?: string) {
  const [rooms, setRooms] = useState<Room[]>([])
  const [orgSlug, setOrgSlug] = useState<string>(preferredSlug || "default")
  const [orgId, setOrgId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const fetchRooms = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotice(null)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) {
        setRooms([])
        setOrgId(null)
        setError("Sign in to load your rooms.")
        return
      }

      const { data: memberships, error: memberError } = await supabase
        .from("org_members")
        .select("org_id")
        .eq("user_id", user.id)
      if (memberError) throw memberError
      const orgIds = (memberships ?? []).map((row) => row.org_id).filter(Boolean)
      if (orgIds.length === 0) {
        setRooms([])
        setOrgId(null)
        setError("This account is not in a workspace yet.")
        return
      }

      const { data: orgRows, error: orgError } = await supabase
        .from("orgs")
        .select("id, slug, name")
        .in("id", orgIds)
      if (orgError) throw orgError
      const orgs = (orgRows ?? []) as OrgChoice[]
      const chosen =
        (preferredSlug ? orgs.find((org) => org.slug === preferredSlug) : null) ?? orgs[0]
      if (!chosen) {
        setRooms([])
        setOrgId(null)
        setError("This account is not in a workspace yet.")
        return
      }
      if (preferredSlug && chosen.slug !== preferredSlug && orgs.length > 1) {
        setNotice(`No workspace named @${preferredSlug}. Showing @${chosen.slug}.`)
      }

      setOrgSlug(chosen.slug)
      setOrgId(chosen.id)

      const { data: roomData, error: roomError } = await supabase
        .from("rooms")
        .select("id, org_id, name, kind, turn_mode, system_directive, timezone")
        .eq("org_id", chosen.id)
        .order("kind", { ascending: true })
        .order("name", { ascending: true })
      if (roomError) throw roomError

      setRooms(
        (roomData ?? []).map((room) => ({
          id: room.id,
          orgId: room.org_id,
          name: room.name,
          kind: room.kind,
          turnMode: room.turn_mode,
          systemDirective: room.system_directive,
          timezone: room.timezone || "UTC",
        })),
      )
    } catch (err) {
      console.error("[useRooms] fetch error:", err)
      setRooms([])
      setError(err instanceof Error ? err.message : "Could not load rooms.")
    } finally {
      setLoading(false)
    }
  }, [preferredSlug])

  const createRoom = useCallback(
    async (params: {
      name: string
      kind: RoomKind
      turnMode: TurnMode
      systemDirective?: string
    }): Promise<Room> => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Sign in to create a room.")

      const targetOrgId = orgId
      if (!targetOrgId) {
        throw new Error("No workspace is available for this account.")
      }

      const cleanName = roomNameSlug(params.name)
      if (!cleanName) throw new Error("Use letters or numbers in the room name.")

      const { data, error: insertError } = await supabase
        .from("rooms")
        .insert({
          org_id: targetOrgId,
          name: cleanName,
          kind: params.kind,
          turn_mode: params.turnMode,
          system_directive: params.systemDirective?.trim() || null,
          timezone: "UTC",
          created_by: user.id,
        })
        .select()
        .single()

      if (insertError) throw insertError

      const { error: memberError } = await supabase.from("room_members").insert({
        room_id: data.id,
        user_id: user.id,
        role: "admin",
      })
      if (memberError) {
        await supabase.from("rooms").delete().eq("id", data.id)
        throw new Error("The room was created, then removed because you could not be added to it.")
      }

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
    [orgId],
  )

  useEffect(() => {
    void fetchRooms()

    const channel = supabase
      .channel("rooms:list")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, () => {
        void fetchRooms()
      })
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [fetchRooms])

  return { rooms, orgSlug, orgId, loading, error, notice, refresh: fetchRooms, createRoom }
}
