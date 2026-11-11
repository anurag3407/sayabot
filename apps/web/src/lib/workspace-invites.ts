import "server-only"
import { getAppUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

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
    .select("id, kind, code, email, user_id, role, room_ids, max_uses, use_count, expires_at, created_at")
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
