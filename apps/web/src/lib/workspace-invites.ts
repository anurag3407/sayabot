import "server-only"
import { checkJoinCode } from "@/lib/actions/workspace-invites"
import { getAppUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

export type JoinPageState =
  | { ok: false; reason: string }
  | {
      ok: true
      orgSlug: string
      orgName: string
      role: string
      roomCount: number
      inviterName: string | null
      alreadyMember: boolean
      /** none = they have not asked; declined = an admin said no and they may ask again. */
      request: "none" | "pending" | "declined"
      heldBySomeoneElse: boolean
    }

/**
 * What the join page should show. A member is sent in. A single-use link that another
 * person is already waiting on does not offer a second ask. Not a server action: the
 * page passes the signed-in user, and a browser cannot call this with someone else's id.
 */
export async function describeJoin(code: string, userId: string): Promise<JoinPageState> {
  const admin = createAdminClient()
  if (/^j_[A-Za-z0-9_-]{16,64}$/.test(code)) {
    const { data: invite } = await admin
      .from("workspace_invites")
      .select("org_id, role, room_ids")
      .eq("code", code)
      .maybeSingle()
    if (invite) {
      const { data: member } = await admin
        .from("org_members")
        .select("user_id")
        .eq("org_id", invite.org_id)
        .eq("user_id", userId)
        .maybeSingle()
      if (member) {
        const { data: org } = await admin
          .from("orgs")
          .select("slug, name")
          .eq("id", invite.org_id)
          .maybeSingle()
        if (org) {
          return {
            ok: true,
            orgSlug: org.slug,
            orgName: org.name,
            role: invite.role,
            roomCount: invite.room_ids?.length ?? 0,
            inviterName: null,
            alreadyMember: true,
            request: "none",
            heldBySomeoneElse: false,
          }
        }
      }
    }
  }
  const check = await checkJoinCode(code)
  if (!check.ok) return check

  const { data: invite } = await admin
    .from("workspace_invites")
    .select("max_uses")
    .eq("id", check.inviteId)
    .maybeSingle()
  const { data: rows } = await admin
    .from("workspace_join_requests")
    .select("user_id, status")
    .eq("invite_id", check.inviteId)
  const mine = (rows ?? []).find((row) => row.user_id === userId)
  const heldBySomeoneElse = Boolean(
    invite?.max_uses !== null &&
    invite?.max_uses !== undefined &&
    (rows ?? []).some(
      (row) => row.user_id !== userId && (row.status === "pending" || row.status === "approved"),
    ),
  )
  const request =
    mine?.status === "pending" || mine?.status === "declined" ? mine.status : ("none" as const)
  return {
    ok: true,
    orgSlug: check.orgSlug,
    orgName: check.orgName,
    role: check.role,
    roomCount: check.roomIds.length,
    inviterName: check.inviterName,
    alreadyMember: false,
    request,
    heldBySomeoneElse,
  }
}

export interface JoinRequestView {
  id: string
  name: string
  email: string | null
  role: string
  roomCount: number
  createdAt: string
}

/** People who opened a link and are waiting for a workspace admin. */
export async function loadJoinRequests(orgId: string): Promise<JoinRequestView[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("workspace_join_requests")
    .select("id, user_id, role, room_ids, created_at")
    .eq("org_id", orgId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50)
  if (error || !data?.length) return []
  const rows = data as {
    id: string
    user_id: string
    role: string
    room_ids: string[] | null
    created_at: string
  }[]
  const userIds = rows.map((row) => row.user_id)
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", userIds)
  const names = new Map(
    ((profiles ?? []) as { id: string; display_name: string }[]).map((profile) => [
      profile.id,
      profile.display_name,
    ]),
  )
  const emails = new Map<string, string | null>()
  await Promise.all(
    userIds.map(async (userId) => {
      const { data: userRes } = await admin.auth.admin.getUserById(userId)
      emails.set(userId, userRes?.user?.email ?? null)
    }),
  )
  return rows.map((row) => ({
    id: row.id,
    name: names.get(row.user_id)?.trim() || "Someone",
    email: emails.get(row.user_id) ?? null,
    role: row.role,
    roomCount: row.room_ids?.length ?? 0,
    createdAt: row.created_at,
  }))
}

export interface PendingInviteView {
  id: string
  kind: "email" | "link" | "permanent"
  label: string
  role: string
  url: string | null
  expiresAt: string | null
  uses: number
  roomCount: number
  createdAt: string
}

/**
 * What's still open: email invites the person hasn't used to sign in yet, single-use links
 * not used or expired, and permanent links that are still on.
 */
export async function loadPendingInvites(orgId: string): Promise<PendingInviteView[]> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("workspace_invites")
    .select(
      "id, kind, code, email, user_id, role, room_ids, max_uses, use_count, expires_at, created_at",
    )
    .eq("org_id", orgId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(100)
  if (error) return []
  const base = getAppUrl().replace(/\/+$/, "")
  const now = Date.now()
  const out: PendingInviteView[] = []
  for (const row of (data ?? []) as {
    id: string
    kind: "email" | "link" | "permanent"
    code: string | null
    email: string | null
    user_id: string | null
    role: string
    room_ids: string[] | null
    max_uses: number | null
    use_count: number
    expires_at: string | null
    created_at: string
  }[]) {
    if (row.kind === "email") {
      if (!row.user_id) continue
      const { data: userRes } = await admin.auth.admin.getUserById(row.user_id)
      if (!userRes?.user || userRes.user.last_sign_in_at) continue
    } else {
      if (row.expires_at && new Date(row.expires_at).getTime() < now) continue
      if (row.max_uses !== null && row.use_count >= row.max_uses) continue
    }
    out.push({
      id: row.id,
      kind: row.kind,
      label:
        row.kind === "email"
          ? (row.email ?? "Email invitation")
          : row.kind === "link"
            ? "Single-use invitation link"
            : "Permanent invitation link",
      role: row.role,
      url: row.code ? `${base}/join/${row.code}` : null,
      expiresAt: row.expires_at,
      uses: row.use_count,
      roomCount: row.room_ids?.length ?? 0,
      createdAt: row.created_at,
    })
  }
  return out
}
