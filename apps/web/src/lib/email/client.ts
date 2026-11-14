import { Resend } from "resend"

const resendApiKey = process.env.RESEND_API_KEY
export const DEFAULT_FROM = process.env.RESEND_FROM_EMAIL || "Sayalabs <auth@sayalabs.in>"

export const resend = resendApiKey ? new Resend(resendApiKey) : null

export interface SendEmailOptions {
  to: string | string[]
  subject: string
  html: string
  text?: string
  from?: string
  replyTo?: string
}

export interface SendEmailResult {
  ok: boolean
  id?: string
  error?: string
}

export async function sendEmail(opts: SendEmailOptions): Promise<SendEmailResult> {
  const from = opts.from || DEFAULT_FROM
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to]

  if (!resend) {
    console.warn(`[email] RESEND_API_KEY is not set. Suppressed email to ${recipients.join(", ")}:`, {
      subject: opts.subject,
    })
    return { ok: false, error: "RESEND_API_KEY not configured" }
  }

  try {
    const { data, error } = await resend.emails.send({
      from,
      to: recipients,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      replyTo: opts.replyTo,
    })

    if (error) {
      console.error("[email] Resend API error:", error)
      return { ok: false, error: error.message }
    }

    return { ok: true, id: data?.id }
  } catch (err: any) {
    console.error("[email] Unexpected error delivering email:", err)
    return { ok: false, error: err?.message || "Failed to send email" }
  }
}
