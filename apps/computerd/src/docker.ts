import http from "node:http"
import { existsSync } from "node:fs"

function getDefaultDockerUrl(): string {
  if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST
  if (existsSync("/var/run/docker.sock")) return "unix:///var/run/docker.sock"
  return "http://docker-proxy:2375"
}

const DOCKER_URL = getDefaultDockerUrl()

function isUnixSocket(url: string): boolean {
  return url.startsWith("/") || url.startsWith("unix://")
}

function getSocketPath(url: string): string {
  return url.replace(/^unix:\/\//, "")
}

function unixRequest(socketPath: string, path: string, options: RequestInit = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    }
    const req = http.request(
      {
        socketPath,
        path,
        method: options.method || "GET",
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
        res.on("end", () => {
          const body = Buffer.concat(chunks)
          const responseHeaders = new Headers()
          for (const [k, v] of Object.entries(res.headers)) {
            if (typeof v === "string") responseHeaders.set(k, v)
            else if (Array.isArray(v)) responseHeaders.set(k, v.join(", "))
          }
          const response = new Response(body, {
            status: res.statusCode || 200,
            statusText: res.statusMessage || "OK",
            headers: responseHeaders,
          })
          resolve(response)
        })
      },
    )
    req.on("error", reject)
    if (options.body) {
      req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body))
    }
    req.end()
  })
}

export interface DockerContainerConfig {
  Image: string
  name: string
  Env?: string[]
  Labels?: Record<string, string>
  HostConfig?: {
    Runtime?: string
    NetworkMode?: string
    ReadonlyRootfs?: boolean
    Tmpfs?: Record<string, string>
    Binds?: string[]
    NanoCpus?: number
    Memory?: number
    MemorySwap?: number
    PidsLimit?: number
    CapDrop?: string[]
    SecurityOpt?: string[]
    RestartPolicy?: { Name: string }
  }
}

export class DockerClient {
  private baseUrl: string

  constructor(url = DOCKER_URL) {
    this.baseUrl = url.replace(/\/+$/, "")
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const res = isUnixSocket(this.baseUrl)
      ? await unixRequest(getSocketPath(this.baseUrl), path, options)
      : await fetch(`${this.baseUrl}${path}`, {
          ...options,
          headers: {
            "content-type": "application/json",
            ...options.headers,
          },
        })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(
        `Docker API ${options.method || "GET"} ${path} failed (${res.status}): ${body}`,
      )
    }
    const ct = res.headers.get("content-type") || ""
    if (ct.includes("application/json")) {
      return res.json()
    }
    return res
  }

  async inspectContainer(idOrName: string): Promise<any> {
    try {
      return await this.request(`/containers/${encodeURIComponent(idOrName)}/json`)
    } catch (e: any) {
      if (e.message.includes("404")) return null
      throw e
    }
  }

  async createContainer(config: DockerContainerConfig): Promise<{ Id: string }> {
    return this.request(`/containers/create?name=${encodeURIComponent(config.name)}`, {
      method: "POST",
      body: JSON.stringify(config),
    })
  }

  async startContainer(idOrName: string): Promise<void> {
    await this.request(`/containers/${encodeURIComponent(idOrName)}/start`, {
      method: "POST",
    })
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
    await this.request(`/volumes/${encodeURIComponent(name)}?force=${force}`, {
      method: "DELETE",
    })
  }

  async execCreate(idOrName: string, cmd: string[]): Promise<{ Id: string }> {
    return this.request(`/containers/${encodeURIComponent(idOrName)}/exec`, {
      method: "POST",
      body: JSON.stringify({
        AttachStdout: true,
        AttachStderr: true,
        Cmd: cmd,
      }),
    })
  }

  async execStart(execId: string): Promise<Response> {
    const path = `/exec/${encodeURIComponent(execId)}/start`
    const opts = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ Detach: false, Tty: false }),
    }
    return isUnixSocket(this.baseUrl)
      ? unixRequest(getSocketPath(this.baseUrl), path, opts)
      : fetch(`${this.baseUrl}${path}`, opts)
  }

  async ping(): Promise<boolean> {
    try {
      const res = isUnixSocket(this.baseUrl)
        ? await unixRequest(getSocketPath(this.baseUrl), "/_ping")
        : await fetch(`${this.baseUrl}/_ping`)
      return res.ok
    } catch {
      return false
    }
  }
}
