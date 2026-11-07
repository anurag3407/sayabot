"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { getCurrentUser } from "@/lib/auth"
import { fail, field, ok } from "@/lib/actions/shared"
import { safeNextPath } from "@/lib/safe-next"
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
  return `${await requestOrigin()}/auth/complete?next=${encodeURIComponent(safeNext(next))}`
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

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name },
      emailRedirectTo: await callbackUrl(next),
    },
  })
  if (error) {
    return fail(
      error.message.toLowerCase().includes("already")
        ? "An account with that email already exists. Sign in instead."
        : error.message,
    )
  }
  if (data.session) redirect(next)
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return fail("An account with that email already exists. Sign in instead.")
  }
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
  if (!verified) return fail("That code is invalid or expired. Request a new one.")
  redirect(next)
}

export async function resendVerificationAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const email = field(formData, "email").toLowerCase()
  if (!emailSchema.safeParse(email).success) return fail("Enter a valid email address")
  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: await callbackUrl("/onboarding") },
  })
  if (error) return fail("Could not resend the code. Try again in a moment.")
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

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: await callbackUrl(next),
      shouldCreateUser: false,
    },
  })
  if (error) {
    if (
      error.message.toLowerCase().includes("signups not allowed") ||
      error.message.toLowerCase().includes("user not found")
    ) {
      return fail("No account found with this email. Create an account first.")
    }
    return fail(error.message)
  }
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
  const supabase = await createSupabaseServerClient()
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: await callbackUrl("/reset-password"),
  })
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
