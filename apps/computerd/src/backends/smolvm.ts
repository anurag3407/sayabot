import { spawn } from "node:child_process"
import { accessSync, constants as fsConstants, existsSync, mkdirSync, rmSync } from "node:fs"
import { homedir, totalmem } from "node:os"
import { join } from "node:path"
import { autoMaxRunning } from "../capacity"
import type { EgressBridge } from "../egress-bridge"
import {
  isFinalFrame,
  NdjsonParser,
  responseTimeoutMs,
  socketRequest,
  TransportUnavailableError,
  type AgentdFrame,
} from "../transport"
import {
  argvChunks,
  BackendUnavailableError,
  ComputerGoneError,
  type ComputerBackend,
  type ComputerProfile,
  type ComputerStatus,
  type Ready,
} from "./types"

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

/** Runs the smolvm CLI. Swappable so the backend can be tested without a hypervisor. */
export interface SmolvmRunner {
  run(args: string[], timeoutMs?: number): Promise<RunResult>
  stream(args: string[]): AsyncGenerator<Buffer, RunResult>
}

export function spawnRunner(bin: string, env: NodeJS.ProcessEnv = process.env): SmolvmRunner {
  return {
    run(args, timeoutMs = 120_000) {
      return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] })
        let stdout = ""
        let stderr = ""
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs)
        child.stdout.on("data", (d) => (stdout += d))
        child.stderr.on("data", (d) => (stderr += d))
        child.on("error", (e) => {
          clearTimeout(timer)
          reject(e)
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          resolve({ code: code ?? 1, stdout, stderr })
        })
      })
    },
    async *stream(args) {
      const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] })
      let stderr = ""
      child.stderr.on("data", (d) => (stderr += d))
      const exited = new Promise<number>((resolve) => child.on("close", (c) => resolve(c ?? 1)))
      try {
        for await (const chunk of child.stdout) yield chunk as Buffer
        return { code: await exited, stdout: "", stderr }
      } finally {
        if (child.exitCode === null) child.kill("SIGKILL")
      }
    },
  }
}

export interface SmolvmBackendConfig {
  image: string
  memMb: number
  cpus: number
  storageGb?: number
  /** Short directory for per-computer sockets (Unix socket paths are capped at ~104 bytes on macOS). */
  runDir: string
  grantsEnv: (agentId: string) => Promise<Record<string, string>>
}

export const machineName = (agentId: string) => `saaya-${agentId}`
const GUEST_EGRESS_SOCK = "/run/saaya/egress.sock"
const GUEST_AGENTD_SOCK = "/run/agentd.sock"

export function defaultRunDir(): string {
  return join(homedir(), ".saaya", "vm")
}

/**
 * One smolvm microVM (own kernel, own disk) per agent, created with **no network**.
 * Two socket bridges are its only contact with the host:
 *   - agentd's socket is exposed to the host — the ~1 ms control fast path;
 *   - a per-agent egress socket is mounted in — the only way out, which computerd
 *     forwards to Saaya egress with that agent's proxy credential added on the host.
 * Sleeping stops the VM; its disk stays and the next call boots it again.
 */
export class SmolvmBackend implements ComputerBackend {
  readonly kind = "smolvm" as const
  readonly ipIdentity = false

  constructor(
    private runner: SmolvmRunner,
    private egress: EgressBridge,
    private config: SmolvmBackendConfig,
  ) {}

  private dir(agentId: string) {
    return join(this.config.runDir, agentId)
  }
  private ctlPath(agentId: string) {
    return join(this.dir(agentId), "ctl.sock")
  }
  private egressPath(agentId: string) {
    return join(this.dir(agentId), "egress.sock")
  }

  private async cli(args: string[], timeoutMs?: number): Promise<RunResult> {
    let res: RunResult
    try {
      res = await this.runner.run(args, timeoutMs)
    } catch (e) {
      throw new BackendUnavailableError(`smolvm is not runnable: ${(e as Error).message}`)
    }
    return res
  }

  private async must(args: string[], timeoutMs?: number): Promise<string> {
    const res = await this.cli(args, timeoutMs)
    if (res.code !== 0) {
      throw new Error(
        `smolvm ${args.slice(0, 2).join(" ")} failed: ${(res.stderr || res.stdout).trim().slice(0, 800)}`,
      )
    }
    return res.stdout
  }

  private async machines(): Promise<Array<{ name: string; state: string }>> {
    const out = await this.must(["machine", "ls", "--json"], 30_000)
    const parsed: unknown = JSON.parse(out || "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((m) =>
      m && typeof m === "object" && typeof m.name === "string"
        ? [{ name: m.name as string, state: String((m as { state?: unknown }).state ?? "") }]
        : [],
    )
  }

  async autoMaxRunning(memMb: number, fraction: number): Promise<number> {
    // Guest memory is elastic (virtio balloon): an idle VM commits far less than its cap.
    return autoMaxRunning(totalmem() * 2, memMb, fraction)
  }

  async listRunning(): Promise<string[]> {
    return (await this.machines())
      .filter((m) => m.name.startsWith("saaya-") && m.state === "running")
      .map((m) => m.name.slice("saaya-".length))
  }

  async status(agentId: string): Promise<ComputerStatus> {
    const m = (await this.machines()).find((x) => x.name === machineName(agentId))
    if (!m) return "missing"
    return m.state === "running" ? "running" : "stopped"
  }

  async attach(agentId: string): Promise<Ready> {
    // computerd may have restarted while the VM kept running: bring the egress listener back.
    await this.egress.listen(agentId, this.egressPath(agentId))
    return { id: machineName(agentId), ctlSocket: this.ctlPath(agentId) }
  }

  async start(agentId: string, orgId: string, _profile: ComputerProfile): Promise<Ready> {
    const name = machineName(agentId)
    mkdirSync(this.dir(agentId), { recursive: true, mode: 0o700 })
    if (this.ctlPath(agentId).length > 100) {
      console.warn(
        `[computerd] ${this.ctlPath(agentId)} is near the Unix socket path limit; set SMOLVM_RUN_DIR shorter`,
      )
    }
    // The mounted host socket must exist before the VM boots.
    await this.egress.listen(agentId, this.egressPath(agentId))
    const status = await this.status(agentId)
    if (status === "missing") await this.create(agentId, orgId)
    if (status !== "running") await this.must(["machine", "start", "--name", name], 180_000)
    await this.waitForAgentd(this.ctlPath(agentId), 30_000)
    return { id: name, ctlSocket: this.ctlPath(agentId) }
  }

  private async create(agentId: string, orgId: string) {
    const grants = await this.config.grantsEnv(agentId)
    const env: Record<string, string> = {
      NODE_ENV: "production",
      // The VM has no network; agentd relays this port to the mounted egress socket.
      HTTP_PROXY: "http://127.0.0.1:8080",
      HTTPS_PROXY: "http://127.0.0.1:8080",
      http_proxy: "http://127.0.0.1:8080",
      https_proxy: "http://127.0.0.1:8080",
      NO_PROXY: "",
      AGENTD_EGRESS_SOCK: GUEST_EGRESS_SOCK,
      ...grants,
    }
    const args = [
      "machine",
      "create",
      "--name",
      machineName(agentId),
      "--label",
      `saaya.agent=${agentId}`,
      "--label",
      `saaya.org=${orgId}`,
      "--image",
      this.config.image,
      "--cpus",
      String(Math.max(1, Math.round(this.config.cpus))),
      "--mem",
      String(this.config.memMb),
      ...(this.config.storageGb ? ["--storage", String(this.config.storageGb)] : []),
      "--expose-socket",
      `${GUEST_AGENTD_SOCK}:${this.ctlPath(agentId)}`,
      "--mount-socket",
      `${this.egressPath(agentId)}:${GUEST_EGRESS_SOCK}`,
      ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    ]
    // First create pulls/unpacks the image; later ones reuse the host cache.
    await this.must(args, 600_000)
  }

  /** The host end of the exposed socket can appear before agentd listens inside; wait for an answer. */
  private async waitForAgentd(ctl: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs
    let last: unknown
    while (Date.now() < deadline) {
      if (existsSync(ctl)) {
        try {
          for await (const _ of socketRequest(ctl, { op: "stats" }, 3_000)) return
        } catch (e) {
          last = e
        }
      }
      await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`agentd did not come up in the VM: ${(last as Error)?.message ?? "no socket"}`)
  }

  async *transport(
    agentId: string,
    ready: Ready,
    payload: AgentdFrame,
  ): AsyncGenerator<AgentdFrame> {
    if (ready.ctlSocket) {
      try {
        yield* socketRequest(ready.ctlSocket, payload, responseTimeoutMs(payload))
        return
      } catch (e) {
        if (!(e instanceof TransportUnavailableError)) throw e
        // Without the socket either the VM stopped (let the lifecycle wake it, with
        // admission control) or the bridge is unhealthy (fall back to the CLI).
        if ((await this.status(agentId)) !== "running") throw new ComputerGoneError(e.message)
      }
    }
    yield* this.cliExec(agentId, payload)
  }

  private async *cliExec(agentId: string, payload: AgentdFrame): AsyncGenerator<AgentdFrame> {
    const parser = new NdjsonParser()
    const it = this.runner.stream([
      "machine",
      "exec",
      "--name",
      machineName(agentId),
      "--",
      "/opt/agentd/agentd-cli",
      ...argvChunks(payload),
    ])
    while (true) {
      const next = await it.next()
      if (next.done) {
        for (const frame of parser.end()) {
          yield frame
          if (isFinalFrame(payload.op, frame)) return
        }
        const err = next.value.stderr.trim().slice(0, 500)
        if (next.value.code !== 0 && /not running|stopped|no such machine/i.test(err)) {
          throw new ComputerGoneError(err)
        }
        throw new Error(`agentd returned no complete response${err ? `: ${err}` : ""}`)
      }
      for (const frame of parser.push(next.value)) {
        yield frame
        if (isFinalFrame(payload.op, frame)) {
          await it.return({ code: 0, stdout: "", stderr: "" })
          return
        }
      }
    }
  }

  async sleep(agentId: string, timeoutSec: number): Promise<void> {
    const res = await this.cli(
      ["machine", "stop", "--name", machineName(agentId), "-t", String(timeoutSec)],
      60_000,
    )
    if (
      res.code !== 0 &&
      !/not running|stopped|no such machine|not found/i.test(res.stderr + res.stdout)
    ) {
      throw new Error(`smolvm machine stop failed: ${res.stderr.trim().slice(0, 500)}`)
    }
  }

  /**
   * A VM's disk belongs to the machine, so "remove but keep files" just stops it;
   * deleting the disk deletes the machine.
   */
  async remove(agentId: string, deleteDisk: boolean): Promise<void> {
    if (!deleteDisk) return this.sleep(agentId, 10)
    await this.cli(["machine", "delete", "--name", machineName(agentId), "--force"], 120_000)
    this.egress.close(this.egressPath(agentId))
    rmSync(this.dir(agentId), { recursive: true, force: true })
  }

  describe() {
    return {
      isolation: "microVM (own kernel)",
      fastPath: true,
      egress: "no network; per-agent socket → egress (proxy credential added by computerd)",
      image: this.config.image,
    }
  }
}

function kvmAccessible(): boolean {
  try {
    accessSync("/dev/kvm", fsConstants.R_OK | fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

/** smolvm needs Hypervisor.framework (Apple silicon) or a usable /dev/kvm. */
export async function smolvmUsable(
  runner: SmolvmRunner,
): Promise<{ ok: boolean; reason?: string }> {
  const hv =
    (process.platform === "darwin" && process.arch === "arm64") ||
    (process.platform === "linux" && kvmAccessible())
  if (!hv)
    return { ok: false, reason: "no hardware virtualization (needs /dev/kvm or Apple silicon)" }
  try {
    const res = await runner.run(["--version"], 10_000)
    return res.code === 0
      ? { ok: true }
      : { ok: false, reason: res.stderr.trim() || "smolvm --version failed" }
  } catch (e) {
    return { ok: false, reason: `smolvm not installed (${(e as Error).message})` }
  }
}
