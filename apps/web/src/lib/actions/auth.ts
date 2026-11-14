"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUser } from "@/lib/auth"
import { fail, field, ok } from "@/lib/actions/shared"
import { safeNextPath } from "@/lib/safe-next"
import {
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/email"
import type { ActionResult } from "@/lib/types"

const emailSchema = z.string().trim().email()
const passwordSchema = z.string().min(8).max(72)
const nameSchema = z.string().trim().min(1).max(60)

function safeNext(value: string): string {
  return safeNextPath(value)
}

async function requestOrigin(): Promise<string> {
  const headerList = await headers()
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    headerList.get("origin") ||
    `http://${headerList.get("host") ?? "localhost:3000"}`
  ).replace(/\/+$/, "")
}

async function callbackUrl(next: string): Promise<string> {
  return `${await requestOrigin()}/auth/callback?next=${encodeURIComponent(safeNext(next))}`
}

export async function signUpAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const name = field(formData, "name")
  const email = field(formData, "email").toLowerCase()
  const password = field(formData, "password")
  const next = safeNext(field(formData, "next") || "/onboarding")
  if (!nameSchema.safeParse(name).success) return fail("Enter your name")
  if (!emailSchema.safeParse(email).success) return fail("Enter a valid email address")
  if (!passwordSchema.safeParse(password).success) {
    return fail("Use at least 8 characters for your password")
  }
  if (field(formData, "terms") !== "on") {
    return fail("Agree to the terms and privacy policy to continue")
  }

  const admin = createAdminClient()
  const redirectTarget = await callbackUrl(next)

  // 1. Generate user and verification token without relying on Supabase dashboard mailer
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      data: { full_name: name },
      redirectTo: redirectTarget,
    },
  })

  if (linkError) {
    const msg = linkError.message.toLowerCase()
    if (msg.includes("already") || msg.includes("unique")) {
      // Check if the user signed up before but never confirmed
      const { data: usersData } = await admin.auth.admin.listUsers()
      const existingUser = usersData?.users?.find((u) => u.email?.toLowerCase() === email)
      if (existingUser && !existingUser.email_confirmed_at) {
        const { data: resendData } = await admin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: redirectTarget },
        })
        if (resendData?.properties) {
          await sendVerificationEmail({
            email,
            code: resendData.properties.email_otp,
            link: resendData.properties.action_link,
            name,
          })
          return {
            ok: true,
            message: "Enter the 6-digit code we sent to your email.",
            data: { needsVerification: true, email },
          }
        }
      }
      return fail("An account with that email already exists. Sign in instead.")
    }
    return fail(linkError.message)
  }

  // 2. Dispatch branded email via Resend in code
  const code = linkData?.properties?.email_otp
  const link = linkData?.properties?.action_link || redirectTarget
  await sendVerificationEmail({ email, code, link, name })

  return {
    ok: true,
    message: "Enter the 6-digit code we sent to your email.",
    data: { needsVerification: true, email },
  }
}

export async function verifyEmailAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = field(formData, "email").toLowerCase()
  const token = field(formData, "code").replace(/\s+/g, "")
  const next = safeNext(field(formData, "next") || "/onboarding")
  if (!emailSchema.safeParse(email).success) return fail("Enter the email you signed up with")
  if (!/^\d{6}$/.test(token)) return fail("Enter the 6-digit code")
  const supabase = await createSupabaseServerClient()
  let verified = false
  for (const type of ["signup", "email", "magiclink"] as const) {
    const { error } = await supabase.auth.verifyOtp({ email, token, type })
    if (!error) {
      verified = true
      break
    }
  }
  if (!verified) {
    try {
      const { createAdminClient } = await import("@/lib/supabase/admin")
      const admin = createAdminClient()
      const { data } = await admin.auth.admin.listUsers()
      const user = data?.users?.find((u) => u.email?.toLowerCase() === email)
      if (user && user.email_confirmed_at) {
        return fail("Your email has already been verified! Please sign in with your password.")
      }
    } catch {}
    return fail("That code is invalid or expired. Request a new one.")
  }
  redirect(next)
}

export async function resendVerificationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = field(formData, "email").toLowerCase()
  if (!emailSchema.safeParse(email).success) return fail("Enter a valid email address")
  
  const admin = createAdminClient()
  const redirectTarget = await callbackUrl("/onboarding")

  const { data: magicData, error: magicErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: redirectTarget },
  })

  if (magicErr || !magicData?.properties) {
    return fail("Could not resend the code. Try again in a moment.")
  }

  const code = magicData.properties.email_otp
  const link = magicData.properties.action_link || redirectTarget

  await sendVerificationEmail({ email, code, link })
  return ok("A new code is on its way.")
}

export async function signInEmailAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = field(formData, "email").toLowerCase()
  const password = field(formData, "password")
  const next = safeNext(field(formData, "next") || "/")
  if (!emailSchema.safeParse(email).success) return fail("Enter a valid email address")
  if (!password) return fail("Enter your password")
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    if (error.message.toLowerCase().includes("confirm")) {
      return {
        ok: false,
        error: "Verify your email first. Enter the code we sent, or request a new one.",
        data: { needsVerification: true, email },
      }
    }
    return fail("The email or password is incorrect")
  }
  redirect(next)
}

export async function sendMagicLinkAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = field(formData, "email").toLowerCase()
  const next = safeNext(field(formData, "next") || "/")
  if (!emailSchema.safeParse(email).success) return fail("Enter a valid email address")

  const admin = createAdminClient()
  const redirectTarget = await callbackUrl(next)

  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: redirectTarget },
  })

  if (error || !linkData?.properties) {
    if (error?.message?.toLowerCase().includes("user not found")) {
      return fail("No account found with this email. Create an account first.")
    }
    return fail(error?.message || "Could not generate sign-in code")
  }

  const code = linkData.properties.email_otp
  const link = linkData.properties.action_link || redirectTarget
  await sendMagicLinkEmail({ email, code, link })

  return {
    ok: true,
    message: "We sent a 6-digit sign-in code and magic link to your email.",
    data: { needsVerification: true, email },
  }
}

export async function forgotPasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = field(formData, "email").toLowerCase()
  if (!emailSchema.safeParse(email).success) return fail("Enter a valid email address")

  const admin = createAdminClient()
  const redirectTarget = await callbackUrl("/reset-password")

  const { data: linkData } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: redirectTarget },
  })

  if (linkData?.properties?.action_link) {
    await sendPasswordResetEmail({
      email,
      link: linkData.properties.action_link,
    })
  }

  return ok("If that address has an account, a reset link is on its way.")
}

export async function updatePasswordAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await getCurrentUser()
  if (!user) return fail("Your reset link has expired. Request a new one.")
  const password = field(formData, "password")
  const confirm = field(formData, "confirmPassword")
  if (!passwordSchema.safeParse(password).success) return fail("Use at least 8 characters")
  if (password !== confirm) return fail("The two passwords do not match")
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.updateUser({ password })
  if (error) return fail(error.message)
  redirect("/")
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient()
  await supabase.auth.signOut()
  redirect("/login")
}
