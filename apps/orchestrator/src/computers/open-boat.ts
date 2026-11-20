import { boatCredential, type ComputerDecision } from "@sayabot/core"
import { agents, orgComputerSettings } from "@sayabot/db"
import { decryptSecret } from "@sayabot/llm"
import { eq } from "drizzle-orm"
import { getDb } from "../db"
import { getEnv } from "../env"
import { applyBoatDecision } from "./apply-boat"
import { BoatClient } from "./boat"

/** The person's own Boat key wins. The Cloud relay token is used only when they have none. */
export async function boatTokenForOrg(
  orgId: string,
): Promise<{ token: string; source: "own" | "included" } | null> {
  const [settings] = await getDb()
    .select({
      ciphertext: orgComputerSettings.boatCiphertext,
      iv: orgComputerSettings.boatIv,
      tag: orgComputerSettings.boatTag,
    })
    .from(orgComputerSettings)
    .where(eq(orgComputerSettings.orgId, orgId))
    .limit(1)
  let own: string | null = null
  if (settings?.ciphertext && settings.iv && settings.tag) {
    try {
      own = decryptSecret(
        { ciphertext: settings.ciphertext, iv: settings.iv, tag: settings.tag },
        getEnv().MESH_KEK,
      )
    } catch {
      own = null
    }
  }
  return boatCredential(own, process.env.SAYABOT_BOAT_TOKEN)
}

/**
 * Wakes or creates the Boat for one select_computer decision.
 * The person's own key is used when it is set. The Cloud relay token is the fallback.
 */
export async function openSelectedBoat(input: {
  orgId: string
  agentId: string
  params: Record<string, unknown> | null
  decision: ComputerDecision
}): Promise<Record<string, unknown>> {
  const cred = await boatTokenForOrg(input.orgId)
  if (!cred) return { ok: false, error: "No Boat key is set in Settings → Computers." }
  const computer =
    input.params?.computer && typeof input.params.computer === "object"
      ? (input.params.computer as Record<string, unknown>)
      : {}
  const currentId = typeof computer.boatId === "string" ? computer.boatId : null
  const result = await applyBoatDecision(
    new BoatClient({ token: cred.token, api: process.env.SAYABOT_BOAT_API || undefined }),
    input.decision,
    currentId,
    input.agentId,
  )
  if (!result.ok) return { ok: false, error: result.error }
  const next = {
    ...(input.params ?? {}),
    computer: {
      ...computer,
      boatId: result.boatId,
      boatState: "running",
      boatConfigured: true,
      lastUsedAt: new Date().toISOString(),
    },
  }
  await getDb().update(agents).set({ params: next }).where(eq(agents.id, input.agentId))
  return { ok: true, boatId: result.boatId, billedTo: cred.source }
}
