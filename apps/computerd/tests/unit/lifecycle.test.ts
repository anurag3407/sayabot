import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DockerBackend } from "../../src/backends/docker"
import { DockerApiError, type DockerClient, type DockerContainerConfig } from "../../src/docker"
import {
  CapacityError,
  ComputerLifecycle,
  loadConfig,
  type ComputerdConfig,
} from "../../src/lifecycle"

interface FakeContainer {
  Id: string
  running: boolean
  ip?: string
  config: DockerContainerConfig
}

function muxFrame(payload: string): Uint8Array {
  const body = Buffer.from(payload)
  const header = Buffer.alloc(8)
  header[0] = 1
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

class FakeDocker {
  containers = new Map<string, FakeContainer>()
  networks = new Set<string>()
  stopped: string[] = []
  execFailures = 0
  private nextIp = 2

  async inspectContainer(name: string) {
    const c = this.containers.get(name)
    if (!c) return null
    return {
      Id: c.Id,
      State: { Running: c.running },
      NetworkSettings: { Networks: { botnet: { IPAddress: c.ip } } },
      Mounts: [],
    }
  }
  async listContainers() {
    return [...this.containers.entries()]
      .filter(([, c]) => c.running)
      .map(([name, c]) => ({
        Id: c.Id,
        Names: [`/${name}`],
        Labels: c.config.Labels ?? {},
        State: "running",
      }))
  }
  async createContainer(config: DockerContainerConfig) {
    const c = { Id: `id-${config.name}`, running: false, config }
    this.containers.set(config.name, c)
    return { Id: c.Id }
  }
  async startContainer(name: string) {
    const c = this.containers.get(name)
    if (!c) throw new DockerApiError("no such container", 404)
    c.running = true
    c.ip = `10.9.0.${this.nextIp++}`
  }
  async stopContainer(name: string) {
    const c = this.containers.get(name)
    if (c) c.running = false
    this.stopped.push(name)
  }
  async removeContainer(name: string) {
    this.containers.delete(name)
  }
  async removeVolume() {}
  async inspectNetwork(name: string) {
    return this.networks.has(name) ? { Id: name } : null
  }
  async createNetwork(name: string) {
    this.networks.add(name)
  }
  async info() {
    return { MemTotal: 4 * 1024 ** 3 }
  }
  async version() {
    return { ApiVersion: "1.47" }
  }
  async execCreate(name: string) {
    if (this.execFailures > 0) {
      this.execFailures--
      throw new DockerApiError(`container ${name} is not running`, 409)
    }
    return { Id: "exec-1" }
  }
  async execStart() {
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(muxFrame('{"t":"out","d":"hi\\n"}\n'))
          c.enqueue(muxFrame('{"t":"exit","code":0,"durationMs":3}\n'))
          c.close()
        },
      }),
    )
  }
  async ping() {
    return true
  }
}

let clock = 1_000_000
let calls: Array<{ url: string; body: Record<string, unknown> }>

function make(overrides: Partial<ComputerdConfig> = {}) {
  const docker = new FakeDocker()
  const config = { ...loadConfig({}), ctlRoot: undefined, maxRunning: 2, ...overrides }
  const backend = new DockerBackend(docker as unknown as DockerClient, {
    imageTag: config.imageTag,
    network: config.network,
    memMb: config.memMb,
    cpus: config.cpus,
    runtime: config.dockerRuntime,
    ctlRoot: config.ctlRoot,
    ctlVolume: config.ctlVolume,
    orchestratorGrantsEnv: async () => ({}),
  })
  const lc = new ComputerLifecycle(backend, config, () => clock)
  return { docker, lc }
}

beforeEach(() => {
  clock = 1_000_000
  calls = []
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : {} })
    return Response.json({ ok: true })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe("ComputerLifecycle", () => {
  it("creates one hardened container per agent, on its own disk, as the bot user", async () => {
    const { docker, lc } = make()
    await expect(lc.ensure("a1", "org1")).resolves.toMatchObject({
      status: "running",
      ip: "10.9.0.2",
    })
    const c = docker.containers.get("bot-a1")
    expect(c?.config).toMatchObject({
      User: "10001:10001",
      Labels: { "saaya.agent": "a1", "saaya.org": "org1" },
      HostConfig: { NetworkMode: "botnet", ReadonlyRootfs: true, CapDrop: ["ALL"] },
    })
    expect(c?.config.HostConfig?.Binds).toContain("saaya-bot-a1:/home/bot:rw")
    expect(docker.networks.has("botnet")).toBe(true) // local computer: network created on demand
  })

  it("resets the egress IP mapping before announcing the computer as running", async () => {
    const { lc } = make()
    await lc.ensure("a1", "org1")
    const forget = calls.findIndex((c) => c.url.endsWith("/identity/forget"))
    const running = calls.findIndex(
      (c) => c.url.endsWith("/internal/computer/state") && c.body.status === "running",
    )
    expect(forget).toBeGreaterThanOrEqual(0)
    expect(calls[forget]?.body).toEqual({ containerIp: "10.9.0.2" })
    expect(forget).toBeLessThan(running)
  })

  it("reports a proxy credential hash (never the secret) when a computer starts", async () => {
    const { lc } = make()
    await lc.ensure("a1", "org1")
    const running = calls.find(
      (c) => c.url.endsWith("/internal/computer/state") && c.body.status === "running",
    )
    expect(running?.body.proxySecretHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(calls)).not.toContain("saaya-egress:")
  })

  it("at capacity, sleeps the least recently used idle computer to admit a new one", async () => {
    const { docker, lc } = make({ maxRunning: 2, evictGraceMs: 60_000 })
    await lc.ensure("a1", "o")
    clock += 10_000
    await lc.ensure("a2", "o")
    clock += 120_000
    await lc.ensure("a3", "o")
    expect(docker.stopped).toEqual(["bot-a1"])
    expect(docker.containers.get("bot-a1")?.running).toBe(false)
    expect(docker.containers.get("bot-a3")?.running).toBe(true)
    // a1 keeps its container and disk; it simply wakes up next time
    clock += 120_000
    await lc.ensure("a1", "o")
    expect(docker.stopped).toEqual(["bot-a1", "bot-a2"])
  })

  it("never evicts a computer used within the grace window; fails with CapacityError instead", async () => {
    const { lc } = make({ maxRunning: 1, evictGraceMs: 60_000, admitTimeoutMs: 0 })
    await lc.ensure("a1", "o")
    clock += 5_000
    await expect(lc.ensure("a2", "o")).rejects.toBeInstanceOf(CapacityError)
  })

  it("idle sweep sleeps only computers past the idle threshold", async () => {
    const { docker, lc } = make({ maxRunning: 5, idleMs: 600_000 })
    await lc.ensure("old", "o")
    clock += 500_000
    await lc.ensure("new", "o")
    clock += 200_000
    await expect(lc.sweepIdle()).resolves.toEqual(["old"])
    expect(docker.stopped).toEqual(["bot-old"])
  })

  it("falls back to docker exec and demultiplexes its stream", async () => {
    const { lc } = make()
    await expect(lc.execAgentd("a1", { op: "exec", cmd: "echo hi" })).resolves.toEqual([
      { t: "out", d: "hi\n" },
      { t: "exit", code: 0, durationMs: 3 },
    ])
  })

  it("wakes a computer that was stopped behind its back and retries once", async () => {
    const { docker, lc } = make()
    await lc.ensure("a1", "o")
    docker.containers.get("bot-a1")!.running = false
    docker.execFailures = 1
    const frames = await lc.execAgentd("a1", { op: "exec", cmd: "true" })
    expect(frames.at(-1)).toMatchObject({ t: "exit", code: 0 })
    expect(docker.containers.get("bot-a1")?.running).toBe(true)
  })
})
