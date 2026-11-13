import { assertSafeEgressHost } from "@sayabot/core/server"
import { spawn } from "node:child_process"
import { runSecretOnDesktop } from "./desktop-bridge"

export type PasswordSource = "onepassword" | "bitwarden" | "protonpass"

export interface PasswordConfig {
  authMode?: "api" | "computer"
  connectUrl?: string
  hostId?: string
  region?: "us" | "eu"
  allowedVaults?: string[]
}

/** Names and ids only. A leading dash would become a CLI flag. */
export function assertSecretQuery(query: string): string {
  const value = query.trim()
  if (value.length < 1 || value.length > 200) throw new Error("Give an item name or id (200 characters or less)")
  if (value.startsWith("-") || /[\r\n\0]/.test(value)) throw new Error("That item name isn't allowed")
  return value
}

export function assertVaultName(vault?: string): string | undefined {
  if (!vault) return undefined
  const value = vault.trim()
  if (!value) return undefined
  if (value.length > 80 || value.startsWith("-") || /[\r\n\0]/.test(value)) throw new Error("That vault name isn't allowed")
  return value
}

export function passwordArgv(
  source: PasswordSource,
  action: "search" | "read",
  query: string,
  vault?: string,
): { bin: string; args: string[] } {
  const q = action === "search" && source === "onepassword" && !query.trim() ? "" : assertSecretQuery(query)
  const v = assertVaultName(vault)
  if (source === "onepassword") {
    if (action === "search") {
      return { bin: "op", args: ["item", "list", "--format", "json", ...(v ? ["--vault", v] : [])] }
    }
    return { bin: "op", args: ["item", "get", q, "--format", "json", "--reveal", ...(v ? ["--vault", v] : [])] }
  }
  if (source === "bitwarden") {
    if (action === "search") return { bin: "bw", args: ["list", "items", "--search", q || assertSecretQuery(query)] }
    return { bin: "bw", args: ["get", "item", q] }
  }
  if (action === "search") return { bin: "pass-cli", args: ["item", "list"] }
  return { bin: "pass-cli", args: ["item", "view", q] }
}

export function summarizeItems(value: unknown): { id: string; title: string }[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)
      ? ((value as { data: unknown[] }).data)
      : []
  return list.slice(0, 40).flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const row = item as Record<string, unknown>
    const id = String(row.id ?? row.uuid ?? "").slice(0, 80)
    const title = String(row.title ?? row.name ?? row.key ?? "Untitled").slice(0, 160)
    return [{ id, title }]
  })
}

/** One item, without attachments or other bulky fields. Values stay, because a read is the point. */
export function summarizeItem(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return { text: String(value ?? "").slice(0, 4_000) }
  const row = value as Record<string, unknown>
  const fields = Array.isArray(row.fields)
    ? row.fields.slice(0, 30).flatMap((field) => {
        if (!field || typeof field !== "object") return []
        const f = field as Record<string, unknown>
        return [{ label: String(f.label ?? f.id ?? f.purpose ?? "field").slice(0, 80), value: String(f.value ?? "").slice(0, 2_000) }]
      })
    : undefined
  const login = row.login && typeof row.login === "object" ? (row.login as Record<string, unknown>) : undefined
  return {
    id: row.id ?? row.uuid,
    title: row.title ?? row.name ?? row.key,
    ...(fields ? { fields } : {}),
    ...(login ? { username: login.username, password: login.password, uris: login.uris } : {}),
    ...(typeof row.value === "string" ? { value: row.value.slice(0, 4_000) } : {}),
    ...(typeof row.notes === "string" ? { notes: row.notes.slice(0, 2_000) } : {}),
    ...(typeof row.note === "string" ? { note: row.note.slice(0, 2_000) } : {}),
  }
}

async function httpJson(url: string, token: string): Promise<unknown> {
  const parsed = new URL(url)
  if (parsed.protocol !== "https:") throw new Error("Password manager APIs must use HTTPS")
  await assertSafeEgressHost(parsed.hostname)
  const res = await fetch(parsed, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } })
  const body = await res.text()
  if (!res.ok) throw new Error(`Password manager returned HTTP ${res.status}`)
  try {
    return body ? JSON.parse(body) : {}
  } catch {
    throw new Error("Password manager returned a non-JSON body")
  }
}

function runCli(bin: string, args: string[], env: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let out = ""
    let err = ""
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8")
      if (out.length > 200_000) out = out.slice(0, 200_000)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString("utf8")).slice(-1_000)
    })
    const onAbort = () => child.kill("SIGTERM")
    signal?.addEventListener("abort", onAbort, { once: true })
    child.on("error", (error) => {
      signal?.removeEventListener("abort", onAbort)
      reject(error)
    })
    child.on("close", (code) => {
      signal?.removeEventListener("abort", onAbort)
      if (code !== 0) {
        reject(new Error(err.trim().slice(0, 300) || `${bin} exited ${code}`))
        return
      }
      try {
        resolve(out.trim() ? JSON.parse(out) : {})
      } catch {
        resolve({ text: out.trim().slice(0, 4_000) })
      }
    })
  })
}

function finish(action: "search" | "read", query: string, value: unknown): unknown {
  if (action === "read") return summarizeItem(value)
  const needle = query.trim().toLowerCase()
  const items = summarizeItems(value).filter((item) => !needle || `${item.title} ${item.id}`.toLowerCase().includes(needle))
  return { items }
}

export async function queryPasswordManager(args: {
  source: PasswordSource
  action: "search" | "read"
  query: string
  vault?: string
  token: string
  config: PasswordConfig
  orgId: string
  connectorId: string
  signal?: AbortSignal
}): Promise<unknown> {
  const vault = assertVaultName(args.vault)
  if (args.config.allowedVaults?.length && vault && !args.config.allowedVaults.includes(vault)) {
    throw new Error(`Vault "${vault}" is outside this agent's allowed vaults`)
  }
  const mode = args.config.authMode ?? (args.config.connectUrl ? "api" : "computer")

  if (args.source === "onepassword" && mode === "api" && args.config.connectUrl) {
    const base = args.config.connectUrl.replace(/\/+$/, "")
    if (args.action === "search") {
      const vaults = await httpJson(`${base}/v1/vaults`, args.token)
      const lists = summarizeItems(vaults)
      const found = []
      for (const one of lists.slice(0, 8)) {
        if (!one.id) continue
        const items = await httpJson(`${base}/v1/vaults/${encodeURIComponent(one.id)}/items`, args.token)
        found.push(...summarizeItems(items))
      }
      return finish("search", args.query, found)
    }
    if (!vault) throw new Error("1Password Connect needs a vault id as well as the item id")
    const item = await httpJson(`${base}/v1/vaults/${encodeURIComponent(vault)}/items/${encodeURIComponent(assertSecretQuery(args.query))}`, args.token)
    return summarizeItem(item)
  }

  if (args.source === "bitwarden" && mode === "api") {
    const host = args.config.region === "eu" ? "https://api.bitwarden.eu" : "https://api.bitwarden.com"
    if (args.action === "search") {
      const data = await httpJson(`${host}/public/secrets`, args.token)
      return finish("search", args.query, data)
    }
    const item = await httpJson(`${host}/public/secrets/${encodeURIComponent(assertSecretQuery(args.query))}`, args.token)
    return summarizeItem(item)
  }

  const argv = passwordArgv(args.source, args.action, args.query, vault)
  const env: Record<string, string> = {}
  if (args.token && args.token !== "desktop") {
    if (args.source === "onepassword") env.OP_SERVICE_ACCOUNT_TOKEN = args.token
    if (args.source === "bitwarden") env.BW_SESSION = args.token
  }
  try {
    const value = await runCli(argv.bin, argv.args, env, args.signal)
    return finish(args.action, args.query, value)
  } catch (error) {
    const missing = error instanceof Error && "code" in error && (error as { code?: string }).code === "ENOENT"
    if (!missing && mode !== "computer") throw error
    try {
      const value = await runSecretOnDesktop({
        orgId: args.orgId,
        connectorId: args.connectorId,
        source: args.source,
        action: args.action,
        query: args.action === "search" && args.source === "onepassword" && !args.query.trim() ? "" : assertSecretQuery(args.query),
        vault,
        hostId: args.config.hostId,
        signal: args.signal,
      })
      return finish(args.action, args.query, value)
    } catch (desktopError) {
      if (missing) throw desktopError
      throw error
    }
  }
}
