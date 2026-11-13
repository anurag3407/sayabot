import http from "node:http"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"

/**
 * Docker endpoint discovery. A VPS (and the compose deployment) uses the standard
 * /var/run/docker.sock; a local computer often runs Docker Desktop, OrbStack, Colima
 * or Rancher Desktop, which put the socket under the user's home directory instead.
 */
export function detectDockerUrl(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  home = homedir(),
): string {
  if (env.DOCKER_HOST) return env.DOCKER_HOST
  const candidates = [
    "/var/run/docker.sock",
    join(home, ".docker/run/docker.sock"), // Docker Desktop (macOS)
    join(home, ".orbstack/run/docker.sock"), // OrbStack
    join(home, ".colima/default/docker.sock"), // Colima
    join(home, ".rd/docker.sock"), // Rancher Desktop
  ]
  for (const p of candidates) if (exists(p)) return `unix://${p}`
  return "http://docker-proxy:2375"
}

function isUnixSocket(url: string): boolean {
  return url.startsWith("/") || url.startsWith("unix://")
}

function getSocketPath(url: string): string {
  return url.replace(/^unix:\/\//, "")
}

function unixRequest(
  socketPath: string,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    }
    const req = http.request(
      { socketPath, path, method: options.method || "GET", headers },
      (res) => {
        const responseHeaders = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") responseHeaders.set(k, v)
          else if (Array.isArray(v)) responseHeaders.set(k, v.join(", "))
        }
        // Stream the body so long-running exec output is not buffered in memory.
        const status = res.statusCode || 200
        const body =
          status === 204 || status === 304 ? null : (Readable.toWeb(res) as ReadableStream)
        if (!body) res.resume()
        resolve(
          new Response(body, {
            status,
            statusText: res.statusMessage || "OK",
            headers: responseHeaders,
          }),
        )
      },
    )
    req.on("error", reject)
    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body))
    }
    req.end()
  })
}

export class DockerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export interface DockerMount {
  Type: "volume" | "bind"
  Source: string
  Target: string
  ReadOnly?: boolean
  VolumeOptions?: { Subpath?: string }
}

export interface DockerContainerConfig {
  Image: string
  name: string
  User?: string
  Env?: string[]
  Labels?: Record<string, string>
  HostConfig?: {
    Runtime?: string
    NetworkMode?: string
    ReadonlyRootfs?: boolean
    Tmpfs?: Record<string, string>
    Binds?: string[]
    Mounts?: DockerMount[]
    NanoCpus?: number
    Memory?: number
    MemorySwap?: number
    PidsLimit?: number
    CapDrop?: string[]
    SecurityOpt?: string[]
    RestartPolicy?: { Name: string }
  }
}

export interface ContainerSummary {
  Id: string
  Names: string[]
  Labels: Record<string, string>
  State: string
}

export class DockerClient {
  private baseUrl: string

  constructor(url = detectDockerUrl()) {
    this.baseUrl = url.replace(/\/+$/, "")
  }

  private raw(path: string, options: RequestInit = {}): Promise<Response> {
    return isUnixSocket(this.baseUrl)
      ? unixRequest(getSocketPath(this.baseUrl), path, options)
      : fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers: { "content-type": "application/json", ...options.headers },
        })
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const res = await this.raw(path, options)
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new DockerApiError(
        `Docker API ${options.method || "GET"} ${path} failed (${res.status}): ${body}`,
        res.status,
      )
    }
    const ct = res.headers.get("content-type") || ""
    if (ct.includes("application/json")) return res.json()
    await res.body?.cancel().catch(() => {})
    return res
  }

  async inspectContainer(idOrName: string): Promise<any> {
    try {
      return await this.request(`/containers/${encodeURIComponent(idOrName)}/json`)
    } catch (e) {
      if (e instanceof DockerApiError && e.status === 404) return null
      throw e
    }
  }

  /** Lists containers carrying `label` (running only unless `all`). */
  async listContainers(label: string, all = false): Promise<ContainerSummary[]> {
    const filters = encodeURIComponent(JSON.stringify({ label: [label] }))
    return this.request(`/containers/json?all=${all}&filters=${filters}`)
  }

  async createContainer(config: DockerContainerConfig): Promise<{ Id: string }> {
    return this.request(`/containers/create?name=${encodeURIComponent(config.name)}`, {
      method: "POST",
      body: JSON.stringify(config),
    })
  }

  async startContainer(idOrName: string): Promise<void> {
    await this.request(`/containers/${encodeURIComponent(idOrName)}/start`, { method: "POST" })
  }

  async stopContainer(idOrName: string, timeout = 10): Promise<void> {
    await this.request(`/containers/${encodeURIComponent(idOrName)}/stop?t=${timeout}`, {
      method: "POST",
    })
  }

  async removeContainer(idOrName: string, force = true): Promise<void> {
    await this.request(`/containers/${encodeURIComponent(idOrName)}?force=${force}&v=true`, {
      method: "DELETE",
    })
  }

  async removeVolume(name: string, force = true): Promise<void> {
    await this.request(`/volumes/${encodeURIComponent(name)}?force=${force}`, { method: "DELETE" })
  }

  async inspectNetwork(name: string): Promise<{ Id: string } | null> {
    try {
      return await this.request(`/networks/${encodeURIComponent(name)}`)
    } catch (e) {
      if (e instanceof DockerApiError && e.status === 404) return null
      throw e
    }
  }

  async createNetwork(name: string, internal: boolean): Promise<void> {
    await this.request(`/networks/create`, {
      method: "POST",
      body: JSON.stringify({
        Name: name,
        Driver: "bridge",
        Internal: internal,
        CheckDuplicate: true,
      }),
    })
  }

  /** Total memory of the Docker host — the VM's memory on Docker Desktop, the server's on a VPS. */
  async info(): Promise<{ MemTotal?: number; NCPU?: number; Runtimes?: Record<string, unknown> }> {
    return this.request(`/info`)
  }

  async version(): Promise<{ ApiVersion?: string }> {
    return this.request(`/version`)
  }

  async execCreate(idOrName: string, cmd: string[]): Promise<{ Id: string }> {
    return this.request(`/containers/${encodeURIComponent(idOrName)}/exec`, {
      method: "POST",
      body: JSON.stringify({ AttachStdout: true, AttachStderr: true, Cmd: cmd }),
    })
  }

  async execStart(execId: string): Promise<Response> {
    return this.raw(`/exec/${encodeURIComponent(execId)}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ Detach: false, Tty: false }),
    })
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.raw("/_ping")
      await res.body?.cancel().catch(() => {})
      return res.ok
    } catch {
      return false
    }
  }
}

/**
 * Splits Docker's multiplexed attach stream (used whenever Tty is false) into
 * stdout/stderr payloads. Each frame is an 8-byte header — [stream, 0, 0, 0, size32be] —
 * followed by `size` bytes. A stream that does not start with a valid header is
 * treated as raw stdout (Tty containers, or proxies that already demuxed).
 */
export class DockerStreamDemuxer {
  private buf = Buffer.alloc(0)
  private mode: "unknown" | "mux" | "raw" = "unknown"

  push(chunk: Uint8Array): { stdout: Buffer[]; stderr: Buffer[] } {
    const out = { stdout: [] as Buffer[], stderr: [] as Buffer[] }
    this.buf = Buffer.concat([this.buf, Buffer.from(chunk)])
    if (this.mode === "unknown") {
      if (this.buf.length < 8) return out
      const b = this.buf
      this.mode = (b[0] ?? 255) <= 2 && b[1] === 0 && b[2] === 0 && b[3] === 0 ? "mux" : "raw"
    }
    if (this.mode === "raw") {
      out.stdout.push(this.buf)
      this.buf = Buffer.alloc(0)
      return out
    }
    while (this.buf.length >= 8) {
      const size = this.buf.readUInt32BE(4)
      if (this.buf.length < 8 + size) break
      const payload = this.buf.subarray(8, 8 + size)
      if (this.buf[0] === 2) out.stderr.push(payload)
      else out.stdout.push(payload)
      this.buf = this.buf.subarray(8 + size)
    }
    return out
  }

  /** Bytes left over when the stream ended (a short raw stream never reached 8 bytes). */
  flush(): Buffer {
    const rest = this.mode === "mux" ? Buffer.alloc(0) : this.buf
    this.buf = Buffer.alloc(0)
    return rest
  }
}
