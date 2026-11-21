import { createHash } from "node:crypto"
import { agentRuns, agents } from "@sayabot/db"
import { eq } from "drizzle-orm"
import { getDb } from "../db"

/**
 * A person who has allowed one exact call can say "always allow this one", and the bot skips the
 * prompt for that call only: the same tool with the same arguments, for a day at most, on that bot.
 * Anything else still asks. Credential reads, outbound sends, installs and deletions are never
 * covered, because those are the calls where a stale grant would be an exfiltration path.
 */
export const GRANT_TTL_MS = 24 * 60 * 60_000
export const MAX_STANDING_GRANTS = 20
const MAX_LABEL_LENGTH = 160

export interface StandingGrant {
  tool: string
  /** Hash of the exact stored arguments, so one command is remembered, not a class of them. */
  argsDigest: string
  /** Human-readable reminder of what was allowed, shown in the bot's access list. */
  label: string
  /** Who allowed it: a profile id, or "internal" when an operator route granted it. */
  grantedBy: string
  grantedAt: string
  expiresAt: string
}

const GRANT_BLOCKED: RegExp[] = [
  /secret/i,
  /vault/i,
  /password/i,
  /credential/i,
  /api[_-]?key/i,
  /(^|_)(send|publish|post|reply|email|message|invite)/i,
  /(^|_)(install|uninstall)/i,
  /(^|_)(delete|remove|destroy|drop|truncate|revoke|reset|purge)/i,
  /(^|_)(pay|purchase|charge|refund|transfer|bill)/i,
]

/** Whether this tool may ever be covered by a standing grant. */
export function grantAllowed(tool: string): boolean {
  if (!tool.trim()) return false
  return !GRANT_BLOCKED.some((pattern) => pattern.test(tool))
}

/** JSON with object keys sorted at every level, so equal arguments hash equally. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null"
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
  return `{${entries.join(",")}}`
}

/** A short, stable fingerprint of one call's arguments. */
export function argsDigest(args: unknown): string {
  return createHash("sha256").update(stableJson(args)).digest("hex").slice(0, 32)
}

function readGrants(params: Record<string, unknown> | null | undefined): StandingGrant[] {
  const raw = (params ?? {}).standingGrants
  if (!Array.isArray(raw)) return []
  const grants: StandingGrant[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const tool = typeof row.tool === "string" ? row.tool : ""
    const digest = typeof row.argsDigest === "string" ? row.argsDigest : ""
    const expiresAt = typeof row.expiresAt === "string" ? row.expiresAt : ""
    if (!tool || !digest || !expiresAt) continue
    grants.push({
      tool,
      argsDigest: digest,
      label: typeof row.label === "string" ? row.label : tool,
      grantedBy: typeof row.grantedBy === "string" ? row.grantedBy : "internal",
      grantedAt: typeof row.grantedAt === "string" ? row.grantedAt : expiresAt,
      expiresAt,
    })
  }
  return grants
}

/** Live grants only: an expired one stops granting the moment it lapses. */
export function standingGrants(
  params: Record<string, unknown> | null | undefined,
  now = Date.now(),
): StandingGrant[] {
  return readGrants(params).filter((grant) => Date.parse(grant.expiresAt) > now)
}

/** The grant covering this exact call, when one exists. */
export function matchStandingGrant(
  grants: readonly StandingGrant[],
  tool: string,
  args: unknown,
  now = Date.now(),
): StandingGrant | null {
  if (!grantAllowed(tool)) return null
  const digest = argsDigest(args)
  return (
    grants.find(
      (grant) =>
        grant.tool === tool && grant.argsDigest === digest && Date.parse(grant.expiresAt) > now,
    ) ?? null
  )
}

/** Newest first, expired dropped, and the list capped so params stay small. */
export function withGrant(
  params: Record<string, unknown> | null | undefined,
  grant: StandingGrant,
  now = Date.now(),
): Record<string, unknown> {
  const kept = standingGrants(params, now).filter(
    (existing) => !(existing.tool === grant.tool && existing.argsDigest === grant.argsDigest),
  )
  const next = { ...((params ?? {}) as Record<string, unknown>) }
  next.standingGrants = [grant, ...kept].slice(0, MAX_STANDING_GRANTS)
  return next
}

function labelFor(tool: string, args: unknown): string {
  let summary = ""
  try {
    summary = stableJson(args)
  } catch {
    summary = ""
  }
  const text = `${tool} ${summary}`.trim().slice(0, MAX_LABEL_LENGTH)
  return text || tool
}

/** Looks up the bot behind an agent id and answers with the grant covering this call, if any. */
export async function standingGrantFor(
  agentId: string,
  tool: string,
  args: unknown,
  now = Date.now(),
): Promise<StandingGrant | null> {
  if (!grantAllowed(tool)) return null
  const [row] = await getDb()
    .select({ params: agents.params })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)
  if (!row) return null
  return matchStandingGrant(
    standingGrants(row.params as Record<string, unknown>, now),
    tool,
    args,
    now,
  )
}

export interface RememberInput {
  runId?: string | null
  toolName: string
  args: unknown
  grantedBy?: string | null
}

/**
 * Turns an approval into a standing grant for the exact call that was approved. Returns null when
 * the call cannot be traced to a bot, or when the tool may never be covered.
 */
export async function rememberStandingGrant(
  input: RememberInput,
  now = Date.now(),
): Promise<StandingGrant | null> {
  if (!grantAllowed(input.toolName)) return null
  if (!input.runId) return null
  const db = getDb()
  const [run] = await db
    .select({ agentId: agentRuns.agentId })
    .from(agentRuns)
    .where(eq(agentRuns.id, input.runId))
    .limit(1)
  const agentId = run?.agentId
  if (!agentId) return null
  const [agent] = await db
    .select({ params: agents.params })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1)
  if (!agent) return null
  const grant: StandingGrant = {
    tool: input.toolName,
    argsDigest: argsDigest(input.args),
    label: labelFor(input.toolName, input.args),
    grantedBy: input.grantedBy?.trim() || "internal",
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
  }
  const params = withGrant(agent.params as Record<string, unknown>, grant, now)
  await db
    .update(agents)
    .set({ params, updatedAt: new Date(now) })
    .where(eq(agents.id, agentId))
  return grant
}
