import { sendEmail, type SendEmailResult } from "./client"
import {
  renderMagicLinkTemplate,
  renderPasswordResetTemplate,
  renderVerificationTemplate,
} from "./templates/auth"
import {
  renderRoomInviteTemplate,
  renderWorkspaceInviteTemplate,
} from "./templates/invites"

export * from "./client"
export * from "./templates/base"
export * from "./templates/auth"
export * from "./templates/invites"

/**
 * Dispatch an account verification email containing a 6-digit code and direct link.
 */
export async function sendVerificationEmail({
  email,
  code,
  link,
  name,
}: {
  email: string
  code?: string
  link: string
  name?: string
}): Promise<SendEmailResult> {
  const { subject, html, text } = renderVerificationTemplate({ code, link, name })
  return sendEmail({ to: email, subject, html, text })
}

/**
 * Dispatch a magic link / OTP sign-in email.
 */
export async function sendMagicLinkEmail({
  email,
  code,
  link,
}: {
  email: string
  code?: string
  link: string
}): Promise<SendEmailResult> {
  const { subject, html, text } = renderMagicLinkTemplate({ code, link })
  return sendEmail({ to: email, subject, html, text })
}

/**
 * Dispatch a password reset email.
 */
export async function sendPasswordResetEmail({
  email,
  link,
}: {
  email: string
  link: string
}): Promise<SendEmailResult> {
  const { subject, html, text } = renderPasswordResetTemplate({ link })
  return sendEmail({ to: email, subject, html, text })
}

/**
 * Dispatch a workspace invitation email.
 */
export async function sendWorkspaceInviteEmail({
  email,
  inviterName,
  workspaceName,
  role,
  joinUrl,
  isExistingUser,
}: {
  email: string
  inviterName?: string | null
  workspaceName: string
  role: string
  joinUrl: string
  isExistingUser?: boolean
}): Promise<SendEmailResult> {
  const { subject, html, text } = renderWorkspaceInviteTemplate({
    inviterName,
    workspaceName,
    role,
    joinUrl,
    isExistingUser,
  })
  return sendEmail({ to: email, subject, html, text })
}

/**
 * Dispatch a room invitation email.
 */
export async function sendRoomInviteEmail({
  email,
  inviterName,
  roomName,
  joinUrl,
}: {
  email: string
  inviterName?: string | null
  roomName: string
  joinUrl: string
}): Promise<SendEmailResult> {
  const { subject, html, text } = renderRoomInviteTemplate({
    inviterName,
    roomName,
    joinUrl,
  })
  return sendEmail({ to: email, subject, html, text })
}
