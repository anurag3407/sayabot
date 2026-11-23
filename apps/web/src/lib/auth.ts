import "server-only"
import { notFound, redirect } from "next/navigation"
import { cache } from "react"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import type {
  OrgAccess,
  OrgRole,
  OrgSummary,
  RoomAccess,
  RoomExecutionMode,
  RoomRole,
  RoomView,
} from "@/lib/types"

/**
 * The signed-in user, asked of Supabase once per request. Layouts, pages and actions all call
 * this; without the per-request cache every navigation paid for several auth round trips.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createSupabaseServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

export async function requireUser(nextPath?: string): Promise<User> {
  const user = await getCurrentUser()
  if (!user) {
    redirect(nextPath ? `/login?next=${encodeURIComponent(nextPath)}` : "/login")
  }
  return user
}

function displayNameOf(user: User): string {
  const meta = user.user_metadata ?? {}
  return (
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    user.email?.split("@")[0] ||
    "member"
  )
}

export async function getProfile(
  user: User,
  client?: SupabaseClient<any>,
): Promise<OrgAccess["user"]> {
  const supabase = client ?? (await createSupabaseServerClient())
  const { data } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, preferences")
    .eq("id", user.id)
    .maybeSingle()
  const preferences =
    (data?.preferences as {
      notifications?: "all" | "mentions" | "off"
      sound?: boolean
    } | null) ?? {}
  return {
    id: user.id,
    email: user.email ?? null,
    displayName: data?.display_name || displayNameOf(user),
    avatarUrl: data?.avatar_url ?? null,
    notifications: preferences.notifications ?? "mentions",
    sound: preferences.sound !== false,
    isGuest: user.is_anonymous === true,
  }
}

/** Used by the workspace layout and the profile page in the same request; asked once. */
export const listUserOrgs = cache((userId: string) => loadUserOrgs(userId))

async function loadUserOrgs(userId: string): Promise<OrgSummary[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase
    .from("org_members")
    .select("role, orgs!inner(id, slug, name, sso_enabled)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
  const rows = (data ?? []) as unknown as {
    role: OrgRole
    orgs: { id: string; slug: string; name: string; sso_enabled: boolean }
  }[]
  return rows.map((row) => ({
    id: row.orgs.id,
    slug: row.orgs.slug,
    name: row.orgs.name,
    role: row.role,
    ssoEnabled: row.orgs.sso_enabled,
  }))
}

/** The layout and the page both check access; one lookup per request serves both. */
const orgAccessForRequest = cache((slug: string) => loadOrgAccess(slug))

export async function getOrgAccess(
  slug: string,
  options?: { client?: SupabaseClient<any>; user?: User },
): Promise<OrgAccess | null> {
  return options ? loadOrgAccess(slug, options) : orgAccessForRequest(slug)
}

async function loadOrgAccess(
  slug: string,
  options?: { client?: SupabaseClient<any>; user?: User },
): Promise<OrgAccess | null> {
  const user = options?.user ?? (await getCurrentUser())
  if (!user) return null
  const supabase = options?.client ?? (await createSupabaseServerClient())
  const { data } = await supabase
    .from("org_members")
    .select("role, orgs!inner(id, slug, name, sso_enabled)")
    .eq("user_id", user.id)
    .eq("orgs.slug", slug)
    .maybeSingle()
  if (!data) return null
  const row = data as unknown as {
    role: OrgRole
    orgs: { id: string; slug: string; name: string; sso_enabled: boolean }
  }
  return {
    org: {
      id: row.orgs.id,
      slug: row.orgs.slug,
      name: row.orgs.name,
      ssoEnabled: row.orgs.sso_enabled,
    },
    role: row.role,
    user: await getProfile(user, supabase),
  }
}

export async function requireOrgAccess(slug: string): Promise<OrgAccess> {
  const access = await getOrgAccess(slug)
  if (!access) notFound()
  return access
}

export function isOrgAdmin(role: OrgRole): boolean {
  return role === "owner" || role === "admin"
}

/**
 * Gate for admin-only settings pages. Each page calls this itself: a layout check alone is
 * not enough, because layouts are not guaranteed to re-run for every page request.
 */
export async function requireOrgAdmin(slug: string): Promise<OrgAccess> {
  const access = await requireOrgAccess(slug)
  if (!isOrgAdmin(access.role)) redirect(`/${slug}/settings`)
  return access
}

const EXECUTION_MODES: RoomExecutionMode[] = ["review_all", "ask_risky", "auto", "turbo"]

function readExecutionMode(value: string | undefined): RoomExecutionMode {
  return EXECUTION_MODES.find((mode) => mode === value) ?? "ask_risky"
}

/** Request-scoped cache so generateMetadata, layout and page share the room lookup. */
const roomAccessForRequest = cache((slug: string, roomId: string) => loadRoomAccess(slug, roomId))

export async function getRoomAccess(
  slug: string,
  roomId: string,
  options?: { client?: SupabaseClient<any>; user?: User },
): Promise<RoomAccess | null> {
  return options ? loadRoomAccess(slug, roomId, options) : roomAccessForRequest(slug, roomId)
}

async function loadRoomAccess(
  slug: string,
  roomId: string,
  options?: { client?: SupabaseClient<any>; user?: User },
): Promise<RoomAccess | null> {
  const org = await getOrgAccess(slug, options)
  if (!org) return null
  const supabase = options?.client ?? (await createSupabaseServerClient())
  const { data: room } = await supabase
    .from("rooms")
    .select(
      "id, org_id, name, kind, turn_mode, system_directive, turn_cap, rpm_limit, daily_budget_usd, moderator_agent_id, debate_order, timezone, agent_dm_user_id, agent_dm_agent_id, created_at",
    )
    .eq("id", roomId)
    .eq("org_id", org.org.id)
    .maybeSingle()
  if (!room) return null
  // The execution mode is read on its own so a server ahead of its migration still opens rooms.
  const [{ data: membership }, { data: mode }] = await Promise.all([
    supabase
      .from("room_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("user_id", org.user.id)
      .maybeSingle(),
    supabase.from("rooms").select("execution_mode").eq("id", roomId).maybeSingle(),
  ])
  const roomRole = (membership?.role as RoomRole | undefined) ?? null
  const roomView: RoomView = {
    id: room.id,
    orgId: room.org_id,
    name: room.name,
    kind: room.kind,
    turnMode: room.turn_mode,
    systemDirective: room.system_directive,
    turnCap: room.turn_cap,
    rpmLimit: room.rpm_limit,
    dailyBudgetUsd: room.daily_budget_usd === null ? null : Number(room.daily_budget_usd),
    moderatorAgentId: room.moderator_agent_id,
    debateOrder: room.debate_order ?? [],
    timezone: room.timezone ?? "UTC",
    agentDmUserId: room.agent_dm_user_id ?? null,
    agentDmAgentId: room.agent_dm_agent_id ?? null,
    executionMode: readExecutionMode((mode as { execution_mode?: string } | null)?.execution_mode),
    createdAt: room.created_at,
  }
  return {
    org: org.org,
    orgRole: org.role,
    user: org.user,
    room: roomView,
    roomRole,
    canAdmin: roomRole === "admin" || isOrgAdmin(org.role),
  }
}

export async function requireRoomAccess(slug: string, roomId: string): Promise<RoomAccess> {
  const access = await getRoomAccess(slug, roomId)
  if (!access) notFound()
  return access
}
