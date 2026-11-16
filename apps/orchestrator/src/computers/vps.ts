import { spawn } from "node:child_process"
import { mkdirSync } from "node:fs"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { ComputerDecision } from "@sayabot/core"

const SSH_NAME = /^[A-Za-z0-9_.:@-]+$/
const HOST = /^[A-Za-z0-9_.:[\]-]+$/
const USER = /^[A-Za-z_][A-Za-z0-9_.-]{0,31}$/
const IMAGE = /^[A-Za-z0-9._/:@-]+$/
const AGENT = /^[A-Za-z0-9_.-]{1,80}$/
/** Every command's combined output is kept up to this size (file reads come back through it). */
const OUTPUT_CAP = 2 * 1024 * 1024
const DEFAULT_IMAGE = "ubuntu:24.04"

/**
 * How Sayabot reaches the person's server. An SSH config alias uses the orchestrator machine's
 * own ~/.ssh/config and agent; a host target carries the login and a sealed private key that is
 * opened only for one ssh call.
 */
export type VpsTarget =
  | { kind: "alias"; alias: string }
  | { kind: "host"; host: string; user: string; port: number; privateKey: string | null }

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** One container per bot, so files, processes and secrets never mix between bots. */
export function vpsContainerName(agentId: string): string {
  if (!AGENT.test(agentId)) throw new Error("Not a bot id")
  return `sayabot-bot-${agentId}`
}

export function vpsImage(): string {
  const image = process.env.SAYABOT_VPS_IMAGE?.trim() || DEFAULT_IMAGE
  if (!IMAGE.test(image)) throw new Error("SAYABOT_VPS_IMAGE is not a Docker image name")
  return image
}

export function validateVpsTarget(target: VpsTarget): void {
  if (target.kind === "alias") {
    if (!SSH_NAME.test(target.alias) || target.alias.startsWith("-")) {
      throw new Error("Use the SSH config name of your server")
    }
    return
  }
  if (!HOST.test(target.host) || target.host.startsWith("-"))
    throw new Error("That server address is not valid")
  if (!USER.test(target.user)) throw new Error("That SSH user name is not valid")
  if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65_535)
    throw new Error("Use a port from 1 to 65535")
}

function knownHostsFile(): string {
  const dir = process.env.SAYABOT_SSH_DIR?.trim() || join(homedir(), ".sayabot")
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  } catch {}
  return join(dir, "known_hosts")
}

/**
 * The `ssh … destination` prefix. `keyPath` is the temp file holding the private key, when the
 * target has one. A host target pins the server's key on first use (accept-new) in Sayabot's own
 * known_hosts, so a changed host key later is refused.
 */
export function vpsSshPrefix(target: VpsTarget, keyPath?: string | null): string[] {
  validateVpsTarget(target)
  const base = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "LogLevel=ERROR"]
  if (target.kind === "alias") return [...base, target.alias]
  return [
    ...base,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${knownHostsFile()}`,
    ...(keyPath ? ["-i", keyPath, "-o", "IdentitiesOnly=yes"] : []),
    "-p",
    String(target.port),
    `${target.user}@${target.host}`,
  ]
}

function refuseShutdown(remote: string): void {
  if (/\b(shutdown|poweroff|reboot|halt)\b/.test(remote))
    throw new Error("Sayabot does not turn that server off")
}

/**
 * Docker over SSH for this bot's container. Provision and wake start the existing container or
 * create it, pulling the image when the server does not have it. The command never stops the
 * server; the volume keeps /home/bot if the container is created again.
 */
export function vpsDesktopRemote(agentId: string, decision: ComputerDecision): string {
  if (decision.surface !== "vps") throw new Error("Not a VPS")
  const name = vpsContainerName(agentId)
  const remote =
    decision.action === "provision" || decision.action === "wake"
      ? `docker start ${name} >/dev/null 2>&1 || docker run -d --name ${name} --restart unless-stopped ` +
        `-v ${name}:/home/bot -w /home/bot ${vpsImage()} sleep infinity`
      : `docker inspect -f '{{.State.Running}}' ${name}`
  refuseShutdown(remote)
  return remote
}

/** Runs one command inside the bot's container. SSH only starts `docker exec`. */
export function vpsExecRemote(agentId: string, command: string): string {
  if (!command.trim() || command.includes("\0"))
    throw new Error("That command cannot run on the VPS")
  return `docker exec -i -w /home/bot ${vpsContainerName(agentId)} sh -lc ${shellQuote(command)}`
}

/** What the connection check runs: is Docker there and usable by this login. */
export const VPS_CHECK_REMOTE = "docker version --format '{{.Server.Version}}'"

/** `output` is stdout and stderr together, for people; `stdout` alone is what file reads use. */
export interface VpsResult {
  ok: boolean
  output: string
  stdout: string
}

/** Runs one remote command over SSH. Never throws; failures come back as `{ ok: false }`. */
export async function runOnVps(
  target: VpsTarget,
  remote: string,
  timeoutMs = 60_000,
): Promise<VpsResult> {
  let dir: string | null = null
  try {
    let keyPath: string | null = null
    if (target.kind === "host" && target.privateKey) {
      dir = await mkdtemp(join(tmpdir(), "sayabot-ssh-"))
      keyPath = join(dir, "id")
      const key = target.privateKey.endsWith("\n") ? target.privateKey : `${target.privateKey}\n`
      await writeFile(keyPath, key, { mode: 0o600 })
    }
    return await runArgv([...vpsSshPrefix(target, keyPath), remote], timeoutMs)
  } catch (error) {
    return failed(error)
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/** Runs a command on the bot's VPS container. The agent process stays on this machine. */
export function runVpsShell(
  target: VpsTarget,
  agentId: string,
  command: string,
  timeoutMs = 60_000,
): Promise<VpsResult> {
  let remote: string
  try {
    remote = vpsExecRemote(agentId, command)
  } catch (error) {
    return Promise.resolve(failed(error))
  }
  return runOnVps(target, remote, timeoutMs)
}

/** Starts or checks the bot's container for one select_computer decision. */
export function runVpsDesktop(
  target: VpsTarget,
  agentId: string,
  decision: ComputerDecision,
): Promise<VpsResult> {
  let remote: string
  try {
    remote = vpsDesktopRemote(agentId, decision)
  } catch (error) {
    return Promise.resolve(failed(error))
  }
  // A first run may pull the image.
  return runOnVps(target, remote, 300_000)
}

function failed(error: unknown): VpsResult {
  return {
    ok: false,
    output: error instanceof Error ? error.message : "VPS command failed",
    stdout: "",
  }
}

function runArgv(argv: string[], timeoutMs: number): Promise<VpsResult> {
  const bin = argv[0]
  if (!bin) return Promise.resolve({ ok: false, output: "Missing command", stdout: "" })
  return new Promise((resolve) => {
    const child = spawn(bin, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < OUTPUT_CAP)
        stdout = (stdout + chunk.toString("utf8")).slice(0, OUTPUT_CAP)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 64_000) stderr = (stderr + chunk.toString("utf8")).slice(0, 64_000)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: error.message, stdout })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      const both = stderr ? (stdout ? `${stdout}\n${stderr}` : stderr) : stdout
      resolve({
        ok: code === 0 && !timedOut,
        output: timedOut ? `${both}\n(timed out after ${timeoutMs / 1000}s)` : both,
        stdout,
      })
    })
  })
}
