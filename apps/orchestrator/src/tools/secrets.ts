import { agentSecretGrants, orgToolConfigs, vaultSecrets } from "@sayabot/db"
import { openSecret } from "@sayabot/llm"
import { and, eq, isNull, or, gt } from "drizzle-orm"
import { getDb } from "../db"
import { getEnv } from "../env"

export interface OrgToolConfig {
  token?: string
  connectionString?: string
  apiKey?: string
  provider?: string
  baseUrl?: string
}

export async function loadOrgToolConfig<T extends OrgToolConfig>(
  orgId: string,
  tool: "web_search" | "github_bridge" | "postgres_inspector",
): Promise<T | null> {
  const [row] = await getDb()
  .select()
  .from(orgToolConfigs)
  .where(
    and(
      eq(orgToolConfigs.orgId, orgId),
      eq(orgToolConfigs.tool, tool),
      eq(orgToolConfigs.enabled, true),
    ),
  )
  .limit(1)
  if (!row) return null
  return JSON.parse(openSecret(row.configEnc, getEnv().MESH_KEK)) as T
}

export async function resolveToolCredential(args: {
  agentId?: string
  orgId: string
  tool: "github_bridge" | "postgres_inspector" | "web_search"
}): Promise<OrgToolConfig | null> {
  const db = getDb()
  const kek = getEnv().MESH_KEK

  // If an agent is specified, check for a direct grant first
  if (args.agentId) {
    const canonicalEnv =
      args.tool === "github_bridge"
        ? "GITHUB_TOKEN"
        : args.tool === "postgres_inspector"
          ? "DATABASE_URL"
          : null

    if (canonicalEnv) {
      const now = new Date()
      const [grant] = await db
        .select({
          sealed: vaultSecrets.sealed,
          kind: vaultSecrets.kind,
        })
        .from(agentSecretGrants)
        .innerJoin(vaultSecrets, eq(agentSecretGrants.secretId, vaultSecrets.id))
        .where(
          and(
            eq(agentSecretGrants.agentId, args.agentId),
            eq(agentSecretGrants.envName, canonicalEnv),
            isNull(agentSecretGrants.revokedAt),
            or(isNull(agentSecretGrants.expiresAt), gt(agentSecretGrants.expiresAt, now)),
          ),
        )
        .limit(1)

      if (grant) {
        try {
          const raw = openSecret(grant.sealed, kek)
          let parsed: unknown = raw
          try {
            parsed = JSON.parse(raw)
          } catch {
            parsed = raw
          }

          if (args.tool === "github_bridge") {
            const token =
              typeof parsed === "string"
                ? parsed
                : (parsed as any)?.token || (parsed as any)?.password || (parsed as any)?.apiKey
            if (token) return { token }
          } else if (args.tool === "postgres_inspector") {
            const connectionString =
              typeof parsed === "string"
                ? parsed
                : (parsed as any)?.connectionString || (parsed as any)?.url
            if (connectionString) return { connectionString }
          }
        } catch {
          // Fall through to orgToolConfig if decryption/parsing fails
        }
      }
    }
  }

  // Fallback to existing org tool configs
  return loadOrgToolConfig(args.orgId, args.tool)
}
