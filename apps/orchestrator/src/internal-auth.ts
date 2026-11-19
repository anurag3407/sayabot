import { timingSafeEqual } from "node:crypto"
import { getEnv } from "./env"

export function isInternalRequest(authorization: string | undefined, secretHeader?: string): boolean {
  const expected = getEnv().ORCHESTRATOR_INTERNAL_SECRET
  if (!expected || expected.length < 16) return false
  const provided =
    secretHeader ?? (authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined)
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
