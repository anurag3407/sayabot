import { createHash, createHmac, randomBytes } from "node:crypto"

/**
 * Per-agent egress proxy credential. It is derived (not stored) so it survives a
 * computerd restart, and it never enters a computer: computerd adds it on the host
 * side of the egress bridge. The orchestrator only keeps its SHA-256.
 */
export class ProxyIdentity {
  private key: Buffer

  constructor(key = process.env.COMPUTERD_PROXY_KEY || process.env.ORCHESTRATOR_INTERNAL_SECRET) {
    // Without a configured key, credentials still work for the life of this process.
    this.key = key ? Buffer.from(key) : randomBytes(32)
  }

  secret(agentId: string): string {
    return createHmac("sha256", this.key).update(`saaya-egress:${agentId}`).digest("hex")
  }

  /** Same hash the orchestrator applies (hashAgentApiKey in @sayabot/core). */
  secretHash(agentId: string): string {
    return createHash("sha256").update(this.secret(agentId)).digest("hex")
  }

  proxyAuthorization(agentId: string): string {
    return `Basic ${Buffer.from(`saaya:${this.secret(agentId)}`).toString("base64")}`
  }
}
