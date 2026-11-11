/** Remote desktop rules shared by the web routes (who may connect) and tests. */

export type WhoCanControl = "only_me" | "admins" | "members"

export const HOST_ONLINE_WINDOW_MS = 30_000

export function hostOnline(lastSeenAt: string | Date | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false
  return now - new Date(lastSeenAt).getTime() < HOST_ONLINE_WINDOW_MS
}

/**
 * The owner can always open their own computer. Anyone else needs the host shared with a
 * workspace (orgId) and a role that the "who can control" setting allows.
 */
export function canOpenHost(input: {
  ownerId: string
  viewerId: string
  hostOrgId: string | null
  whoCanControl: WhoCanControl | undefined
  viewerOrgRole: "owner" | "admin" | "member" | null
}): boolean {
  if (input.viewerId === input.ownerId) return true
  if (!input.hostOrgId || !input.viewerOrgRole) return false
  const rule = input.whoCanControl ?? "only_me"
  if (rule === "members") return true
  if (rule === "admins") return input.viewerOrgRole === "owner" || input.viewerOrgRole === "admin"
  return false
}

export type RemoteInput =
  | { t: "move"; x: number; y: number }
  | { t: "down" | "up"; x: number; y: number; b: 0 | 2 }
  | { t: "scroll"; dy: number; dx: number }
  | { t: "key"; key: string; mods: string[] }
  | { t: "text"; s: string }

const MODS = new Set(["cmd", "ctrl", "alt", "shift"])
const clamp01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : null)

/** Validates one input event from the viewer. Coordinates are 0..1 of the shared screen. */
export function parseRemoteInput(raw: unknown): RemoteInput | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  switch (e.t) {
    case "move": {
      const x = clamp01(e.x)
      const y = clamp01(e.y)
      return x === null || y === null ? null : { t: "move", x, y }
    }
    case "down":
    case "up": {
      const x = clamp01(e.x)
      const y = clamp01(e.y)
      if (x === null || y === null) return null
      return { t: e.t, x, y, b: e.b === 2 ? 2 : 0 }
    }
    case "scroll": {
      const dy = typeof e.dy === "number" && Number.isFinite(e.dy) ? Math.max(-50, Math.min(50, Math.round(e.dy))) : 0
      const dx = typeof e.dx === "number" && Number.isFinite(e.dx) ? Math.max(-50, Math.min(50, Math.round(e.dx))) : 0
      return dy || dx ? { t: "scroll", dy, dx } : null
    }
    case "key": {
      if (typeof e.key !== "string" || !e.key || e.key.length > 20) return null
      const mods = Array.isArray(e.mods) ? e.mods.filter((m): m is string => typeof m === "string" && MODS.has(m)) : []
      return { t: "key", key: e.key, mods }
    }
    case "text":
      return typeof e.s === "string" && e.s.length > 0 && e.s.length <= 500 ? { t: "text", s: e.s } : null
    default:
      return null
  }
}
