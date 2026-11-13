import { existsSync } from "node:fs"
import { idleComputers, Mutex, pickEvictionVictim, type ComputerUsage } from "./capacity"
import { ProxyIdentity } from "./identity"
import type { AgentdFrame } from "./transport"
import {
  ComputerGoneError,
  type BackendKind,
  type ComputerBackend,
  type ComputerProfile,
  type Ready,
} from "./backends/types"

export type { ComputerProfile } from "./backends/types"
type ComputerState = "none" | "starting" | "running" | "stopped" | "error"

export interface ComputerdConfig {
  backend: BackendKind | "auto"
  orchestratorUrl: string
  internalSecret: string
  egressAdminUrl: string
  /** Where host-side egress bridges (smolvm) forward to. */
  egressProxyUrl: string
  imageTag: string
  network: string
  memMb: number
  cpus: number
  /** Fixed cap on concurrently running computers, or "auto" to size from host memory. */
  maxRunning: number | "auto"
  memFraction: number
  idleMs: number
  evictGraceMs: number
  admitTimeoutMs: number
  /** Where computerd sees the agentd control volume (Docker; unset = socket fast path off). */
  ctlRoot?: string
  ctlVolume: string
  dockerRuntime: "runc" | "runsc" | "auto"
  smolvmBin: string
  smolvmImage?: string
  smolvmRunDir?: string
  storageGb?: number
  e2bApiKey?: string
  e2bTemplate: string
  e2bMaxRunning: number
  agentdBundleDir?: string
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v)
  return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : fallback
}

function inDocker(): boolean {
  return existsSync("/.dockerenv")
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ComputerdConfig {
  const max = env.COMPUTER_MAX_RUNNING
  const backend = env.COMPUTER_BACKEND
  const runtime = env.COMPUTER_DOCKER_RUNTIME ?? (env.RUNSC_ENABLED === "true" ? "runsc" : "runc")
  return {
    backend: backend === "docker" || backend === "smolvm" || backend === "e2b" ? backend : "auto",
    orchestratorUrl: env.ORCHESTRATOR_URL || "http://orchestrator:4000",
    internalSecret: env.ORCHESTRATOR_INTERNAL_SECRET || "",
    // In compose, egress is a service name; run on a laptop (`pnpm dev`) it is localhost.
    egressAdminUrl:
      env.EGRESS_ADMIN_URL || (inDocker() ? "http://egress:8081" : "http://127.0.0.1:8081"),
    egressProxyUrl:
      env.EGRESS_PROXY_URL || (inDocker() ? "http://egress:8080" : "http://127.0.0.1:8080"),
    imageTag: env.COMPUTE_IMAGE_TAG || "latest",
    network: env.COMPUTER_NETWORK || "botnet",
    memMb: num(env.COMPUTER_MEM_MB, 1024),
    cpus: num(env.COMPUTER_CPUS, 1),
    maxRunning: !max || max === "auto" ? "auto" : Math.max(1, num(max, 4)),
    memFraction: Math.min(0.95, Math.max(0.05, num(env.COMPUTER_MEM_FRACTION, 0.6))),
    idleMs: num(env.COMPUTER_IDLE_MS, 10 * 60_000),
    evictGraceMs: num(env.COMPUTER_EVICT_GRACE_MS, 60_000),
    admitTimeoutMs: num(env.COMPUTER_ADMIT_TIMEOUT_MS, 60_000),
    ctlRoot: env.AGENTD_CTL_ROOT || undefined,
    ctlVolume: env.AGENTD_CTL_VOLUME || "saaya-agentd",
    dockerRuntime: runtime === "runsc" || runtime === "auto" ? runtime : "runc",
    smolvmBin: env.SMOLVM_BIN || "smolvm",
    smolvmImage: env.SMOLVM_IMAGE || undefined,
    smolvmRunDir: env.SMOLVM_RUN_DIR || undefined,
    storageGb: env.COMPUTER_DISK_GB ? Math.max(1, num(env.COMPUTER_DISK_GB, 5)) : undefined,
    e2bApiKey: env.E2B_API_KEY || undefined,
    e2bTemplate: env.E2B_TEMPLATE || "base",
    e2bMaxRunning: Math.max(1, num(env.E2B_MAX_RUNNING, 20)),
    agentdBundleDir: env.AGENTD_BUNDLE_DIR || undefined,
  }
}

/** All computers are busy and none became free before the admission deadline. */
export class CapacityError extends Error {}
/** Kept for callers: the backend (Docker, smolvm, E2B) is not reachable. */
export { BackendUnavailableError as DockerUnavailableError } from "./backends/types"

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * One computer per agent, on whichever backend this host supports. The lifecycle
 * decides *when* computers run — a capacity cap, LRU eviction of idle computers,
 * idle sleep, lazy wake — and the backend decides *how*.
 */
export class ComputerLifecycle {
  private ready = new Map<string, Ready>()
  private usage = new Map<string, ComputerUsage>()
  private booting = new Map<string, Promise<{ status: string; ip?: string }>>()
  private reserved = new Set<string>()
  private admission = new Mutex()
  private maxRunningCache: number | undefined

  constructor(
    readonly backend: ComputerBackend,
    private config: ComputerdConfig = loadConfig(),
    private now: () => number = Date.now,
    private identity = new ProxyIdentity(),
  ) {}

  // ── Orchestrator / egress notifications ───────────────────────────────────

  private async notify(
    agentId: string,
    status: ComputerState,
    extra: {
      containerId?: string | null
      ip?: string | null
      error?: string | null
      proxySecretHash?: string
    } = {},
  ) {
    try {
      await fetch(`${this.config.orchestratorUrl}/internal/computer/state`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-secret": this.config.internalSecret,
        },
        body: JSON.stringify({
          agentId,
          status,
          containerId: extra.containerId,
          containerIp: extra.ip,
          error: extra.error,
          proxySecretHash: extra.proxySecretHash,
        }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch (e) {
      console.warn(`[computerd] failed to notify orchestrator of agent ${agentId} state`, e)
    }
  }

  /**
   * Egress identifies Docker computers by container IP and caches that mapping. Sleeping
   * and waking computers means IPs get reused by different agents, so the old mapping
   * must be dropped before the new container can make a request — otherwise its
   * traffic could be attributed to (and use the secret grants of) the previous owner.
   */
  private async forgetEgressIdentity(ip: string | undefined) {
    if (!ip || !this.backend.ipIdentity) return
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(`${this.config.egressAdminUrl}/identity/forget`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-secret": this.config.internalSecret,
          },
          body: JSON.stringify({ containerIp: ip }),
          signal: AbortSignal.timeout(1_500),
        })
        if (res.ok) return
      } catch {}
      await sleep(200 * (attempt + 1))
    }
    console.warn(
      `[computerd] could not reset egress identity for ${ip}; egress cache may be stale for up to 30s`,
    )
  }

  // ── Capacity ──────────────────────────────────────────────────────────────

  private touch(agentId: string, inflightDelta = 0) {
    const u = this.usage.get(agentId) ?? { agentId, lastUsedAt: this.now(), inflight: 0 }
    u.lastUsedAt = this.now()
    u.inflight = Math.max(0, u.inflight + inflightDelta)
    this.usage.set(agentId, u)
  }

  async maxRunning(): Promise<number> {
    if (this.config.maxRunning !== "auto") return this.config.maxRunning
    if (this.maxRunningCache !== undefined) return this.maxRunningCache
    try {
      this.maxRunningCache = await this.backend.autoMaxRunning(
        this.config.memMb,
        this.config.memFraction,
      )
    } catch {
      return 4
    }
    return this.maxRunningCache
  }

  /** Running computers according to the backend, with our usage data merged in. */
  private async runningUsage(): Promise<ComputerUsage[]> {
    const running = await this.backend.listRunning()
    return running.map((agentId) => {
      // A computer we have never seen (e.g. computerd restarted) counts as just used.
      if (!this.usage.has(agentId))
        this.usage.set(agentId, { agentId, lastUsedAt: this.now(), inflight: 0 })
      return this.usage.get(agentId) as ComputerUsage
    })
  }

  /** Waits for a free slot, evicting the least recently used idle computer if needed. */
  private async admit(agentId: string): Promise<void> {
    const deadline = this.now() + this.config.admitTimeoutMs
    while (true) {
      const release = await this.admission.lock()
      try {
        const max = await this.maxRunning()
        // Computers still booting are counted once, via `reserved`.
        const others = (await this.runningUsage()).filter(
          (u) => u.agentId !== agentId && !this.reserved.has(u.agentId),
        )
        if (others.length + this.reserved.size < max) {
          this.reserved.add(agentId)
          return
        }
        const victim = pickEvictionVictim(others, this.now(), this.config.evictGraceMs)
        if (victim) {
          console.log(
            `[computerd] at capacity (${max}); sleeping least recently used computer ${victim.agentId}`,
          )
          await this.sleepComputer(victim.agentId, 5)
          this.reserved.add(agentId)
          return
        }
      } finally {
        release()
      }
      if (this.now() >= deadline) {
        throw new CapacityError(
          `All ${await this.maxRunning()} computers are busy. Raise COMPUTER_MAX_RUNNING or try again shortly.`,
        )
      }
      await sleep(1_000)
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async ensure(
    agentId: string,
    orgId: string,
    profile: ComputerProfile = "standard",
  ): Promise<{ status: string; ip?: string }> {
    const known = this.ready.get(agentId)
    if (known) {
      this.touch(agentId)
      return { status: "running", ip: known.ip }
    }
    const existing = this.booting.get(agentId)
    if (existing) return existing
    const promise = this.boot(agentId, orgId, profile).finally(() => {
      this.booting.delete(agentId)
      this.reserved.delete(agentId)
    })
    this.booting.set(agentId, promise)
    return promise
  }

  private async boot(
    agentId: string,
    orgId: string,
    profile: ComputerProfile,
  ): Promise<{ status: string; ip?: string }> {
    const status = await this.backend.status(agentId)
    if (status === "running") {
      const ready = await this.backend.attach(agentId)
      this.ready.set(agentId, ready)
      this.touch(agentId)
      return { status: "running", ip: ready.ip }
    }

    await this.admit(agentId)
    await this.notify(agentId, "starting")
    let ready: Ready
    try {
      ready = await this.backend.start(agentId, orgId, profile)
    } catch (e) {
      await this.notify(agentId, "error", { error: (e as Error).message })
      throw e
    }
    await this.forgetEgressIdentity(ready.ip)
    this.ready.set(agentId, ready)
    this.touch(agentId)
    await this.notify(agentId, "running", {
      containerId: ready.id,
      ip: ready.ip,
      // Lets egress identify this agent by proxy credential (smolvm's only egress path).
      proxySecretHash: this.identity.secretHash(agentId),
    })
    return { status: "running", ip: ready.ip }
  }

  // ── agentd RPC ────────────────────────────────────────────────────────────

  /** Streams agentd frames for one request, waking the computer first if it is asleep. */
  async *streamAgentd(agentId: string, payload: AgentdFrame): AsyncGenerator<AgentdFrame> {
    for (let attempt = 0; ; attempt++) {
      await this.ensure(agentId, "system")
      const target = this.ready.get(agentId) ?? {}
      let yielded = false
      this.touch(agentId, +1)
      try {
        for await (const frame of this.backend.transport(agentId, target, payload)) {
          yielded = true
          yield frame
        }
        return
      } catch (e) {
        // The computer stopped behind our back (manual stop, OOM, host reboot): wake it and retry once.
        if (e instanceof ComputerGoneError && !yielded && attempt === 0) {
          this.ready.delete(agentId)
          continue
        }
        throw e
      } finally {
        this.touch(agentId, -1)
      }
    }
  }

  async execAgentd(agentId: string, payload: AgentdFrame): Promise<AgentdFrame[]> {
    const frames: AgentdFrame[] = []
    for await (const f of this.streamAgentd(agentId, payload)) frames.push(f)
    return frames
  }

  // ── Sleep / stop / remove ─────────────────────────────────────────────────

  /** Stops (or pauses) the computer but keeps its disk; the next call wakes it. */
  private async sleepComputer(agentId: string, timeoutSec = 10) {
    const ip = this.ready.get(agentId)?.ip
    this.ready.delete(agentId)
    this.usage.delete(agentId)
    await this.backend.sleep(agentId, timeoutSec)
    await this.forgetEgressIdentity(ip)
    await this.notify(agentId, "stopped")
  }

  async stop(agentId: string): Promise<void> {
    await this.sleepComputer(agentId).catch((e) =>
      console.warn(`[computerd] stop ${agentId} failed`, e),
    )
  }

  async remove(agentId: string, deleteDisk = false): Promise<void> {
    const ip = this.ready.get(agentId)?.ip
    this.ready.delete(agentId)
    this.usage.delete(agentId)
    await this.backend
      .remove(agentId, deleteDisk)
      .catch((e) => console.warn(`[computerd] remove ${agentId} failed`, e))
    await this.forgetEgressIdentity(ip)
    await this.notify(agentId, "none")
  }

  /** Puts computers to sleep after `idleMs` without a call. Run periodically. */
  async sweepIdle(): Promise<string[]> {
    if (this.config.idleMs <= 0) return []
    const running = await this.runningUsage()
    const idle = idleComputers(running, this.now(), this.config.idleMs)
    for (const u of idle) {
      console.log(`[computerd] computer for ${u.agentId} idle; going to sleep`)
      await this.sleepComputer(u.agentId).catch((e) =>
        console.warn(`[computerd] idle stop ${u.agentId} failed`, e),
      )
    }
    return idle.map((u) => u.agentId)
  }

  async capacity() {
    const running = await this.runningUsage()
    return {
      backend: this.backend.kind,
      ...this.backend.describe(),
      maxRunning: await this.maxRunning(),
      running: running.length,
      idleMs: this.config.idleMs,
      computers: running.map((u) => ({
        agentId: u.agentId,
        inflight: u.inflight,
        idleForMs: Math.max(0, this.now() - u.lastUsedAt),
        transport: this.ready.get(u.agentId)?.ctlSocket ? "socket" : "exec",
      })),
    }
  }
}
