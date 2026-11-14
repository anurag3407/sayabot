import "server-only"
import { createHash, randomBytes } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Guest → real account merge (desktop guest mode).
 *
 * 1. The guest asks for a ticket (POST /api/account/merge). Only a hash is stored.
 * 2. /auth/merge puts the raw ticket in an httpOnly cookie and sends them to sign in.
 * 3. /auth/merge/finish shows what will move; on confirm, everything the guest owned moves to
 *    the signed-in account (`merge_guest_into_user`, sql/0031) and the guest user is deleted.
 */

export const MERGE_COOKIE = "sayabot_guest_merge"
export const MERGE_TTL_SECONDS = 30 * 60

export function hashTicket(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function createMergeTicket(guestUserId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url")
  const admin = createAdminClient()
  const { error } = await admin.from("account_merge_tickets").insert({
    token_hash: hashTicket(token),
    guest_user_id: guestUserId,
    expires_at: new Date(Date.now() + MERGE_TTL_SECONDS * 1000).toISOString(),
  })
  if (error) throw new Error(`could not create merge ticket: ${error.message}`)
  return token
}

export interface MergeTicket {
  id: string
  guestUserId: string
}

/** A ticket that can still be used (not used, not expired), or null. */
export async function findMergeTicket(
  token: string | undefined | null,
): Promise<MergeTicket | null> {
  if (!token || token.length > 200) return null
  const admin = createAdminClient()
  const { data } = await admin
    .from("account_merge_tickets")
    .select("id, guest_user_id")
    .eq("token_hash", hashTicket(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle()
  return data ? { id: data.id as string, guestUserId: data.guest_user_id as string } : null
}

export interface GuestSummary {
  workspaces: { slug: string; name: string }[]
  computers: string[]
}

/** What the person will see moving into their account before they confirm. */
export async function summarizeGuest(guestUserId: string): Promise<GuestSummary> {
  const admin = createAdminClient()
  const [{ data: members }, { data: hosts }] = await Promise.all([
    admin.from("org_members").select("orgs!inner(slug, name)").eq("user_id", guestUserId),
    admin.from("desktop_hosts").select("name").eq("user_id", guestUserId),
  ])
  const rows = (members ?? []) as unknown as { orgs: { slug: string; name: string } }[]
  return {
    workspaces: rows.map((row) => ({ slug: row.orgs.slug, name: row.orgs.name })),
    computers: ((hosts ?? []) as { name: string }[]).map((host) => host.name),
  }
}

export type MergeOutcome =
  | { ok: true; guestUserId: string; firstWorkspaceSlug: string | null }
  | { ok: false; error: string }

/**
 * Moves the guest's data to `targetUserId`. The ticket is claimed first (so two tabs can't both
 * run it) and released again if the move fails, so the person can retry.
 */
export async function completeGuestMerge(
  token: string,
  targetUserId: string,
): Promise<MergeOutcome> {
  const admin = createAdminClient()
  const { data: claimed } = await admin
    .from("account_merge_tickets")
    .update({ used_at: new Date().toISOString(), target_user_id: targetUserId })
    .eq("token_hash", hashTicket(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id, guest_user_id")
    .maybeSingle()
  if (!claimed) return { ok: false, error: "This guest link has expired or was already used." }

  // The SQL function re-checks guest/target (anonymous vs full, not the same user).
  const guestUserId = claimed.guest_user_id as string
  const summary = await summarizeGuest(guestUserId)
  const { data: result, error } = await admin.rpc("merge_guest_into_user", {
    p_guest: guestUserId,
    p_target: targetUserId,
  })
  if (error) {
    await admin
      .from("account_merge_tickets")
      .update({ used_at: null, target_user_id: null })
      .eq("id", claimed.id)
    console.error("[guest-merge] merge failed", { guestUserId, targetUserId, error: error.message })
    return { ok: false, error: "We couldn't move your guest data. Nothing was changed. Try again." }
  }
  console.log("[guest-merge] merged guest into account", { guestUserId, targetUserId, result })

  // Everything useful has moved; the empty guest login is no longer needed.
  const { error: deleteError } = await admin.auth.admin.deleteUser(guestUserId)
  if (deleteError) {
    console.warn(
      "[guest-merge] could not delete merged guest user",
      guestUserId,
      deleteError.message,
    )
  }

  return { ok: true, guestUserId, firstWorkspaceSlug: summary.workspaces[0]?.slug ?? null }
}
