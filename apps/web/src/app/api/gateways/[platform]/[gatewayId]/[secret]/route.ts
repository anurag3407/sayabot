import { createHash, timingSafeEqual } from "node:crypto"
import { openSecret } from "@sayabot/llm"
import { getInternalSecret, getKek, getOrchestratorUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Public webhook for a per-agent Telegram gateway. Telegram gets
 * `/api/gateways/telegram/<gatewayId>/<secret>`; the secret is compared against the sealed value
 * minted when the channel was connected, then the raw update is forwarded to the orchestrator,
 * which owns the dedup ledger and the room mirror.
 */

const PLATFORMS = new Set(["telegram"])

function same(a: string, b: string): boolean {
  if (!a || !b) return false
  const hashA = createHash("sha256").update(a).digest()
  const hashB = createHash("sha256").update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string; gatewayId: string; secret: string }> },
) {
  const { platform, gatewayId, secret } = await params
  if (!PLATFORMS.has(platform)) return new Response("unsupported", { status: 404 })

  const admin = createAdminClient()
  const { data } = await admin
    .from("agent_gateways")
    .select("id, source, status, webhook_secret_enc")
    .eq("id", gatewayId)
    .maybeSingle()
  const gateway = data as {
    id: string
    source: string
    status: string
    webhook_secret_enc: string | null
  } | null
  if (!gateway || gateway.source !== platform || gateway.status !== "active")
    return new Response("not found", { status: 404 })

  let expected = ""
  try {
    expected = gateway.webhook_secret_enc ? openSecret(gateway.webhook_secret_enc, getKek()) : ""
  } catch {
    return new Response("not found", { status: 404 })
  }
  if (!expected || !same(secret, expected)) return new Response("unauthorized", { status: 401 })

  const raw = await request.text()
  if (raw.length > 100_000) return new Response("too big", { status: 413 })

  const response = await fetch(`${getOrchestratorUrl()}/internal/gateway-inbound`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": getInternalSecret() },
    body: JSON.stringify({ gatewayId, platform, secret, raw }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!response?.ok) return new Response("unavailable", { status: 502 })
  return new Response(await response.text(), {
    status: response.status,
    headers: { "content-type": "application/json" },
  })
}
