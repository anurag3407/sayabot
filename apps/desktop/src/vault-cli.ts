import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { DesktopHost } from "./host"
import { findBinary } from "./local-agents"

/**
 * Password lookups that have to run where `op`, `bw` or `pass-cli` is signed in.
 * The command is chosen here from the source name. A job cannot name its own program.
 * Matches apps/orchestrator/src/connectors/passwords.ts passwordArgv.
 */

interface SecretJob {
  id: string
  source: string
  action: string
  query: string
  vault: string | null
  token: string
}

const EXTRA_PATH = ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin")]

function clean(value: string, max: number): string | null {
  const text = value.trim()
  if (!text || text.length > max || text.startsWith("-") || /[\r\n\0]/.test(text)) return null
  return text
}

export function vaultCommand(source: string, action: string, query: string, vault: string | null): { bin: string; args: string[] } | null {
  if (action !== "search" && action !== "read") return null
  const q = clean(query, 200)
  const v = vault ? clean(vault, 80) : null
  if (vault && !v) return null
  if (source === "onepassword") {
    if (action === "search" && !query.trim()) {
      return { bin: "op", args: ["item", "list", "--format", "json", ...(v ? ["--vault", v] : [])] }
    }
    if (!q) return null
    if (action === "search") return { bin: "op", args: ["item", "list", "--format", "json", ...(v ? ["--vault", v] : [])] }
    return { bin: "op", args: ["item", "get", q, "--format", "json", "--reveal", ...(v ? ["--vault", v] : [])] }
  }
  if (!q) return null
  if (source === "bitwarden") {
    if (action === "search") return { bin: "bw", args: ["list", "items", "--search", q] }
    return { bin: "bw", args: ["get", "item", q] }
  }
  if (source === "protonpass") {
    if (action === "search") return { bin: "pass-cli", args: ["item", "list"] }
    return { bin: "pass-cli", args: ["item", "view", q] }
  }
  return null
}

function run(bin: string, args: string[], env: NodeJS.ProcessEnv): Promise<{ ok: boolean; value: unknown; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    const timer = setTimeout(() => child.kill("SIGTERM"), 20_000)
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8")
      if (out.length > 200_000) out = out.slice(0, 200_000)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      err = (err + chunk.toString("utf8")).slice(-400)
    })
    child.on("error", () => {
      clearTimeout(timer)
      resolve({ ok: false, value: null, error: `${bin} isn't installed on this computer.` })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) {
        resolve({ ok: false, value: null, error: err.trim().slice(0, 300) || `${bin} exited ${code}` })
        return
      }
      try {
        resolve({ ok: true, value: out.trim() ? JSON.parse(out) : {} })
      } catch {
        resolve({ ok: true, value: { text: out.trim().slice(0, 4_000) } })
      }
    })
  })
}

export class VaultRunner {
  private busy = false
  constructor(private host: DesktopHost) {}

  async maybeRun(queued: number): Promise<void> {
    if (this.busy || queued <= 0) return
    this.busy = true
    try {
      const claimed = await this.host.post<{ job: SecretJob | null }>("/api/desktop/secrets/claim", {})
      if (claimed?.job) await this.runJob(claimed.job)
    } finally {
      this.busy = false
    }
  }

  private async runJob(job: SecretJob): Promise<void> {
    const cmd = vaultCommand(job.source, job.action, job.query, job.vault)
    if (!cmd) {
      await this.host.post(`/api/desktop/secrets/${job.id}`, { error: "That lookup isn't allowed." })
      return
    }
    const bin = (await findBinary(cmd.bin)) ?? cmd.bin
    if (!fs.existsSync(bin) && bin === cmd.bin) {
      const found = await findBinary(cmd.bin)
      if (!found) {
        await this.host.post(`/api/desktop/secrets/${job.id}`, { error: `${cmd.bin} isn't installed on this computer.` })
        return
      }
    }
    const resolved = (await findBinary(cmd.bin)) ?? cmd.bin
    const env: NodeJS.ProcessEnv = { PATH: [path.dirname(resolved), ...EXTRA_PATH, process.env.PATH ?? ""].join(path.delimiter), HOME: os.homedir() }
    if (job.token && job.token !== "desktop") {
      if (job.source === "onepassword") env.OP_SERVICE_ACCOUNT_TOKEN = job.token
      if (job.source === "bitwarden") env.BW_SESSION = job.token
    }
    const result = await run(resolved, cmd.args, env)
    await this.host.post(`/api/desktop/secrets/${job.id}`, result.ok ? { result: result.value } : { error: result.error })
  }
}
