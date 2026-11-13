import { lstatSync } from "node:fs"
import { createConnection, type Socket } from "node:net"
import { StringDecoder } from "node:string_decoder"

export type AgentdFrame = Record<string, unknown>

/** The agentd connection could not be opened at all; the caller should use another transport. */
export class TransportUnavailableError extends Error {}

/** exec streams frames until `exit`; every other op answers with exactly one frame. */
export function isFinalFrame(op: unknown, frame: AgentdFrame): boolean {
  return op !== "exec" || frame.t === "exit" || "error" in frame
}

/** Incremental NDJSON parser shared by the socket and docker-exec transports. */
export class NdjsonParser {
  private decoder = new StringDecoder("utf8")
  private buffer = ""

  push(chunk: Uint8Array | string): AgentdFrame[] {
    this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(Buffer.from(chunk))
    const lines = this.buffer.split("\n")
    this.buffer = lines.pop() || ""
    return lines.flatMap((l) => parseLine(l))
  }

  end(): AgentdFrame[] {
    this.buffer += this.decoder.end()
    const rest = this.buffer
    this.buffer = ""
    return parseLine(rest)
  }
}

function parseLine(line: string): AgentdFrame[] {
  if (!line.trim()) return []
  const frame: unknown = JSON.parse(line)
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    throw new Error("Invalid agentd frame")
  }
  return [frame as AgentdFrame]
}

function openSocket(socketPath: string): Promise<Socket> {
  // The control directory is writable by the bot, so refuse anything that is not
  // a real socket (e.g. a symlink planted to point at another socket on this host).
  try {
    const st = lstatSync(socketPath)
    if (st.isSymbolicLink() || !st.isSocket()) {
      return Promise.reject(new TransportUnavailableError(`${socketPath} is not a socket`))
    }
  } catch (e) {
    return Promise.reject(new TransportUnavailableError((e as Error).message))
  }
  return new Promise((resolve, reject) => {
    const sock = createConnection(socketPath)
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new TransportUnavailableError("agentd socket connect timed out"))
    }, 2_000)
    sock.once("connect", () => {
      clearTimeout(timer)
      resolve(sock)
    })
    sock.once("error", (e) => {
      clearTimeout(timer)
      reject(new TransportUnavailableError(e.message))
    })
  })
}

/**
 * Sends one request to agentd over its Unix socket and yields response frames as
 * they arrive. No process is spawned per call — this replaces `docker exec` + a
 * Node CLI boot on the hot path.
 */
export async function* socketRequest(
  socketPath: string,
  payload: AgentdFrame,
  timeoutMs: number,
): AsyncGenerator<AgentdFrame> {
  const sock = await openSocket(socketPath)
  const parser = new NdjsonParser()
  let done = false
  sock.setTimeout(timeoutMs, () => sock.destroy(new Error("agentd response timed out")))
  try {
    sock.write(JSON.stringify(payload) + "\n")
    for await (const chunk of sock) {
      for (const frame of parser.push(chunk as Buffer)) {
        yield frame
        if (isFinalFrame(payload.op, frame)) {
          done = true
          return
        }
      }
    }
    for (const frame of parser.end()) {
      yield frame
      if (isFinalFrame(payload.op, frame)) {
        done = true
        return
      }
    }
    if (!done) throw new Error("agentd closed without a complete response")
  } finally {
    sock.destroy()
  }
}

/** Response deadline for a request: the command's own timeout plus slack, capped like agentd. */
export function responseTimeoutMs(payload: AgentdFrame): number {
  const requested = typeof payload.timeoutMs === "number" ? payload.timeoutMs : 60_000
  return Math.min(Math.max(requested, 1_000), 300_000) + 15_000
}
