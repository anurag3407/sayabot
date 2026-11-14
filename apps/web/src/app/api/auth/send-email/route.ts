import { NextResponse } from "next/server"
import {
  sendMagicLinkEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendWorkspaceInviteEmail,
} from "@/lib/email"

/**
 * Supabase Auth "Send Email" Hook & Generic Auth Email Webhook.
 * Accepts external auth events and renders in-code email templates via Resend.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { user, email_data } = body

    if (!user?.email || !email_data) {
      return NextResponse.json({ error: "Missing required email payload" }, { status: 400 })
    }

    const email = user.email
    const token = email_data.token as string | undefined
    const redirectTo = email_data.redirect_to as string | undefined
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "")
    const link =
      redirectTo ||
      (email_data.token_hash
        ? `${siteUrl}/auth/callback?token_hash=${email_data.token_hash}&type=${email_data.email_action_type}`
        : `${siteUrl}/auth/complete`)

    const actionType = email_data.email_action_type

    switch (actionType) {
      case "signup":
      case "email_change":
        await sendVerificationEmail({
          email,
          code: token,
          link,
          name: user.user_metadata?.full_name || user.user_metadata?.name,
        })
        break

      case "magiclink":
      case "login":
        await sendMagicLinkEmail({
          email,
          code: token,
          link,
        })
        break

      case "recovery":
        await sendPasswordResetEmail({
          email,
          link,
        })
        break

      case "invite":
        await sendWorkspaceInviteEmail({
          email,
          workspaceName: "Sayalabs",
          role: "member",
          joinUrl: link,
          isExistingUser: false,
        })
        break

      default:
        console.warn(`[auth-email-hook] Unhandled action type: ${actionType}`)
        break
    }

    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error("[auth-email-hook] Error processing email hook:", err)
    return NextResponse.json({ error: err?.message || "Failed to process hook" }, { status: 500 })
  }
}
