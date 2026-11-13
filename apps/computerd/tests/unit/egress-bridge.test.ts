import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { connect, createServer, type Server } from "node:net"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { startEgressRelay } from "../../agentd/agentd"
import { argvChunks } from "../../src/backends/types"
import { EgressBridge, rewriteProxyHead } from "../../src/egress-bridge"
import { ProxyIdentity } from "../../src/identity"

describe("rewriteProxyHead", () => {
  it("waits for the full head, then replaces any guest-supplied credential with ours", () => {
    expect(
      rewriteProxyHead(Buffer.from("GET http://x/ HTTP/1.1\r\nHost: x\r\n"), "Basic ours"),
    ).toBeNull()
    const out = rewriteProxyHead(
      Buffer.from(
        "CONNECT api.github.com:443 HTTP/1.1\r\nProxy-Authorization: Basic stolen\r\nHost: api.github.com\r\n\r\nTLSDATA",
      ),
      "Basic ours",
    )
    const text = out?.toString("latin1") ?? ""
    expect(text).not.toContain("stolen")
    expect(text).toContain("Proxy-Authorization: Basic ours\r\n\r\nTLSDATA")
    expect(text.startsWith("CONNECT api.github.com:443 HTTP/1.1\r\n")).toBe(true)
  })
})

describe("ProxyIdentity", () => {
  it("derives a stable per-agent credential and exposes only its hash", () => {
    const a = new ProxyIdentity("k1")
    expect(a.secret("agent-1")).toBe(new ProxyIdentity("k1").secret("agent-1"))
    expect(a.secret("agent-1")).not.toBe(a.secret("agent-2"))
    expect(a.secretHash("agent-1")).toMatch(/^[0-9a-f]{64}$/)
    expect(a.secretHash("agent-1")).not.toContain(a.secret("agent-1"))
    const basic = Buffer.from(a.proxyAuthorization("agent-1").slice(6), "base64").toString()
    expect(basic).toBe(`saaya:${a.secret("agent-1")}`)
  })
})

describe("argvChunks", () => {
  it("splits large requests under the 128 KiB argv limit and round-trips", () => {
    const payload = { op: "write", path: "/home/bot/big", content: "x".repeat(350_000) }
    const chunks = argvChunks(payload)
    expect(chunks.length).toBeGreaterThan(3)
    expect(Math.max(...chunks.map((c) => Buffer.byteLength(c)))).toBeLessThanOrEqual(100_000)
    expect(JSON.parse(chunks.join(""))).toEqual(payload)
  })
})

describe("VM egress path: agentd relay → host bridge → egress", () => {
  let dir: string
  let egress: Server
  let received = ""
  const servers: Array<{ close(): void }> = []

  beforeEach(async () => {
    dir = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "eb-")))
    received = ""
    egress = createServer((s) => {
      s.on("data", (d) => {
        received += d.toString("latin1")
        if (received.includes("\r\n\r\n")) s.end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nok")
      })
    })
    await new Promise<void>((r) => egress.listen(0, "127.0.0.1", () => r()))
  })
  afterEach(() => {
    egress.close()
    for (const s of servers) s.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it("a proxied request from inside the VM reaches egress carrying only the host-added credential", async () => {
    const addr = egress.address()
    const port = typeof addr === "object" && addr ? addr.port : 0
    const bridge = new EgressBridge({ host: "127.0.0.1", port }, () => "Basic host-added")
    servers.push({ close: () => bridge.closeAll() })
    const sock = join(dir, "egress.sock")
    await bridge.listen("agent-1", sock)
    // inside the VM: agentd relays 127.0.0.1:<relayPort> to the mounted socket
    const relay = startEgressRelay(sock, 0)
    servers.push(relay)
    await new Promise<void>((r) => (relay.listening ? r() : relay.once("listening", () => r())))
    const relayAddr = relay.address()
    const relayPort = typeof relayAddr === "object" && relayAddr ? relayAddr.port : 0

    const reply = await new Promise<string>((resolve, reject) => {
      const c = connect(relayPort, "127.0.0.1", () => {
        c.write(
          "GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: Basic forged\r\n\r\n",
        )
      })
      let buf = ""
      c.on("data", (d) => (buf += d))
      c.on("end", () => resolve(buf))
      c.on("error", reject)
    })
    expect(reply).toContain("200 OK")
    expect(received).toContain("Proxy-Authorization: Basic host-added")
    expect(received).not.toContain("forged")
  })
})
