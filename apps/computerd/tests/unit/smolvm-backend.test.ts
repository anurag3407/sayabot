import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import type { Server } from "node:net"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { startAgentd } from "../../agentd/agentd"
import { SmolvmBackend, type RunResult, type SmolvmRunner } from "../../src/backends/smolvm"
import { EgressBridge } from "../../src/egress-bridge"
import { ComputerLifecycle, loadConfig } from "../../src/lifecycle"

/** Simulates the smolvm CLI; `machine start` brings up a real agentd on the exposed socket path. */
class FakeSmolvm implements SmolvmRunner {
  machines = new Map<string, { state: string; args: string[] }>()
  calls: string[][] = []
  servers = new Map<string, Server>()

  async run(args: string[]): Promise<RunResult> {
    this.calls.push(args)
    const [, sub] = args
    const name = args[args.indexOf("--name") + 1] ?? ""
    const ok = (stdout = ""): RunResult => ({ code: 0, stdout, stderr: "" })
    if (args[0] === "--version") return ok("smolvm 1.34.1")
    if (sub === "ls") {
      return ok(JSON.stringify([...this.machines].map(([n, m]) => ({ name: n, state: m.state }))))
    }
    if (sub === "create") {
      this.machines.set(name, { state: "stopped", args })
      return ok()
    }
    const m = this.machines.get(name)
    if (!m) return { code: 1, stdout: "", stderr: `no such machine: ${name}` }
    if (sub === "start") {
      m.state = "running"
      const expose = m.args[m.args.indexOf("--expose-socket") + 1] ?? ""
      const hostPath = expose.split(":")[1] ?? ""
      this.servers.set(name, startAgentd(hostPath, 0o600))
      return ok()
    }
    if (sub === "stop") {
      m.state = "stopped"
      this.servers.get(name)?.close()
      this.servers.delete(name)
      return ok()
    }
    if (sub === "delete") {
      this.machines.delete(name)
      return ok()
    }
    return { code: 1, stdout: "", stderr: `unexpected: ${args.join(" ")}` }
  }

  // eslint-disable-next-line require-yield
  async *stream(): AsyncGenerator<Buffer, RunResult> {
    return { code: 1, stdout: "", stderr: "exec fallback not expected in this test" }
  }

  closeAll() {
    for (const s of this.servers.values()) s.close()
  }
}

let runDir: string
let fake: FakeSmolvm
let bridge: EgressBridge

beforeEach(() => {
  // Short path: Unix socket paths are capped at ~104 bytes on macOS.
  runDir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "svm-")))
  fake = new FakeSmolvm()
  bridge = new EgressBridge({ host: "127.0.0.1", port: 9 }, (id) => `Basic test-${id}`)
  vi.stubGlobal("fetch", async () => Response.json({ ok: true }))
})
afterEach(() => {
  fake.closeAll()
  bridge.closeAll()
  vi.unstubAllGlobals()
  rmSync(runDir, { recursive: true, force: true })
})

function backend() {
  return new SmolvmBackend(fake, bridge, {
    image: "ghcr.io/example/saaya-computer:latest",
    memMb: 1024,
    cpus: 1,
    runDir,
    grantsEnv: async () => ({ GITHUB_TOKEN: "saaya_ph_placeholder" }),
  })
}

describe("SmolvmBackend", () => {
  it("creates a network-less microVM whose only bridges are agentd and egress sockets", async () => {
    const b = backend()
    const ready = await b.start("a1", "org1", "standard")
    const create = fake.calls.find((c) => c[1] === "create") ?? []
    expect(create).not.toContain("--net")
    expect(create).toContain("--expose-socket")
    expect(create).toContain("--mount-socket")
    expect(create).toContain(`/run/agentd.sock:${join(runDir, "a1", "ctl.sock")}`)
    expect(create).toContain(`${join(runDir, "a1", "egress.sock")}:/run/saaya/egress.sock`)
    expect(create).toContain("HTTP_PROXY=http://127.0.0.1:8080")
    expect(create).toContain("GITHUB_TOKEN=saaya_ph_placeholder")
    // the proxy credential stays on the host: it is never passed into the VM
    expect(create.join(" ")).not.toContain("test-a1")
    expect(ready.ctlSocket).toBe(join(runDir, "a1", "ctl.sock"))
  })

  it("serves agentd calls over the exposed socket", async () => {
    const b = backend()
    const ready = await b.start("a1", "org1", "standard")
    const frames = []
    for await (const f of b.transport("a1", ready, { op: "exec", cmd: "echo vm", cwd: runDir }))
      frames.push(f)
    expect(frames.at(-1)).toMatchObject({ t: "exit", code: 0 })
    expect(await b.listRunning()).toEqual(["a1"])
  })

  it("lifecycle wakes a stopped VM on the next call and keeps its identity", async () => {
    const lc = new ComputerLifecycle(backend(), { ...loadConfig({}), maxRunning: 2 })
    await lc.ensure("a1", "org1")
    await fake.run(["machine", "stop", "--name", "saaya-a1"]) // stopped behind computerd's back
    const frames = await lc.execAgentd("a1", { op: "exec", cmd: "true", cwd: runDir })
    expect(frames.at(-1)).toMatchObject({ t: "exit", code: 0 })
    expect(fake.calls.filter((c) => c[1] === "create")).toHaveLength(1) // woke, not recreated
  })

  it("remove keeps the VM (stopped) unless the disk is deleted", async () => {
    const b = backend()
    await b.start("a1", "org1", "standard")
    await b.remove("a1", false)
    expect(await b.status("a1")).toBe("stopped")
    await b.remove("a1", true)
    expect(await b.status("a1")).toBe("missing")
  })
})
