import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs"
import { connect, createServer, type Server, type Socket } from "node:net"
import { dirname } from "node:path"

const MAX_HEAD = 64 * 1024

/**
 * Inserts `Proxy-Authorization` into the first request head on a proxy connection and
 * drops any the guest sent, so a computer can never claim another agent's identity.
 * Returns null until the full head (up to the blank line) has arrived.
 */
export function rewriteProxyHead(buf: Buffer, authorization: string): Buffer | null {
  const end = buf.indexOf("\r\n\r\n")
  if (end < 0) {
    if (buf.length > MAX_HEAD) throw new Error("proxy request head too large")
    return null
  }
  const head = buf.subarray(0, end).toString("latin1")
  const [requestLine = "", ...headers] = head.split("\r\n")
  const kept = headers.filter((h) => !/^proxy-authorization\s*:/i.test(h))
  const rebuilt = [requestLine, ...kept, `Proxy-Authorization: ${authorization}`].join("\r\n")
  return Buffer.concat([Buffer.from(rebuilt + "\r\n\r\n", "latin1"), buf.subarray(end + 4)])
}

export interface EgressTarget {
  host: string
  port: number
}

export function parseEgressTarget(url: string): EgressTarget {
  const u = new URL(url)
  return { host: u.hostname, port: Number(u.port || 8080) }
}

/**
 * Host side of a computer's only way out: a Unix socket bridged into the microVM.
 * Each connection is forwarded to Saaya egress with this agent's proxy credential.
 * Egress binds the identity to the TCP connection, so keep-alive requests after the
 * first one stay attributed correctly.
 */
export class EgressBridge {
  private servers = new Map<string, Server>()

  constructor(
    private target: EgressTarget,
    private authorizationFor: (agentId: string) => string,
  ) {}

  /** Starts (or keeps) the listener at `socketPath` for `agentId`. */
  async listen(agentId: string, socketPath: string): Promise<void> {
    if (this.servers.has(socketPath)) return
    mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 })
    if (existsSync(socketPath)) unlinkSync(socketPath)
    const auth = this.authorizationFor(agentId)
    const server = createServer((guest) => this.forward(guest, auth))
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(socketPath, () => {
        server.off("error", reject)
        resolve()
      })
    })
    chmodSync(socketPath, 0o600)
    this.servers.set(socketPath, server)
  }

  close(socketPath: string) {
    const server = this.servers.get(socketPath)
    if (!server) return
    this.servers.delete(socketPath)
    server.close()
    try {
      unlinkSync(socketPath)
    } catch {}
  }

  closeAll() {
    for (const path of [...this.servers.keys()]) this.close(path)
  }

  private forward(guest: Socket, auth: string) {
    let buf = Buffer.alloc(0)
    let upstream: Socket | null = null
    const fail = () => {
      guest.destroy()
      upstream?.destroy()
    }
    guest.on("error", fail)
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk])
      let head: Buffer | null
      try {
        head = rewriteProxyHead(buf, auth)
      } catch {
        guest.end("HTTP/1.1 431 Request Header Fields Too Large\r\n\r\n")
        return
      }
      if (!head) return
      guest.off("data", onData)
      guest.pause()
      upstream = connect(this.target.port, this.target.host, () => {
        upstream?.write(head)
        if (!upstream) return
        guest.pipe(upstream).pipe(guest)
        guest.resume()
      })
      upstream.on("error", () => {
        if (!guest.destroyed)
          guest.end("HTTP/1.1 502 Bad Gateway\r\n\r\nsaaya: egress unreachable\n")
      })
    }
    guest.on("data", onData)
  }
}
