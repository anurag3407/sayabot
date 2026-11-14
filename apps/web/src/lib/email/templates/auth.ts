import { renderEmailShell } from "./base"

export function renderVerificationTemplate({
  code,
  link,
  name,
}: {
  code?: string
  link: string
  name?: string
}): { subject: string; html: string; text: string } {
  const greeting = name ? `Hello ${name},` : "Hello,"
  const subject = "Verify your Sayalabs account"
  const previewText = code
    ? `Your verification code is ${code}`
    : "Confirm your email address for Sayalabs"

  const codeSection = code
    ? `
      <p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 14px;">
        Enter this 6-digit verification code to complete your signup:
      </p>
      <div style="background-color: #121a14; border: 1px solid #1f3024; border-radius: 8px; padding: 18px 24px; text-align: center; margin: 0 0 28px 0;">
        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: #34d399;">
          ${code}
        </span>
      </div>
      <p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 13px;">
        Or click the button below to verify automatically:
      </p>
    `
    : `
      <p style="margin: 0 0 24px 0; color: #d4d4d8;">
        Click the button below to confirm your email and access your workspace:
      </p>
    `

  const contentHtml = `
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px;">
      Confirm your email address
    </h1>
    <p style="margin: 0 0 24px 0; color: #a1a1aa;">
      ${greeting} Welcome to Sayalabs. Confirm your email address to get started.
    </p>

    ${codeSection}

    <div style="text-align: center; margin: 24px 0 32px 0;">
      <a href="${link}" style="display: inline-block; background-color: #34d399; color: #070907; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px; box-shadow: 0 2px 8px rgba(52, 211, 153, 0.25);">
        Verify Email Address
      </a>
    </div>

    <p style="margin: 0; color: #71717a; font-size: 12px; line-height: 1.5; border-top: 1px solid #19211b; padding-top: 20px;">
      If the button above does not work, copy and paste this link into your browser:<br>
      <a href="${link}" style="color: #34d399; text-decoration: underline; word-break: break-all;">${link}</a>
    </p>
  `

  const text = `${greeting}\n\nWelcome to Sayalabs.${
    code ? `\nYour 6-digit verification code is: ${code}\n` : ""
  }\nVerify your email: ${link}\n\nIf you did not request this, please ignore this email.`

  return {
    subject,
    html: renderEmailShell({ title: subject, previewText, contentHtml }),
    text,
  }
}

export function renderMagicLinkTemplate({
  code,
  link,
}: {
  code?: string
  link: string
}): { subject: string; html: string; text: string } {
  const subject = "Your Sayalabs sign-in code"
  const previewText = code
    ? `Your sign-in code is ${code}`
    : "Sign in to your Sayalabs account"

  const codeSection = code
    ? `
      <p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 14px;">
        Enter this 6-digit code on the sign-in screen:
      </p>
      <div style="background-color: #121a14; border: 1px solid #1f3024; border-radius: 8px; padding: 18px 24px; text-align: center; margin: 0 0 28px 0;">
        <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 34px; font-weight: 700; letter-spacing: 8px; color: #34d399;">
          ${code}
        </span>
      </div>
      <p style="margin: 0 0 16px 0; color: #a1a1aa; font-size: 13px;">
        Or click to sign in directly without typing the code:
      </p>
    `
    : `
      <p style="margin: 0 0 24px 0; color: #d4d4d8;">
        Click the button below to sign in to your Sayalabs account:
      </p>
    `

  const contentHtml = `
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px;">
      Sign in to Sayalabs
    </h1>
    <p style="margin: 0 0 24px 0; color: #a1a1aa;">
      We received a request to access your Sayalabs workspace.
    </p>

    ${codeSection}

    <div style="text-align: center; margin: 24px 0 32px 0;">
      <a href="${link}" style="display: inline-block; background-color: #34d399; color: #070907; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px; box-shadow: 0 2px 8px rgba(52, 211, 153, 0.25);">
        Sign In Directly
      </a>
    </div>

    <p style="margin: 0; color: #71717a; font-size: 12px; line-height: 1.5; border-top: 1px solid #19211b; padding-top: 20px;">
      This link and code will expire shortly. If you did not request this, please ignore this email.
    </p>
  `

  const text = `Sign in to Sayalabs.${
    code ? `\nYour 6-digit code is: ${code}\n` : ""
  }\nSign in link: ${link}\n\nIf you did not request this, please ignore this email.`

  return {
    subject,
    html: renderEmailShell({ title: subject, previewText, contentHtml }),
    text,
  }
}

export function renderPasswordResetTemplate({
  link,
}: {
  link: string
}): { subject: string; html: string; text: string } {
  const subject = "Reset your Sayalabs password"
  const previewText = "Reset your Sayalabs account password"

  const contentHtml = `
    <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; color: #ffffff; letter-spacing: -0.3px;">
      Reset your password
    </h1>
    <p style="margin: 0 0 24px 0; color: #a1a1aa;">
      We received a request to reset the password for your Sayalabs account. Click the button below to choose a new password:
    </p>

    <div style="text-align: center; margin: 28px 0 32px 0;">
      <a href="${link}" style="display: inline-block; background-color: #34d399; color: #070907; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 32px; border-radius: 6px; box-shadow: 0 2px 8px rgba(52, 211, 153, 0.25);">
        Reset Password
      </a>
    </div>

    <p style="margin: 0 0 16px 0; color: #71717a; font-size: 12px; line-height: 1.5; border-top: 1px solid #19211b; padding-top: 20px;">
      If the button above does not work, copy and paste this link into your browser:<br>
      <a href="${link}" style="color: #34d399; text-decoration: underline; word-break: break-all;">${link}</a>
    </p>
    <p style="margin: 0; color: #71717a; font-size: 12px; line-height: 1.5;">
      If you did not request a password reset, no action is needed. Your account remains secure.
    </p>
  `

  const text = `Reset your Sayalabs password:\n\n${link}\n\nIf you did not request this, please ignore this email.`

  return {
    subject,
    html: renderEmailShell({ title: subject, previewText, contentHtml }),
    text,
  }
}
