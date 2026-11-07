import { NextResponse } from "next/server"
import type { EmailOtpType, User } from "@supabase/supabase-js"
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
    console.error("[auth] code exchange failed", error?.message)
    const errMessage = error?.message || "Sign-in code exchange failed"
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errMessage)}`, origin))
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin))
}
