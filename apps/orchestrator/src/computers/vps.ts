import { spawn } from "node:child_process"
import type { ComputerDecision } from "@sayabot/core"

const SSH_NAME = /^[A-Za-z0-9_.:@-]+$/
const CONTAINER = "sayabot-desktop"

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Docker over SSH for the desktop container. The command never stops the server.
 * The volume keeps the workspace if the container is created again.
 */
export function vpsDesktopArgv(alias: string, decision: ComputerDecision): string[] {
  if (!SSH_NAME.test(alias)) throw new Error("Use the SSH config name of your server")
  if (decision.surface !== "vps") throw new Error("Not a VPS")
  const docker =
    decision.action === "provision"
      ? ["docker", "run", "-d", "--name", CONTAINER, "--restart", "unless-stopped", "-v", `${CONTAINER}:/home/bot`, "sayabot-desktop:latest"]
      : ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER]
  const argv = ["ssh", "-o", "BatchMode=yes", alias, docker.join(" ")]
  const flat = argv.join(" ")
  if (/\b(shutdown|poweroff|reboot|halt)\b/.test(flat)) throw new Error("Sayabot does not turn that server off")
  return argv
}

/**
 * Runs one command inside the desktop container. SSH only starts `docker exec`.
 * The server itself is not shut down, rebooted, or halted.
 */
export function vpsExecArgv(alias: string, command: string): string[] {
  if (!SSH_NAME.test(alias)) throw new Error("Use the SSH config name of your server")
  if (!command.trim() || command.includes("\0") || command.includes("\n")) throw new Error("That command cannot run on the VPS")
  const remote = `docker exec -i ${CONTAINER} sh -lc ${shellQuote(command)}`
  return ["ssh", "-o", "BatchMode=yes", alias, remote]
}

/** Runs a command on the VPS desktop. The agent process stays on this machine. */
export function runVpsShell(alias: string, command: string, timeoutMs = 60_000): Promise<{ ok: boolean; output: string }> {
  let argv: string[]
  try {
    argv = vpsExecArgv(alias, command)
  } catch (error) {
    return Promise.resolve({ ok: false, output: error instanceof Error ? error.message : "VPS command failed" })
  }
  return runArgv(argv, timeoutMs)
}

function runArgv(argv: string[], timeoutMs: number): Promise<{ ok: boolean; output: string }> {
  const bin = argv[0]
  if (!bin) return Promise.resolve({ ok: false, output: "Missing command" })
  return new Promise((resolve) => {
    const child = spawn(bin, argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] })
    let output = ""
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.stdout.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(0, 500)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(0, 500)
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      resolve({ ok: false, output: error.message })
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, output })
    })
  })
}

/** Runs the desktop container command. The SSH name is the server the person saved. */
export function runVpsDesktop(alias: string, decision: ComputerDecision): Promise<{ ok: boolean; output: string }> {
  let argv: string[]
  try {
    argv = vpsDesktopArgv(alias, decision)
  } catch (error) {
    return Promise.resolve({ ok: false, output: error instanceof Error ? error.message : "VPS command failed" })
  }
  return runArgv(argv, 60_000)
}
