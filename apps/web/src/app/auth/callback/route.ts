import { NextResponse } from "next/server"
import type { EmailOtpType, SupabaseClient, User } from "@supabase/supabase-js"
import { Pool } from "pg"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listUserOrgs } from "@/lib/auth"
import { safeNextPath } from "@/lib/safe-next"

const EMAIL_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
])

async function syncUserProfile(user: User) {
  try {
    const admin = createAdminClient()
    const meta = (user.user_metadata ?? {}) as Record<string, any>
    const displayName =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      (typeof meta.user_name === "string" && meta.user_name.trim()) ||
      user.email?.split("@")[0] ||
      "member"
    const avatarUrl =
      (typeof meta.avatar_url === "string" && meta.avatar_url.trim()) ||
      (typeof meta.picture === "string" && meta.picture.trim()) ||
      null

    const { data: existing } = await admin
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", user.id)
      .maybeSingle()

    if (!existing) {
      await admin.from("profiles").insert({
        id: user.id,
        display_name: displayName,
        avatar_url: avatarUrl,
      })
    } else {
      const updates: { display_name?: string; avatar_url?: string } = {}
      if ((!existing.display_name || existing.display_name === "member") && displayName !== "member") {
        updates.display_name = displayName
      }
      if (!existing.avatar_url && avatarUrl) {
        updates.avatar_url = avatarUrl
      }
      if (Object.keys(updates).length > 0) {
        await admin.from("profiles").update(updates).eq("id", user.id)
      }
    }
  } catch (err) {
    console.error("[auth] Failed to sync user profile:", err)
  }
}

async function recoverSessionFromCode(
  code: string,
  supabase: SupabaseClient<any>,
): Promise<User | null> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) return null

  let pool: Pool | null = null
  try {
    pool = new Pool({
      connectionString: dbUrl,
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    })

    const res = await pool.query(
      `SELECT user_id, auth_code_issued_at, authentication_method 
       FROM auth.flow_state 
       WHERE auth_code = $1 
       LIMIT 1`,
      [code],
    )

    if (res.rows.length === 0) {
      console.warn("[auth] No flow state found for code in recovery")
      return null
    }

    const flow = res.rows[0]
    const issuedAt = flow.auth_code_issued_at ? new Date(flow.auth_code_issued_at).getTime() : 0
    const now = Date.now()
    // Allow up to 24 hours after issuance (standard Supabase token lifetime)
    if (now - issuedAt > 24 * 60 * 60 * 1000) {
      console.warn("[auth] Auth code expired for recovery:", code)
      return null
    }

    const admin = createAdminClient()
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(flow.user_id)
    if (userError || !userData?.user?.email) {
      console.warn("[auth] User not found for recovery:", flow.user_id, userError?.message)
      return null
    }

    const targetUser = userData.user

    // Ensure email is marked confirmed if it was an email verification flow
    if (!targetUser.email_confirmed_at) {
      await admin.auth.admin.updateUserById(targetUser.id, {
        email_confirm: true,
      })
    }

    // Generate single-use magiclink verification token hash to establish session cookies on server client
    const link = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: targetUser.email!,
    })

    const tokenHash = link.data?.properties?.hashed_token
    if (!tokenHash) {
      console.warn("[auth] Failed to generate recovery token hash")
      return null
    }

    const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "magiclink",
    })

    if (verifyError || !sessionData.user) {
      console.warn("[auth] Failed to verify OTP with recovery token hash:", verifyError?.message)
      return null
    }

    // Clean up used flow_state record to prevent replay
    await pool.query(`DELETE FROM auth.flow_state WHERE auth_code = $1`, [code]).catch(() => {})

    return sessionData.user
  } catch (err) {
    console.error("[auth] Error during code session recovery:", err)
    return null
  } finally {
    if (pool) {
      await pool.end().catch(() => {})
    }
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code")
  const tokenHash = url.searchParams.get("token_hash")
  const type = url.searchParams.get("type") as EmailOtpType | null
  const requestedNext = url.searchParams.get("next")
  const errorDescription = url.searchParams.get("error_description") || url.searchParams.get("error")

  // Determine origin safely for redirects behind proxies/tunnels
  const forwardedHost = request.headers.get("x-forwarded-host")
  const forwardedProto = request.headers.get("x-forwarded-proto") || (url.protocol.replace(":", "") || "http")
  const origin = forwardedHost
    ? `${forwardedProto}://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_SITE_URL || url.origin)

  if (errorDescription) {
    console.error("[auth] OAuth provider returned error:", errorDescription)
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(errorDescription)}`, origin),
    )
  }

  const supabase = await createSupabaseServerClient()

  async function resolveRedirectPath(user: User | null): Promise<string> {
    if (requestedNext && requestedNext !== "/") {
      return safeNextPath(requestedNext)
    }
    if (user) {
      try {
        const orgs = await listUserOrgs(user.id)
        if (orgs.length > 0 && orgs[0]?.slug) {
          return `/${orgs[0].slug}`
        }
      } catch (err) {
        console.error("[auth] Failed to check user workspaces:", err)
      }
      return "/onboarding"
    }
    return "/"
  }

  if (tokenHash && type && EMAIL_TYPES.has(type)) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error && data.user) {
      await syncUserProfile(data.user)
      const destination = await resolveRedirectPath(data.user)
      return NextResponse.redirect(new URL(destination, origin))
    }
    console.error("[auth] token hash verification failed", error?.message)
    const errMessage = error?.message || "Invalid or expired verification link"
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errMessage)}`, origin))
  }

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      await syncUserProfile(data.user)
      const destination = await resolveRedirectPath(data.user)
      return NextResponse.redirect(new URL(destination, origin))
    }

    console.warn(
      "[auth] Standard code exchange failed:",
      error?.message,
      "Attempting database session recovery...",
    )
    const recoveredUser = await recoverSessionFromCode(code, supabase)
    if (recoveredUser) {
      console.info("[auth] Successfully recovered session for user:", recoveredUser.email)
      await syncUserProfile(recoveredUser)
      const destination = await resolveRedirectPath(recoveredUser)
      return NextResponse.redirect(new URL(destination, origin))
    }

    const isPkce =
      error?.message?.toLowerCase().includes("code verifier") ||
      error?.message?.toLowerCase().includes("pkce")

    const errMessage = isPkce
      ? "Your email is verified! Please sign in with your email and password below."
      : error?.message || "Sign-in code exchange failed"

    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errMessage)}`, origin))
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin))
}
