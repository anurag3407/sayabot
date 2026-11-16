import { encryptSecret, last4 } from "@sayabot/llm"

const BOAT_TOKEN = /^(boat|box)_[A-Za-z0-9_-]{8,}$/
const SSH_NAME = /^[A-Za-z0-9_.:@-]+$/

const E2B_KEY = /^e2b_[A-Za-z0-9_-]{8,}$/
const HOST = /^[A-Za-z0-9_.:[\]-]+$/
const USER = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/

export type ComputerProvider = "boat" | "e2b" | "vps"

export interface ComputerProviderInput {
  orgId: string
  provider: ComputerProvider
  /** Boat or E2B key. Empty keeps the saved one. */
  token?: string
  /** Remove everything saved for this provider. */
  clear?: boolean
  /** VPS: "user@host", "user@host:2222" or "ssh user@host -p 2222". Wins over the alias. */
  address?: string
  /** VPS: an SSH config name on the orchestrator machine, used when no address is given. */
  alias?: string
  /** VPS: an unencrypted OpenSSH private key. Empty keeps the saved one. */
  privateKey?: string
  clearKey?: boolean
  startAutomatically?: boolean
  kek: string
  now?: string
}

/**
 * Reads what people paste for a server: `ssh -p 2222 ubuntu@host`, `ubuntu@host:2222`,
 * `ubuntu@host` or just `host`. The user defaults to root and the port to 22.
 */
export function parseSshAddress(raw: string): { host: string; user: string; port: number } | { error: string } {
  let text = raw.trim().replace(/^ssh\s+/, "")
  let port: number | null = null
  const flag = text.match(/(?:^|\s)-p\s*(\d{1,5})(?=\s|$)/)
  if (flag) {
    port = Number(flag[1])
    text = text.replace(flag[0], " ").trim()
  }
  if (!text || /\s/.test(text)) return { error: "Use an address like ubuntu@203.0.113.7" }
  let user = "root"
  const at = text.lastIndexOf("@")
  if (at > 0) {
    user = text.slice(0, at)
    text = text.slice(at + 1)
  }
  const hostPort = text.match(/^([^:[\]]+):(\d{1,5})$/) ?? text.match(/^\[([^\]]+)\]:(\d{1,5})$/)
  let host = text
  if (hostPort) {
    host = hostPort[1] ?? text
    port = port ?? Number(hostPort[2])
  }
  host = host.replace(/^\[|\]$/g, "")
  if (!HOST.test(host) || host.startsWith("-")) return { error: "That server address is not valid" }
  if (!USER.test(user)) return { error: "That SSH user name is not valid" }
  const finalPort = port ?? 22
  if (!Number.isInteger(finalPort) || finalPort < 1 || finalPort > 65_535) return { error: "Use a port from 1 to 65535" }
  return { host, user, port: finalPort }
}

/** An OpenSSH or PEM private key without a passphrase: SSH runs non-interactively. */
export function checkPrivateKey(raw: string): string | null {
  const key = raw.trim()
  if (key.length > 16_000) return "That key is too long"
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(key) || !/-----END [A-Z ]*PRIVATE KEY-----/.test(key)) {
    return "Paste the whole private key, from -----BEGIN to -----END"
  }
  if (/ENCRYPTED/.test(key) || /Proc-Type: 4,ENCRYPTED/.test(key)) {
    return "This key has a passphrase. Use a key without one, made for Sayabot only."
  }
  return null
}

function seal(row: Record<string, unknown>, prefix: string, secret: string, kek: string, withLast4: boolean) {
  const sealed = encryptSecret(secret, kek)
  row[`${prefix}_ciphertext`] = sealed.ciphertext
  row[`${prefix}_iv`] = sealed.iv
  row[`${prefix}_tag`] = sealed.tag
  if (withLast4) row[`${prefix}_last4`] = last4(secret)
}

function unseal(row: Record<string, unknown>, prefix: string, withLast4: boolean) {
  row[`${prefix}_ciphertext`] = null
  row[`${prefix}_iv`] = null
  row[`${prefix}_tag`] = null
  if (withLast4) row[`${prefix}_last4`] = null
}

/**
 * The row for one provider's Save. Only that provider's columns are present, so an upsert
 * leaves the other providers as they were. Keys are sealed with MESH_KEK; the row never holds one.
 */
export function computerProviderUpdate(
  input: ComputerProviderInput,
): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const row: Record<string, unknown> = { org_id: input.orgId, updated_at: input.now ?? new Date().toISOString() }
  const token = input.token?.trim() ?? ""
  if (input.provider === "boat" || input.provider === "e2b") {
    const prefix = input.provider
    if (input.clear) {
      unseal(row, prefix, true)
      return { ok: true, row }
    }
    if (!token) return { ok: false, error: "Paste your key first" }
    if (prefix === "boat" && !BOAT_TOKEN.test(token)) return { ok: false, error: "A Boat key starts with boat_ or box_" }
    if (prefix === "e2b" && !E2B_KEY.test(token)) return { ok: false, error: "An E2B key starts with e2b_" }
    seal(row, prefix, token, input.kek, true)
    return { ok: true, row }
  }

  if (input.clear) {
    Object.assign(row, { vps_ssh_alias: null, vps_host: null, vps_user: null, vps_port: null, vps_start_automatically: false })
    unseal(row, "vps_key", false)
    return { ok: true, row }
  }
  row.vps_start_automatically = input.startAutomatically === true
  const address = input.address?.trim() ?? ""
  const alias = (input.alias ?? "").trim().slice(0, 80)
  if (address) {
    const parsed = parseSshAddress(address)
    if ("error" in parsed) return { ok: false, error: parsed.error }
    Object.assign(row, { vps_host: parsed.host, vps_user: parsed.user, vps_port: parsed.port, vps_ssh_alias: null })
  } else if (alias) {
    if (!SSH_NAME.test(alias) || alias.startsWith("-")) return { ok: false, error: "Use the SSH config name of your server" }
    Object.assign(row, { vps_ssh_alias: alias, vps_host: null, vps_user: null, vps_port: null })
    unseal(row, "vps_key", false)
  } else {
    return { ok: false, error: "Add the server's SSH address or SSH config name" }
  }
  const key = input.privateKey?.trim() ?? ""
  if (address && key) {
    const problem = checkPrivateKey(key)
    if (problem) return { ok: false, error: problem }
    seal(row, "vps_key", key, input.kek, false)
  } else if (address && input.clearKey) {
    unseal(row, "vps_key", false)
  }
  return { ok: true, row }
}
