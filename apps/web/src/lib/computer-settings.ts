import { encryptSecret, last4 } from "@sayabot/llm"

const BOAT_TOKEN = /^(boat|box)_[A-Za-z0-9_-]{8,}$/
const SSH_NAME = /^[A-Za-z0-9_.:@-]+$/

export interface ComputerSettingsInput {
  orgId: string
  boatToken?: string
  clearBoat?: boolean
  vpsSshAlias?: string
  vpsStartAutomatically?: boolean
  kek: string
  now?: string
}

/**
 * One Boat key for the app, sealed before it is stored. The row never contains the key.
 * A Cloud relay token is not written here.
 */
export function computerSettingsUpdate(
  input: ComputerSettingsInput,
): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const token = input.boatToken?.trim() ?? ""
  if (token && !BOAT_TOKEN.test(token)) return { ok: false, error: "A Boat key starts with boat_ or box_" }
  const alias = (input.vpsSshAlias ?? "").trim().slice(0, 80)
  if (alias && !SSH_NAME.test(alias)) return { ok: false, error: "Use the SSH config name of your server" }
  const row: Record<string, unknown> = {
    org_id: input.orgId,
    vps_ssh_alias: alias || null,
    vps_start_automatically: input.vpsStartAutomatically === true,
    updated_at: input.now ?? new Date().toISOString(),
  }
  if (input.clearBoat) {
    row.boat_ciphertext = null
    row.boat_iv = null
    row.boat_tag = null
    row.boat_last4 = null
  } else if (token) {
    const sealed = encryptSecret(token, input.kek)
    row.boat_ciphertext = sealed.ciphertext
    row.boat_iv = sealed.iv
    row.boat_tag = sealed.tag
    row.boat_last4 = last4(token)
  }
  return { ok: true, row }
}
