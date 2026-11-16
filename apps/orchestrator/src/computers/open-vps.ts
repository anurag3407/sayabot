import { orgComputerSettings } from "@sayabot/db"
import { decryptSecret } from "@sayabot/llm"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { getEnv } from "../env"
import type { VpsTarget } from "./vps"

interface VpsSettingsRow {
  alias: string | null
  host: string | null
  user: string | null
  port: number | null
  keyCiphertext: string | null
  keyIv: string | null
  keyTag: string | null
}

/**
 * The saved server as an SSH target. A host wins over the alias. The private key is opened here
 * and lives only in memory and, for one ssh call, in a 0600 temp file.
 */
export function vpsTargetFromSettings(
  row: VpsSettingsRow | null | undefined,
  kek: string,
): VpsTarget | null {
  if (!row) return null
  const host = row.host?.trim()
  if (host) {
    let privateKey: string | null = null
    if (row.keyCiphertext && row.keyIv && row.keyTag) {
      try {
        privateKey = decryptSecret(
          { ciphertext: row.keyCiphertext, iv: row.keyIv, tag: row.keyTag },
          kek,
        )
      } catch {
        privateKey = null
      }
    }
    return {
      kind: "host",
      host,
      user: row.user?.trim() || "root",
      port: row.port ?? 22,
      privateKey,
    }
  }
  const alias = row.alias?.trim()
  return alias ? { kind: "alias", alias } : null
}

export async function vpsTargetForOrg(orgId: string): Promise<VpsTarget | null> {
  const [row] = await getDb()
    .select({
      alias: orgComputerSettings.vpsSshAlias,
      host: orgComputerSettings.vpsHost,
      user: orgComputerSettings.vpsUser,
      port: orgComputerSettings.vpsPort,
      keyCiphertext: orgComputerSettings.vpsKeyCiphertext,
      keyIv: orgComputerSettings.vpsKeyIv,
      keyTag: orgComputerSettings.vpsKeyTag,
    })
    .from(orgComputerSettings)
    .where(eq(orgComputerSettings.orgId, orgId))
    .limit(1)
  return vpsTargetFromSettings(row, getEnv().MESH_KEK)
}
