import { createHash, randomBytes } from "node:crypto"

export interface GeneratedAgentApiKey {
  token: string
  prefix: string
  hash: string
  last4: string
}

export function hashAgentApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export function agentKeyPrefix(token: string): string {
  return token.slice(0, 16)
}

export function generateAgentApiKey(): GeneratedAgentApiKey {
  const token = `mesh_ak_${randomBytes(32).toString("base64url")}`
  return {
    token,
    prefix: agentKeyPrefix(token),
    hash: hashAgentApiKey(token),
    last4: token.slice(-4),
  }
}

/** Public-ish code in an "Add an agent" link. Not a credential: joining still needs approval. */
export function generateBotInviteCode(): string {
  return `bi_${randomBytes(18).toString("base64url")}`
}

/** Handed to the bot that asked to join; proves it is the same bot when it collects its key. */
export function generatePollToken(): { token: string; hash: string } {
  const token = `bp_${randomBytes(32).toString("base64url")}`
  return { token, hash: hashAgentApiKey(token) }
}

/** An 8-character pairing code from PAIRING_ALPHABET, without modulo bias. */
export function generatePairingCode(alphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ", length = 8): string {
  const limit = 256 - (256 % alphabet.length)
  let out = ""
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= limit) continue
      out += alphabet[byte % alphabet.length]
      if (out.length === length) break
    }
  }
  return out
}

/** Long-lived secret a paired phone keeps to check it hasn't been removed. */
export function generateDeviceToken(): { token: string; hash: string } {
  const token = `sd_${randomBytes(32).toString("base64url")}`
  return { token, hash: hashAgentApiKey(token) }
}

/** Code in a workspace invite link (/join/<code>). Holding it grants membership, so it is long. */
export function generateJoinCode(): string {
  return `j_${randomBytes(18).toString("base64url")}`
}
