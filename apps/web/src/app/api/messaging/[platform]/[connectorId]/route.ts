import { decryptSecret, unwrapConnectorSecret } from "@sayabot/llm"
import { getInternalSecret, getKek, getOrchestratorUrl } from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"

const PLATFORMS = new Set(["telegram", "whatsapp"])

interface ConnectorRow {
  id: string
  source: string
  status: string
  ciphertext: string
  iv: string
  tag: string
  config: { inbound?: { enabled?: boolean } } | null
}

async function connector(connectorId: string, platform: string): Promise<{ row: ConnectorRow; inboundSecret: string } | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("workspace_connectors")
    .select("id, source, status, ciphertext, iv, tag, config")
    .eq("id", connectorId)
    .maybeSingle()
  const row = data as ConnectorRow | null
  if (!row || row.source !== platform || row.status !== "active" || !row.config?.inbound?.enabled) return null
  try {
    const secret = unwrapConnectorSecret(decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, tag: row.tag }, getKek())).inboundSecret
    if (!secret) return null
    return { row, inboundSecret: secret }
  } catch {
    return null
  }
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Telegram and WhatsApp call this URL. A matching message is forwarded to the orchestrator,
 * which writes it into the chosen room and wakes the agent. The reply comes back on its own.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ platform: string; connectorId: string }> },
) {
  const { platform, connectorId } = await params
  if (!PLATFORMS.has(platform)) return new Response("unsupported", { status: 404 })
  const found = await connector(connectorId, platform)
  if (!found) return new Response("not found", { status: 404 })
  const key = new URL(request.url).searchParams.get("k") ?? ""
  if (!same(key, found.inboundSecret)) return new Response("unauthorized", { status: 401 })
  const raw = await request.text()
  if (raw.length > 100_000) return new Response("too big", { status: 413 })
  const response = await fetch(`${getOrchestratorUrl()}/internal/inbound`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-secret": getInternalSecret() },
    body: JSON.stringify({ platform, connectorId, key, raw }),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null)
  if (!response?.ok) return new Response("unavailable", { status: 502 })
  return new Response(await response.text(), { status: response.status, headers: { "content-type": "application/json" } })
}

/** WhatsApp's setup check. The verify token is the chat secret, not the access token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ platform: string; connectorId: string }> },
) {
  const { platform, connectorId } = await params
  if (platform !== "whatsapp") return new Response("unsupported", { status: 404 })
  const found = await connector(connectorId, platform)
  if (!found) return new Response("not found", { status: 404 })
  const url = new URL(request.url)
  const token = url.searchParams.get("hub.verify_token") ?? ""
  const challenge = url.searchParams.get("hub.challenge")
  if (url.searchParams.get("hub.mode") !== "subscribe" || !challenge || !same(token, found.inboundSecret)) {
    return new Response("forbidden", { status: 403 })
  }
  return new Response(challenge, { status: 200 })
}
