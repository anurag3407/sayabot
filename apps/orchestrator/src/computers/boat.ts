/**
 * boat.dev is a Linux desktop the agent can see and click. The agent process stays on the
 * Mac or the Cloud home. API: https://boat.dev/api/v1
 */

export const BOAT_API_DEFAULT = "https://boat.dev/api/v1"

/** States in which the desktop can take a command. Provisioning and archived are not ready. */
export const BOAT_READY_STATES = new Set(["idle", "ready", "running"])

export interface BoatSandbox {
  id: string
  name: string
  state: string
}

export interface BoatClientOptions {
  token: string
  api?: string
  fetch?: typeof fetch
}

export class BoatClient {
  private token: string
  private api: string
  private fetchImpl: typeof fetch

  constructor(options: BoatClientOptions) {
    this.token = options.token
    this.api = (options.api ?? BOAT_API_DEFAULT).replace(/\/+$/, "")
    this.fetchImpl = options.fetch ?? fetch
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set("authorization", `Bearer ${this.token}`)
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
    return this.fetchImpl(`${this.api}${path}`, { ...init, headers })
  }

  private async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.request(path, init)
    if (!response.ok) {
      const detail = await response.text().catch(() => "")
      throw new Error(`Boat ${response.status} ${path}${detail ? `: ${detail.slice(0, 200)}` : ""}`)
    }
    return (await response.json()) as T
  }

  /** Boat v1 returns `{ sandbox: { id, state } }`. A flat body is accepted too. */
  private sandbox(body: BoatSandbox & { sandbox?: BoatSandbox }): BoatSandbox {
    const box = body.sandbox ?? body
    if (!box.id) throw new Error("Boat did not return a sandbox id")
    return { id: box.id, name: box.name ?? "", state: box.state ?? "" }
  }

  async create(name: string): Promise<BoatSandbox> {
    return this.sandbox(
      await this.json<BoatSandbox & { sandbox?: BoatSandbox }>("/sandboxes", {
        method: "POST",
        body: JSON.stringify({ name, noEnv: true }),
      }),
    )
  }

  async get(id: string): Promise<BoatSandbox> {
    return this.sandbox(await this.json<BoatSandbox & { sandbox?: BoatSandbox }>(`/sandboxes/${encodeURIComponent(id)}`))
  }

  /**
   * Polls until the desktop can take a command. An archived sandbox is resumed.
   * The pause is short in tests; the budget is the limit for a real wake.
   */
  async waitUntilReady(id: string, options?: { budgetMs?: number; pauseMs?: number }): Promise<BoatSandbox> {
    const budgetMs = options?.budgetMs ?? 90_000
    const pauseMs = options?.pauseMs ?? 2_000
    const deadline = Date.now() + budgetMs
    let latest: BoatSandbox | null = null
    while (Date.now() < deadline) {
      latest = await this.get(id)
      if (BOAT_READY_STATES.has(latest.state)) return latest
      if (latest.state === "archived") await this.resume(id)
      await new Promise((resolve) => setTimeout(resolve, Math.min(pauseMs, Math.max(0, deadline - Date.now()))))
    }
    throw new Error(latest ? `The Boat is ${latest.state}` : "The Boat did not become ready")
  }

  async resume(id: string): Promise<BoatSandbox> {
    return this.sandbox(
      await this.json<BoatSandbox & { sandbox?: BoatSandbox }>(`/sandboxes/${encodeURIComponent(id)}/resume`, {
        method: "POST",
      }),
    )
  }

  async stop(id: string): Promise<void> {
    await this.json(`/sandboxes/${encodeURIComponent(id)}/stop`, { method: "POST" })
  }

  /** A foreground command waits. `detached` returns at once with a process id. */
  async command(id: string, command: string, detached = false): Promise<{ exitCode?: number; output?: string; stdout?: string; pid?: string }> {
    const body = await this.json<{ exitCode?: number; output?: string; stdout?: string; pid?: string }>(
      `/sandboxes/${encodeURIComponent(id)}/commands`,
      { method: "POST", body: JSON.stringify({ command, detached }) },
    )
    return { ...body, output: body.output ?? body.stdout }
  }

  /** A frame or other file from the desktop. Bytes stay on this request and are not a shell command. */
  async artifact(id: string, filePath: string): Promise<{ contentType: string; base64: string } | null> {
    const response = await this.request(
      `/sandboxes/${encodeURIComponent(id)}/artifacts?path=${encodeURIComponent(filePath)}`,
    )
    if (!response.ok) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return null
    return { contentType: response.headers.get("content-type") ?? "application/octet-stream", base64: bytes.toString("base64") }
  }
}
