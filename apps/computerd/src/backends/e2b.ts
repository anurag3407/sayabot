import { randomUUID } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { Sandbox as E2BSandbox } from "e2b"
import { isFinalFrame, NdjsonParser, type AgentdFrame } from "../transport"
import {
  BackendUnavailableError,
  ComputerGoneError,
  type ComputerBackend,
  type ComputerProfile,
  type ComputerStatus,
  type Ready,
} from "./types"

export interface E2BBackendConfig {
  apiKey: string
  template: string
  maxRunning: number
  /** E2B pauses the sandbox itself (memory + disk kept) after this long without a call. */
  idleMs: number
  bundleDir: string
}

type SandboxModule = typeof import("e2b")

const AGENTD_DIR = "/opt/saaya-agentd"
const AGENTD_SOCK = "/tmp/saaya-agentd.sock"
const ENV = { AGENTD_SOCK, BOT_HOME: "/home/bot" }

export function defaultBundleDir(): string {
  return fileURLToPath(new URL("../../dist/agentd/", import.meta.url))
}

/** Push-to-pull bridge so E2B's onStdout callback can feed an async generator. */
class ChunkQueue {
  private items: string[] = []
  private wake: (() => void) | null = null
  private done = false
  push(s: string) {
    this.items.push(s)
    this.wake?.()
  }
  end() {
    this.done = true
    this.wake?.()
  }
  async *drain(): AsyncGenerator<string> {
    while (true) {
      while (this.items.length) yield this.items.shift() as string
      if (this.done) return
      await new Promise<void>((r) => (this.wake = r))
      this.wake = null
    }
  }
}

/**
 * One persistent E2B cloud sandbox per agent, for hosts that cannot run computers
 * themselves (no KVM, little RAM, or no Docker). Isolation is E2B's Firecracker microVM.
 * Limitation: the sandbox reaches the internet directly, not through Saaya egress, so
 * `$SECRET{...}` placeholders are not substituted inside it.
 */
export class E2BBackend implements ComputerBackend {
  readonly kind = "e2b" as const
  readonly ipIdentity = false
  private sandboxes = new Map<string, E2BSandbox>()
  private touchedAt = new Map<string, number>()

  constructor(
    private sdk: SandboxModule,
    private config: E2BBackendConfig,
  ) {}

  private opts() {
    return { apiKey: this.config.apiKey }
  }

  private async find(agentId: string) {
    const pager = this.sdk.Sandbox.list({
      ...this.opts(),
      query: { metadata: { saayaAgent: agentId }, state: ["running", "paused"] },
    })
    const items = await pager.nextItems()
    return items[0] ?? null
  }

  async autoMaxRunning(): Promise<number> {
    return this.config.maxRunning
  }

  async listRunning(): Promise<string[]> {
    const pager = this.sdk.Sandbox.list({
      ...this.opts(),
      query: { metadata: { saayaApp: "computerd" }, state: ["running"] },
    })
    const ids: string[] = []
    while (pager.hasNext) {
      for (const s of await pager.nextItems())
        if (s.metadata?.saayaAgent) ids.push(s.metadata.saayaAgent)
    }
    return ids
  }

  async status(agentId: string): Promise<ComputerStatus> {
    const info = await this.find(agentId)
    if (!info) return "missing"
    return info.state === "running" ? "running" : "stopped"
  }

  async attach(agentId: string): Promise<Ready> {
    const sbx = await this.connect(agentId)
    return { id: sbx.sandboxId }
  }

  private async connect(agentId: string): Promise<E2BSandbox> {
    const cached = this.sandboxes.get(agentId)
    if (cached) return cached
    const info = await this.find(agentId)
    if (!info) throw new ComputerGoneError(`no E2B sandbox for ${agentId}`)
    // connect() resumes a paused sandbox, memory included.
    const sbx = await this.sdk.Sandbox.connect(info.sandboxId, {
      ...this.opts(),
      timeoutMs: this.config.idleMs,
    })
    this.sandboxes.set(agentId, sbx)
    return sbx
  }

  async start(agentId: string, orgId: string, _profile: ComputerProfile): Promise<Ready> {
    let sbx: E2BSandbox
    const existing = await this.find(agentId)
    if (existing) {
      this.sandboxes.delete(agentId)
      sbx = await this.connect(agentId)
    } else {
      sbx = await this.sdk.Sandbox.create(this.config.template, {
        ...this.opts(),
        metadata: { saayaApp: "computerd", saayaAgent: agentId, saayaOrg: orgId },
        timeoutMs: this.config.idleMs,
        lifecycle: { onTimeout: "pause" },
      })
      this.sandboxes.set(agentId, sbx)
      await this.bootstrap(sbx)
    }
    await this.ensureDaemon(sbx)
    return { id: sbx.sandboxId }
  }

  /** First boot only: install the bundled agentd and the /home/bot layout agents expect. */
  private async bootstrap(sbx: E2BSandbox) {
    const dir = this.config.bundleDir
    for (const f of ["agentd.mjs", "agentd-cli.mjs"]) {
      const path = `${dir}/${f}`
      if (!existsSync(path)) {
        throw new BackendUnavailableError(
          `agentd bundle missing at ${path}; run: pnpm --filter @sayabot/computerd build:agentd`,
        )
      }
      await sbx.files.write(`/tmp/${f}`, readFileSync(path, "utf8"))
    }
    await sbx.commands.run(
      [
        `mkdir -p ${AGENTD_DIR} /home/bot`,
        `mv /tmp/agentd.mjs /tmp/agentd-cli.mjs ${AGENTD_DIR}/`,
        "chown -R user:user /home/bot",
        // code intelligence loads the TypeScript compiler; keep in step with apps/computerd.
        `npm install --prefix ${AGENTD_DIR} --no-save --no-audit --no-fund typescript@5.9.3 >/dev/null`,
      ].join(" && "),
      { user: "root", timeoutMs: 300_000 },
    )
  }

  /** After a resume the daemon is usually still running (memory was kept); start it if not. */
  private async ensureDaemon(sbx: E2BSandbox) {
    await sbx.commands.run(
      `pgrep -f '${AGENTD_DIR}/agentd.mjs' >/dev/null || (nohup node ${AGENTD_DIR}/agentd.mjs >/tmp/saaya-agentd.log 2>&1 &); ` +
        `for i in $(seq 50); do [ -S ${AGENTD_SOCK} ] && exit 0; sleep 0.1; done; exit 1`,
      { envs: ENV, user: "user", timeoutMs: 30_000 },
    )
  }

  async *transport(
    agentId: string,
    _ready: Ready,
    payload: AgentdFrame,
  ): AsyncGenerator<AgentdFrame> {
    let sbx: E2BSandbox
    try {
      sbx = await this.connect(agentId)
    } catch (e) {
      this.sandboxes.delete(agentId)
      throw e instanceof ComputerGoneError ? e : new ComputerGoneError((e as Error).message)
    }
    await this.keepAlive(agentId, sbx)
    // Large requests (file writes) go through a file: argv strings are capped at 128 KiB.
    const reqPath = `/tmp/saaya-req-${randomUUID()}.json`
    await sbx.files.write(reqPath, JSON.stringify(payload))
    const queue = new ChunkQueue()
    const run = sbx.commands
      .run(`node ${AGENTD_DIR}/agentd-cli.mjs @${reqPath}`, {
        envs: ENV,
        user: "user",
        timeoutMs: (typeof payload.timeoutMs === "number" ? payload.timeoutMs : 60_000) + 30_000,
        onStdout: (d) => queue.push(d),
      })
      .then(
        (r) => ({ ok: true as const, stderr: r.stderr }),
        (e: { stderr?: string; message?: string }) => ({
          ok: false as const,
          stderr: e.stderr ?? e.message ?? "",
        }),
      )
      .finally(() => queue.end())
    const parser = new NdjsonParser()
    for await (const chunk of queue.drain()) {
      for (const frame of parser.push(chunk)) {
        yield frame
        if (isFinalFrame(payload.op, frame)) return
      }
    }
    for (const frame of parser.end()) {
      yield frame
      if (isFinalFrame(payload.op, frame)) return
    }
    const result = await run
    if (/ENOENT|ECONNREFUSED/.test(result.stderr)) {
      // The daemon died (e.g. a filesystem-only resume); restart it so the retry succeeds.
      await this.ensureDaemon(sbx).catch(() => {})
    }
    throw new Error(`agentd returned no complete response: ${result.stderr.trim().slice(0, 500)}`)
  }

  /** Each call pushes E2B's own idle timer back, at most once a minute. */
  private async keepAlive(agentId: string, sbx: E2BSandbox) {
    const last = this.touchedAt.get(agentId) ?? 0
    if (Date.now() - last < 60_000) return
    this.touchedAt.set(agentId, Date.now())
    await sbx.setTimeout(this.config.idleMs).catch(() => {})
  }

  async sleep(agentId: string): Promise<void> {
    const info = await this.find(agentId)
    this.sandboxes.delete(agentId)
    if (!info || info.state !== "running") return
    const sbx = await this.sdk.Sandbox.connect(info.sandboxId, this.opts())
    await sbx.pause()
  }

  async remove(agentId: string, deleteDisk: boolean): Promise<void> {
    if (!deleteDisk) return this.sleep(agentId)
    const info = await this.find(agentId)
    this.sandboxes.delete(agentId)
    if (info) await this.sdk.Sandbox.kill(info.sandboxId, this.opts())
  }

  describe() {
    return {
      isolation: "E2B cloud microVM (Firecracker)",
      fastPath: false,
      egress: "direct internet (Saaya egress and $SECRET placeholders unavailable)",
      template: this.config.template,
    }
  }
}
