import { matchesHostPattern } from "@sayabot/core"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://orchestrator:4000"
const INTERNAL_SECRET = process.env.ORCHESTRATOR_INTERNAL_SECRET || ""

export interface ResolvedGrant {
  grantId: string
  secretPlaintext: string
  hostAllowlist: string[]
  inject: {
    mode: "header" | "basic" | "query" | "body"
    template?: string
    param?: string
  }
  methods?: string[]
  requiresApproval?: boolean
}

const grantCache = new Map<string, { grant: ResolvedGrant; expiresAt: number }>()
const identityCache = new Map<string, { identity: { agentId: string; orgId: string }; expiresAt: number }>()

export function flushGrantCache() {
  grantCache.clear()
  identityCache.clear()
}

export async function resolveAgentIdentity(containerIp: string): Promise<{ agentId: string; orgId: string } | null> {
  const cached = identityCache.get(containerIp)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.identity
  }
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/internal/egress/identity`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ containerIp }),
    })
    if (res.ok) {
      const data = (await res.json()) as { agentId: string; orgId: string }
      identityCache.set(containerIp, { identity: data, expiresAt: Date.now() + 30_000 })
      return data
    }
  } catch (e) {
    console.warn("[egress] failed to resolve agent identity from IP", e)
  }
  return null
}

export async function resolvePlaceholder(agentId: string, placeholder: string): Promise<ResolvedGrant> {
  const cacheKey = `${agentId}:${placeholder}`
  const cached = grantCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.grant
  }

  const res = await fetch(`${ORCHESTRATOR_URL}/internal/egress/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": INTERNAL_SECRET,
    },
    body: JSON.stringify({ agentId, placeholder }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Failed to resolve secret placeholder (${res.status}): ${body}`)
  }

  const grant = (await res.json()) as ResolvedGrant
  grantCache.set(cacheKey, { grant, expiresAt: Date.now() + 30_000 })
  return grant
}

export async function reportViolation(agentId: string, host: string, reason: string): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/internal/egress/violation`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ agentId, host, reason }),
    })
  } catch (e) {
    console.warn("[egress] failed to report violation", e)
  }
}

export async function requestApproval(
  agentId: string,
  grantId: string,
  url: string,
  method: string,
): Promise<"approved" | "rejected"> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/internal/egress/approval`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ agentId, grantId, url, method }),
    })
    if (res.ok) {
      const data = (await res.json()) as { status: "approved" | "rejected" }
      return data.status
    }
  } catch (e) {
    console.warn("[egress] approval request error", e)
  }
  return "rejected"
}

export function isHostAllowed(host: string, allowlist: string[]): boolean {
  for (const pattern of allowlist) {
    if (matchesHostPattern(host, pattern)) return true
  }
  return false
}
