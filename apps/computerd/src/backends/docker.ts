import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { autoMaxRunning } from "../capacity"
import { DockerApiError, DockerClient, DockerStreamDemuxer, type DockerMount } from "../docker"
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

export interface DockerBackendConfig {
  imageTag: string
  network: string
  memMb: number
  cpus: number
  /** runc (default), runsc (gVisor: a syscall sandbox that needs no KVM) or auto. */
  runtime: "runc" | "runsc" | "auto"
  ctlRoot?: string
  ctlVolume: string
  orchestratorGrantsEnv: (agentId: string) => Promise<Record<string, string>>
}

const CTL_MOUNT = "/run/agentd-ctl"
const AGENT_LABEL = "saaya.agent"

export const containerName = (agentId: string) => `bot-${agentId}`
export const volumeName = (agentId: string) => `saaya-bot-${agentId}`

type Inspect = {
  Id?: string
  State?: { Running?: boolean }
  Mounts?: Array<{ Destination?: string }>
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }>; IPAddress?: string }
} | null

function isConnRefused(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } }
  const code = err?.code ?? err?.cause?.code
  return code === "ECONNREFUSED" || code === "ENOENT" || code === "EACCES"
}

async function waitForSocket(path: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (statSync(path).isSocket()) return
    } catch {}
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** One container + one named volume per agent, on the internal `botnet` network. */
export class DockerBackend implements ComputerBackend {
  readonly kind = "docker" as const
  readonly ipIdentity = true
  private networkChecked = false
  private ctlSupported: boolean | undefined
  private runtimeResolved: "runc" | "runsc" | undefined

  constructor(
    private docker: DockerClient,
    private config: DockerBackendConfig,
  ) {}

  private async inspect(agentId: string): Promise<Inspect> {
    try {
      return await this.docker.inspectContainer(containerName(agentId))
    } catch (e) {
      if (isConnRefused(e)) {
        throw new BackendUnavailableError(
          "docker daemon is not reachable — start Docker Desktop/OrbStack, or set COMPUTER_BACKEND",
        )
      }
      throw e
    }
  }

  async autoMaxRunning(memMb: number, fraction: number): Promise<number> {
    const info = await this.docker.info()
    return autoMaxRunning(info.MemTotal ?? 0, memMb, fraction)
  }

  async listRunning(): Promise<string[]> {
    const running = await this.docker.listContainers(AGENT_LABEL)
    return running.flatMap((c) => (c.Labels?.[AGENT_LABEL] ? [c.Labels[AGENT_LABEL]] : []))
  }

  async status(agentId: string): Promise<ComputerStatus> {
    const inspect = await this.inspect(agentId)
    if (!inspect) return "missing"
    return inspect.State?.Running ? "running" : "stopped"
  }

  async attach(agentId: string): Promise<Ready> {
    return this.readyFrom(agentId, await this.inspect(agentId))
  }

  /** gVisor only when asked for (or found, in auto mode): it disables the socket fast path. */
  async runtime(): Promise<"runc" | "runsc"> {
    if (this.runtimeResolved) return this.runtimeResolved
    let r: "runc" | "runsc" = this.config.runtime === "runsc" ? "runsc" : "runc"
    if (this.config.runtime === "auto") {
      const info = await this.docker.info().catch(() => ({ Runtimes: undefined }))
      r = info.Runtimes && "runsc" in info.Runtimes ? "runsc" : "runc"
    }
    this.runtimeResolved = r
    return r
  }

  async start(agentId: string, orgId: string, profile: ComputerProfile): Promise<Ready> {
    const name = containerName(agentId)
    const inspect = await this.inspect(agentId)
    if (inspect?.State?.Running) return this.readyFrom(agentId, inspect)
    if (!inspect) {
      await this.ensureNetwork()
      await this.create(agentId, orgId, profile)
    } else if (inspect.Mounts?.some((m) => m.Destination === CTL_MOUNT)) {
      // A volume subpath must exist before start (the control volume may have been recreated).
      this.prepareCtlDir(agentId)
    }
    await this.docker.startContainer(name)
    const ready = this.readyFrom(agentId, await this.docker.inspectContainer(name))
    if (ready.ctlSocket) await waitForSocket(ready.ctlSocket, 5_000)
    return ready
  }

  private readyFrom(agentId: string, inspect: Inspect): Ready {
    const net = this.config.network
    const ip =
      inspect?.NetworkSettings?.Networks?.[net]?.IPAddress ||
      inspect?.NetworkSettings?.IPAddress ||
      undefined
    const hasCtl = inspect?.Mounts?.some((m) => m.Destination === CTL_MOUNT) ?? false
    return { id: inspect?.Id, ip, ctlSocket: hasCtl ? this.ctlSocketPath(agentId) : undefined }
  }

  private async ensureNetwork() {
    if (this.networkChecked) return
    // Compose creates botnet on a VPS; on a local computer create it on first use.
    if (!(await this.docker.inspectNetwork(this.config.network))) {
      await this.docker.createNetwork(this.config.network, true)
    }
    this.networkChecked = true
  }

  /**
   * The fast path needs a volume subpath mount (Docker Engine API >= 1.45) and a control
   * root computerd can see. It is skipped — falling back to docker exec — when computerd
   * runs directly on a laptop, under gVisor, or on an older Docker.
   */
  async ctlEnabled(): Promise<boolean> {
    if (this.ctlSupported !== undefined) return this.ctlSupported
    let ok = false
    try {
      const root = this.config.ctlRoot
      if (
        root &&
        (await this.runtime()) === "runc" &&
        existsSync(root) &&
        statSync(root).isDirectory()
      ) {
        const v = (await this.docker.version()).ApiVersion ?? "0"
        const [maj = 0, min = 0] = v.split(".").map(Number)
        ok = maj > 1 || (maj === 1 && min >= 45)
      }
    } catch {}
    this.ctlSupported = ok
    if (!ok)
      console.log("[computerd] agentd socket fast path disabled; using docker exec transport")
    return ok
  }

  private ctlSocketPath(agentId: string): string | undefined {
    return this.config.ctlRoot
      ? join(this.config.ctlRoot, containerName(agentId), "agentd.sock")
      : undefined
  }

  private prepareCtlDir(agentId: string): DockerMount | null {
    if (!this.config.ctlRoot) return null
    const dir = join(this.config.ctlRoot, containerName(agentId))
    mkdirSync(dir, { recursive: true })
    // agentd runs as uid 10001 and computerd has no CAP_CHOWN; only this container mounts the dir.
    chmodSync(dir, 0o777)
    return {
      Type: "volume",
      Source: this.config.ctlVolume,
      Target: CTL_MOUNT,
      VolumeOptions: { Subpath: containerName(agentId) },
    }
  }

  private async create(agentId: string, orgId: string, profile: ComputerProfile) {
    const grantsEnv = await this.config.orchestratorGrantsEnv(agentId)
    const ctlMount = (await this.ctlEnabled()) ? this.prepareCtlDir(agentId) : null
    const runtime = await this.runtime()
    const env = [
      "NODE_ENV=production",
      "HTTP_PROXY=http://egress:8080",
      "HTTPS_PROXY=http://egress:8080",
      "http_proxy=http://egress:8080",
      "https_proxy=http://egress:8080",
      'NO_PROXY=""',
      ...(ctlMount ? [`AGENTD_CTL_SOCK=${CTL_MOUNT}/agentd.sock`] : []),
      ...Object.entries(grantsEnv).map(([k, v]) => `${k}=${v}`),
    ]
    const tag = this.config.imageTag
    const memBytes = this.config.memMb * 1024 * 1024
    return this.docker.createContainer({
      name: containerName(agentId),
      Image: profile === "browser" ? `saaya/computer:${tag}-browser` : `saaya/computer:${tag}`,
      // Start unprivileged: with CapDrop ALL a root agentd cannot setuid down to bot.
      User: "10001:10001",
      Env: env,
      Labels: { [AGENT_LABEL]: agentId, "saaya.org": orgId, "saaya.profile": profile },
      HostConfig: {
        Runtime: runtime === "runsc" ? "runsc" : undefined,
        NetworkMode: this.config.network,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "size=512m,mode=1777", "/run": "size=16m,mode=1777" },
        Binds: [
          `${volumeName(agentId)}:/home/bot:rw`,
          `saaya-egress-ca:/usr/local/share/ca-certificates/saaya:ro`,
        ],
        Mounts: ctlMount ? [ctlMount] : undefined,
        NanoCpus: Math.round(this.config.cpus * 1e9),
        Memory: memBytes,
        MemorySwap: memBytes,
        PidsLimit: 512,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        RestartPolicy: { Name: "no" },
      },
    })
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
        // Socket not up yet (agentd still booting) or unusable — fall through to docker exec.
      }
    }
    yield* this.dockerExec(agentId, payload)
  }

  private async *dockerExec(agentId: string, payload: AgentdFrame): AsyncGenerator<AgentdFrame> {
    let exec: { Id: string }
    try {
      exec = await this.docker.execCreate(containerName(agentId), [
        "/opt/agentd/agentd-cli",
        ...argvChunks(payload),
      ])
    } catch (e) {
      if (e instanceof DockerApiError && (e.status === 409 || e.status === 404)) {
        throw new ComputerGoneError(e.message)
      }
      throw e
    }
    const res = await this.docker.execStart(exec.Id)
    if (!res.ok || !res.body)
      throw new DockerApiError(`docker exec start failed (${res.status})`, res.status)
    const demux = new DockerStreamDemuxer()
    const parser = new NdjsonParser()
    let stderr = ""
    const reader = res.body.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const parts = demux.push(value)
        for (const e of parts.stderr) stderr += e.toString("utf8")
        for (const chunk of parts.stdout) {
          for (const frame of parser.push(chunk)) {
            yield frame
            if (isFinalFrame(payload.op, frame)) return
          }
        }
      }
      for (const frame of [...parser.push(demux.flush()), ...parser.end()]) {
        yield frame
        if (isFinalFrame(payload.op, frame)) return
      }
      throw new Error(
        `agentd returned no complete response${stderr ? `: ${stderr.trim().slice(0, 500)}` : ""}`,
      )
    } finally {
      await reader.cancel().catch(() => {})
    }
  }

  async sleep(agentId: string, timeoutSec: number): Promise<void> {
    try {
      await this.docker.stopContainer(containerName(agentId), timeoutSec)
    } catch (e) {
      if (!(e instanceof DockerApiError && (e.status === 304 || e.status === 404))) throw e
    }
  }

  async remove(agentId: string, deleteDisk: boolean): Promise<void> {
    try {
      await this.docker.removeContainer(containerName(agentId), true)
    } catch {}
    if (deleteDisk) {
      try {
        await this.docker.removeVolume(volumeName(agentId))
      } catch {}
    }
    if (this.config.ctlRoot) {
      rmSync(join(this.config.ctlRoot, containerName(agentId)), { recursive: true, force: true })
    }
  }

  describe() {
    return {
      isolation: this.runtimeResolved === "runsc" ? "container + gVisor" : "container",
      fastPath: this.ctlSupported ?? null,
      egress: "botnet → egress (identified by container IP)",
    }
  }
}
