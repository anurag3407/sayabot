import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { E2BBackend } from "../../src/backends/e2b"

interface FakeInfo {
  sandboxId: string
  state: "running" | "paused"
  metadata: Record<string, string>
}

function fakeSdk() {
  const sandboxes = new Map<string, FakeInfo>()
  const log: string[] = []
  const files = new Map<string, string>()
  let n = 0
  const handle = (info: FakeInfo) => ({
    sandboxId: info.sandboxId,
    files: {
      write: async (path: string, data: string) => {
        files.set(path, data)
      },
    },
    commands: {
      run: async (cmd: string, opts: { onStdout?: (d: string) => void; user?: string }) => {
        log.push(`${opts.user ?? "?"}: ${cmd}`)
        const m = cmd.match(/agentd-cli\.mjs @(\S+)/)
        if (m?.[1]) {
          const req = JSON.parse(files.get(m[1]) ?? "{}")
          opts.onStdout?.('{"t":"out","d":"hi from e2b\\n"}\n')
          opts.onStdout?.(`{"t":"exit","code":0,"op":"${req.op}"}\n`)
        }
        return { exitCode: 0, stdout: "", stderr: "" }
      },
    },
    setTimeout: async () => {},
    pause: async () => {
      info.state = "paused"
      log.push("pause")
    },
  })
  const sdk = {
    Sandbox: {
      list: (opts: { query: { metadata: Record<string, string>; state: string[] } }) => {
        const items = [...sandboxes.values()].filter(
          (s) =>
            opts.query.state.includes(s.state) &&
            Object.entries(opts.query.metadata).every(([k, v]) => s.metadata[k] === v),
        )
        let done = false
        return {
          get hasNext() {
            return !done
          },
          nextItems: async () => {
            done = true
            return items
          },
        }
      },
      create: async (
        _template: string,
        opts: { metadata: Record<string, string>; lifecycle: unknown },
      ) => {
        log.push(`create lifecycle=${JSON.stringify(opts.lifecycle)}`)
        const info: FakeInfo = {
          sandboxId: `sbx-${++n}`,
          state: "running",
          metadata: opts.metadata,
        }
        sandboxes.set(info.sandboxId, info)
        return handle(info)
      },
      connect: async (id: string) => {
        const info = sandboxes.get(id)
        if (!info) throw new Error("not found")
        if (info.state === "paused") log.push("resume")
        info.state = "running"
        return handle(info)
      },
      kill: async (id: string) => sandboxes.delete(id),
    },
  }
  return { sdk, log, files, sandboxes }
}

let bundleDir: string
beforeEach(() => {
  bundleDir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "e2b-bundle-")))
  writeFileSync(join(bundleDir, "agentd.mjs"), "// daemon")
  writeFileSync(join(bundleDir, "agentd-cli.mjs"), "// cli")
})
afterEach(() => rmSync(bundleDir, { recursive: true, force: true }))

function make() {
  const f = fakeSdk()
  const backend = new E2BBackend(f.sdk as never, {
    apiKey: "k",
    template: "base",
    maxRunning: 20,
    idleMs: 600_000,
    bundleDir,
  })
  return { ...f, backend }
}

describe("E2BBackend", () => {
  it("creates one auto-pausing sandbox per agent and installs agentd once", async () => {
    const { backend, log } = make()
    await backend.start("a1", "org1", "standard")
    expect(log[0]).toBe('create lifecycle={"onTimeout":"pause"}')
    expect(log.some((l) => l.startsWith("root: ") && l.includes("typescript@5.9.3"))).toBe(true)
    expect(log.some((l) => l.startsWith("user: pgrep"))).toBe(true)
    await backend.start("a1", "org1", "standard")
    expect(log.filter((l) => l.startsWith("create"))).toHaveLength(1)
  })

  it("streams agentd frames and passes requests through a file, not argv", async () => {
    const { backend, files } = make()
    const ready = await backend.start("a1", "org1", "standard")
    const frames = []
    for await (const f of backend.transport("a1", ready, {
      op: "exec",
      cmd: "cat",
      stdin: "x".repeat(300_000),
    }))
      frames.push(f)
    expect(frames).toEqual([
      { t: "out", d: "hi from e2b\n" },
      { t: "exit", code: 0, op: "exec" },
    ])
    const req = [...files.entries()].find(([k]) => k.startsWith("/tmp/saaya-req-"))
    expect(JSON.parse(req?.[1] ?? "{}").stdin).toHaveLength(300_000)
  })

  it("sleep pauses (memory kept) and the next start resumes the same sandbox", async () => {
    const { backend, log, sandboxes } = make()
    await backend.start("a1", "org1", "standard")
    await backend.sleep("a1")
    expect(await backend.status("a1")).toBe("stopped")
    await backend.start("a1", "org1", "standard")
    expect(log).toContain("pause")
    expect(log).toContain("resume")
    expect(sandboxes.size).toBe(1)
    expect(await backend.listRunning()).toEqual(["a1"])
  })
})
