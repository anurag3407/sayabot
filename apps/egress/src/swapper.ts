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
  secretIdentityCache.clear()
}

const secretIdentityCache = new Map<string, { identity: { agentId: string; orgId: string }; expiresAt: number }>()

/** Parses `Proxy-Authorization: Basic base64(user:secret)` and returns the secret. */
export function proxySecretFrom(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header
  const m = value?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i)
  if (!m?.[1]) return null
  const decoded = Buffer.from(m[1], "base64").toString("utf8")
  const i = decoded.indexOf(":")
  return i >= 0 && decoded.length > i + 1 ? decoded.slice(i + 1) : null
}

/**
 * Identity from a per-agent proxy credential. computerd adds it on the host side of a
 * microVM's egress socket, so it never enters the computer and cannot be forged by it.
 */
export async function resolveAgentIdentityBySecret(secret: string): Promise<{ agentId: string; orgId: string } | null> {
  const cached = secretIdentityCache.get(secret)
  if (cached && cached.expiresAt > Date.now()) return cached.identity
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/internal/egress/identity`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({ proxySecret: secret }),
    })
    if (res.ok) {
      const data = (await res.json()) as { agentId: string; orgId: string }
      secretIdentityCache.set(secret, { identity: data, expiresAt: Date.now() + 60_000 })
      return data
    }
  } catch (e) {
    console.warn("[egress] failed to resolve agent identity from proxy credential", e)
  }
  return null
}

/** Drops the cached owner of a container IP; computerd calls this whenever a computer starts or stops. */
export function forgetIdentity(containerIp: string): boolean {
  return identityCache.delete(containerIp)
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
