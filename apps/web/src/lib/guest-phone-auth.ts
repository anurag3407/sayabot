import { Pool } from "pg"

export function syntheticGuestEmail(userId: string): string {
  const id = userId.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
  return `guest-${id || "user"}@example.com`
}

interface AuthUser {
  id: string
  email?: string | null
  is_anonymous?: boolean
}

export interface PairingAuthAdmin {
  getUserById(
    id: string,
  ): Promise<{ data: { user: AuthUser | null }; error: { message: string } | null }>
  updateUserById(
    id: string,
    attrs: { email: string; email_confirm: boolean },
  ): Promise<{ data: { user: AuthUser | null }; error: { message: string } | null }>
  generateLink(args: {
    type: "magiclink"
    email: string
  }): Promise<{
    data: { properties?: { hashed_token?: string } } | null
    error: { message: string } | null
  }>
}

export type MagicLinkResult =
  | { ok: true; email: string; tokenHash: string; wasAnonymous: boolean }
  | { ok: false; error: string }

/**
 * A one-time Supabase magic link for the person who showed the code.
 * Guests have no email; a confirmed synthetic address lets the phone redeem the same user id.
 */
export async function magicLinkForPairing(
  admin: PairingAuthAdmin,
  userId: string,
): Promise<MagicLinkResult> {
  const loaded = await admin.getUserById(userId)
  const user = loaded.data.user
  if (loaded.error || !user) {
    return { ok: false, error: "Could not sign this phone in. Try a new code." }
  }
  const wasAnonymous = user.is_anonymous === true
  let email = user.email?.trim() ?? ""
  if (!email) {
    email = syntheticGuestEmail(userId)
    const updated = await admin.updateUserById(userId, { email, email_confirm: true })
    if (updated.error || !updated.data.user?.email) {
      console.warn(
        "[phone-pair] could not give the guest an email",
        updated.error?.message ?? "no email on the updated user",
      )
      return { ok: false, error: "Could not sign this phone in. Try a new code." }
    }
    email = updated.data.user.email
  }
  const link = await admin.generateLink({ type: "magiclink", email })
  const tokenHash = link.data?.properties?.hashed_token
  if (link.error || !tokenHash) {
    console.warn("[phone-pair] could not mint a sign-in link", link.error?.message ?? "no token")
    return { ok: false, error: "Could not sign this phone in. Try a new code." }
  }
  return { ok: true, email, tokenHash, wasAnonymous }
}

/**
 * Setting an email can clear Supabase's anonymous flag. Put it back so this is still a guest
 * and can later be saved into a real account. Pairing has already succeeded if this fails.
 */
export async function restoreGuestAnonymous(userId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl || dbUrl === "local" || !/^postgres(ql)?:\/\//.test(dbUrl)) return
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(dbUrl)
  const pool = new Pool({
    connectionString: dbUrl,
    max: 1,
    connectionTimeoutMillis: 4_000,
    ssl: local ? undefined : { rejectUnauthorized: false },
  })
  try {
    await pool.query("update auth.users set is_anonymous = true where id = $1", [userId])
  } catch (err) {
    console.warn(
      "[phone-pair] could not keep the guest flag",
      err instanceof Error ? err.message : err,
    )
  } finally {
    await pool.end()
  }
}
