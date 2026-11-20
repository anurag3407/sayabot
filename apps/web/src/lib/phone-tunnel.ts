import { spawn, execFileSync, type ChildProcess } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import {
  loopbackTunnelTarget,
  phoneServerUrl,
  reachOf,
  supabaseUrlForClient,
  type Reach,
} from "./phone-reachable"

const TUNNEL_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
const STATE_FILE = path.join(os.homedir(), ".sayabot", "phone-tunnels.json")

export const CLOUDFLARED_MISSING =
  "Phone pairing needs Cloudflare's cloudflared so a phone can reach Sayabot on this computer. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and try again."

interface TunnelRecord {
  url: string
  pid: number
}

interface TunnelState {
  targets: Record<string, TunnelRecord>
}

const children = new Map<string, ChildProcess>()
const inflight = new Map<string, Promise<string>>()

export function parseCloudflareTunnelUrl(text: string): string | null {
  const match = text.match(TUNNEL_URL)
  return match ? match[0].toLowerCase() : null
}

function readState(): TunnelState {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8")) as Partial<TunnelState>
    const targets = parsed.targets && typeof parsed.targets === "object" ? parsed.targets : {}
    return { targets: targets as Record<string, TunnelRecord> }
  } catch {
    return { targets: {} }
  }
}

function writeState(state: TunnelState): void {
  mkdirSync(path.dirname(STATE_FILE), { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(state))
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function remember(target: string, record: TunnelRecord): void {
  const state = readState()
  state.targets[target] = record
  writeState(state)
}

function forget(target: string): void {
  const state = readState()
  if (!state.targets[target]) return
  delete state.targets[target]
  writeState(state)
}

function liveUrl(target: string): string | null {
  const child = children.get(target)
  if (child && child.exitCode === null && !child.killed && child.pid) {
    const state = readState()
    const saved = state.targets[target]
    if (saved && saved.pid === child.pid) return saved.url
  }
  const saved = readState().targets[target]
  if (saved && pidAlive(saved.pid)) return saved.url
  if (saved) forget(target)
  return null
}

export function findCloudflared(): string | null {
  const fromEnv = process.env.CLOUDFLARED_BIN?.trim()
  const candidates = [
    fromEnv,
    "cloudflared",
    "/opt/homebrew/bin/cloudflared",
    "/usr/local/bin/cloudflared",
  ].filter((value): value is string => Boolean(value))
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 4_000 })
      return bin
    } catch {
      // try the next location
    }
  }
  return null
}

function startCloudflared(target: string): Promise<string> {
  const bin = findCloudflared()
  if (!bin) return Promise.reject(new Error(CLOUDFLARED_MISSING))
  const metricsPort = 20_000 + Math.floor(Math.random() * 20_000)
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        "tunnel",
        "--url",
        target,
        "--no-autoupdate",
        "--metrics",
        `127.0.0.1:${metricsPort}`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    )
    let settled = false
    let buf = ""
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (child.exitCode === null) child.kill()
      reject(error)
    }
    const timer = setTimeout(() => {
      const detail = buf.trim().split("\n").slice(-2).join(" ").slice(0, 180)
      fail(
        new Error(
          detail
            ? `The Cloudflare tunnel did not come up. ${detail}`
            : "The Cloudflare tunnel did not come up. Check that this computer can reach the internet and try again.",
        ),
      )
    }, 25_000)
    const onData = (chunk: Buffer) => {
      buf = (buf + chunk.toString()).slice(-4_000)
      const url = parseCloudflareTunnelUrl(buf)
      if (!url || !child.pid || settled) return
      settled = true
      clearTimeout(timer)
      children.set(target, child)
      remember(target, { url, pid: child.pid })
      console.log(`[phone-tunnel] ${url} -> ${target}`)
      resolve(url)
    }
    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    child.on("error", (error) => fail(error))
    child.on("exit", (code) => {
      if (children.get(target) === child) children.delete(target)
      const saved = readState().targets[target]
      if (saved && child.pid && saved.pid === child.pid) forget(target)
      fail(new Error(`cloudflared exited (${code ?? "signal"}) before the tunnel was ready`))
    })
  })
}

/** One quick tunnel per local origin, reused until cloudflared exits. */
export function ensureQuickTunnel(target: string): Promise<string> {
  const existing = liveUrl(target)
  if (existing) return Promise.resolve(existing)
  const pending = inflight.get(target)
  if (pending) return pending
  const run = startCloudflared(target).finally(() => inflight.delete(target))
  inflight.set(target, run)
  return run
}

/**
 * Address encoded in the QR. A public server is used as-is. A server that only this computer
 * can open is published with a Cloudflare quick tunnel to its loopback port, so a scan reaches
 * this machine from anywhere.
 */
export async function resolvePhoneServer(input: {
  appUrl: string
  requestOrigin: string | null
  lanIp: string | null
  presetPublicUrl?: string | null
  openTunnel?: (target: string) => Promise<string>
}): Promise<{ url: string; reach: Reach }> {
  const preset = input.presetPublicUrl?.trim().replace(/\/+$/, "") ?? ""
  if (preset && reachOf(preset) === "anywhere") return { url: preset, reach: "anywhere" }
  const picked = phoneServerUrl(input.appUrl, input.requestOrigin, input.lanIp)
  if (picked.reach === "anywhere") return picked
  const target =
    loopbackTunnelTarget(picked.url) ??
    loopbackTunnelTarget(input.requestOrigin || input.appUrl)
  if (!target) return picked
  const open = input.openTunnel ?? ensureQuickTunnel
  const url = (await open(target)).replace(/\/+$/, "")
  return { url, reach: "anywhere" }
}

/**
 * Supabase URL the phone should use. A loopback Supabase is published on its own quick tunnel
 * (auth, REST and realtime share that port). Hosted Supabase is unchanged.
 */
export function supabaseUrlForPhone(configured: string, requestHost: string | null): string {
  const target = loopbackTunnelTarget(configured)
  if (target) {
    const live = liveUrl(target)
    if (live) return live
  }
  return supabaseUrlForClient(configured, requestHost)
}
