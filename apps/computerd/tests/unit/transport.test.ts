import { mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import type { Server } from "node:net"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startAgentd } from "../../agentd/agentd"
import { detectDockerUrl, DockerStreamDemuxer } from "../../src/docker"
import {
  NdjsonParser,
  socketRequest,
  TransportUnavailableError,
  type AgentdFrame,
} from "../../src/transport"

function muxFrame(stream: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload)
  const header = Buffer.alloc(8)
  header[0] = stream
  header.writeUInt32BE(body.length, 4)
  return Buffer.concat([header, body])
}

describe("DockerStreamDemuxer", () => {
  it("strips the 8-byte multiplex headers, even when frames split across chunks", () => {
    const wire = Buffer.concat([
      muxFrame(1, '{"t":"out","d":"hi"}\n'),
      muxFrame(2, "warn\n"),
      muxFrame(1, '{"t":"exit","code":0}\n'),
    ])
    const d = new DockerStreamDemuxer()
    const out: string[] = []
    const err: string[] = []
    for (let i = 0; i < wire.length; i += 5) {
      const parts = d.push(wire.subarray(i, i + 5))
      out.push(...parts.stdout.map(String))
      err.push(...parts.stderr.map(String))
    }
    const frames = new NdjsonParser().push(out.join(""))
    expect(frames).toEqual([
      { t: "out", d: "hi" },
      { t: "exit", code: 0 },
    ])
    expect(err.join("")).toBe("warn\n")
  })

  it("passes a raw (tty / pre-demuxed) stream through untouched", () => {
    const d = new DockerStreamDemuxer()
    const parts = d.push(Buffer.from('{"ok":true}\n'))
    expect(parts.stdout.map(String).join("")).toBe('{"ok":true}\n')
  })
})

describe("detectDockerUrl", () => {
  it("prefers DOCKER_HOST, then the standard socket, then local desktop runtimes", () => {
    expect(detectDockerUrl({ DOCKER_HOST: "tcp://x:2375" }, () => true, "/h")).toBe("tcp://x:2375")
    expect(detectDockerUrl({}, (p) => p === "/var/run/docker.sock", "/h")).toBe(
      "unix:///var/run/docker.sock",
    )
    expect(detectDockerUrl({}, (p) => p === "/h/.orbstack/run/docker.sock", "/h")).toBe(
      "unix:///h/.orbstack/run/docker.sock",
    )
    expect(detectDockerUrl({}, () => false, "/h")).toBe("http://docker-proxy:2375")
  })
})

describe("socketRequest against a real agentd", () => {
  let dir: string
  let sock: string
  let server: Server

  beforeAll(async () => {
    dir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "agentd-sock-")))
    sock = join(dir, "agentd.sock")
    server = startAgentd(sock, 0o666)
    await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())))
  })
  afterAll(() => {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function collect(payload: AgentdFrame) {
    const frames: AgentdFrame[] = []
    for await (const f of socketRequest(sock, payload, 10_000)) frames.push(f)
    return frames
  }

  it("streams exec output and ends on the exit frame", async () => {
    const frames = await collect({ op: "exec", cmd: "echo one; echo two >&2; exit 3", cwd: dir })
    expect(frames.at(-1)).toMatchObject({ t: "exit", code: 3 })
    const out = frames
      .filter((f) => f.t === "out")
      .map((f) => f.d)
      .join("")
    expect(out).toBe("one\n")
  })

  it("answers single-frame ops", async () => {
    writeFileSync(join(dir, "f.txt"), "hello")
    const frames = await collect({ op: "read", path: join(dir, "f.txt") })
    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({ content: "hello" })
  })

  it("round-trips without spawning a process per call", async () => {
    // Measures the transport only (`stats`); file ops on macOS also pay autofs lookups
    // of /home/bot that do not exist inside the Linux container.
    const t0 = performance.now()
    for (let i = 0; i < 20; i++) await collect({ op: "stats" })
    const perCall = (performance.now() - t0) / 20
    expect(perCall).toBeLessThan(20)
  })

  it("refuses a missing path or a symlink planted in the control dir", async () => {
    await expect(collect({ op: "read", path: "/etc/passwd" })).resolves.toEqual([
      { error: expect.any(String) },
    ])
    const missing = socketRequest(join(dir, "nope.sock"), { op: "stats" }, 1_000)
    await expect(missing.next()).rejects.toBeInstanceOf(TransportUnavailableError)
    const link = join(dir, "link.sock")
    symlinkSync(sock, link)
    await expect(socketRequest(link, { op: "stats" }, 1_000).next()).rejects.toBeInstanceOf(
      TransportUnavailableError,
    )
  })
})
