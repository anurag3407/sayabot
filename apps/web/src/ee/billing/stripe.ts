import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * The few Stripe API calls Sayabot Cloud needs, over Stripe's REST API (no SDK dependency).
 * Sayabot Commercial License: see ../LICENSE.
 */

const API = "https://api.stripe.com/v1"

type Param = string | number | boolean | null | undefined | Param[] | { [key: string]: Param }

/** Stripe's form encoding: nested objects and arrays become a[b][0]=c. */
export function stripeForm(params: Record<string, Param>): URLSearchParams {
  const out = new URLSearchParams()
  const walk = (prefix: string, value: Param) => {
    if (value === undefined || value === null) return
    if (Array.isArray(value)) value.forEach((item, i) => walk(`${prefix}[${i}]`, item))
    else if (typeof value === "object")
      for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v)
    else out.append(prefix, String(value))
  }
  for (const [key, value] of Object.entries(params)) walk(key, value)
  return out
}

export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function stripe<T>(
  path: string,
  params?: Record<string, Param>,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new StripeError("Billing isn't set up on this server (STRIPE_SECRET_KEY).", 500)
  const body = params ? stripeForm(params) : undefined
  const url = method === "GET" && body ? `${API}${path}?${body}` : `${API}${path}`
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2024-06-20",
    },
    body: method === "POST" ? body : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok)
    throw new StripeError(data.error?.message ?? `Stripe answered ${res.status}`, res.status)
  return data
}

/**
 * Checks a webhook's Stripe-Signature header ("t=…,v1=…"): HMAC-SHA256 of "t.payload" with the
 * endpoint secret, within five minutes, compared in constant time.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secret: string,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  if (!header || !secret) return false
  const parts = header.split(",").map((part) => part.trim().split("="))
  const timestamp = Number(parts.find(([k]) => k === "t")?.[1])
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "")
  if (!Number.isFinite(timestamp) || !signatures.length) return false
  if (Math.abs(now - timestamp) > toleranceSeconds) return false
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest()
  return signatures.some((sig) => {
    const given = Buffer.from(sig, "hex")
    return given.length === expected.length && timingSafeEqual(given, expected)
  })
}
