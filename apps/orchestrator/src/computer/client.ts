import { getEnv } from "../env"

export interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  truncated: boolean
  timedOut?: boolean
}

export interface FileEntry {
  path: string
  type: "file" | "directory" | "other"
  size: number
  mtime: string
}

export interface ReadFileArgs {
  path: string
  maxBytes?: number
  startLine?: number
  endLine?: number
  encoding?: "utf8" | "base64"
  offsetBytes?: number
}

export interface FilePage {
  path: string
  content: string
  encoding: "utf8" | "base64"
  size: number
  bytesReturned: number
  hash: string
  truncated: boolean
  hasMore: boolean
  totalLines?: number
  startLine?: number
  endLine?: number | null
  linesReturned?: number
  nextStartLine?: number | null
  nextOffsetBytes?: number | null
}

export interface EditFileArgs {
  path: string
  oldString: string
  newString: string
  expectedHash?: string
  replaceAll?: boolean
  whitespace?: boolean
}

export interface ApplyPatchArgs {
  patchText: string
}

export interface PatchFileResult {
  path: string
  action: "add" | "delete" | "update" | "move"
  additions: number
  deletions: number
  bytes?: number
  hash?: string
}

export interface ApplyPatchResult {
  ok: boolean
  summary: string
  files: PatchFileResult[]
}

export interface CodeIntelligenceArgs {
  action: "outline" | "definition" | "references" | "diagnostics" | "rename_preview"
  path: string
  projectRoot?: string
  line?: number
  column?: number
  newName?: string
  maxResults?: number
}

export class ComputerClient {
  private baseUrl: string
  private internalSecret: string

  constructor(baseUrl?: string, internalSecret?: string) {
    this.baseUrl = baseUrl || getEnv().COMPUTERD_URL
    this.internalSecret = internalSecret || getEnv().ORCHESTRATOR_INTERNAL_SECRET
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const headers = {
      "content-type": "application/json",
      "x-internal-secret": this.internalSecret,
      ...(init?.headers || {}),
    }

    const res = await fetch(url, { ...init, headers })
    if (!res.ok) {
      let errBody = ""
      try {
        errBody = await res.text()
      } catch {
        // ignore
      }
      throw new Error(`Computerd error (${res.status} ${res.statusText}): ${errBody || "Unknown error"}`)
    }

    const data: unknown = await res.json()
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid computerd response")
    if ("error" in data) throw new Error(`Computerd error: ${String(data.error)}`)
    return data as T
  }

  async ensure(agentId: string, orgId: string, profile: "standard" | "browser"): Promise<{ status: string; ip?: string }> {
    return this.request<{ status: string; ip?: string }>(`/v1/computers/${agentId}/ensure`, {
      method: "POST",
      body: JSON.stringify({ orgId, profile }),
    })
  }

  async exec(
    agentId: string,
    args: {
      cmd: string
      cwd?: string
      env?: Record<string, string>
      timeoutMs?: number
      stdin?: string
      runId?: string
      onChunk?: (chunk: string) => void
    },
    signal?: AbortSignal,
  ): Promise<ExecResult> {
    const url = `${this.baseUrl}/v1/computers/${agentId}/exec`
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": this.internalSecret,
      },
      body: JSON.stringify(args),
      signal,
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => "")
      throw new Error(`Execution failed (${res.status}): ${errText}`)
    }

    // Stream NDJSON responses
    const reader = res.body?.getReader()
    if (!reader) throw new Error("No response body available from computerd exec")

    const decoder = new TextDecoder("utf-8", { fatal: true })
    let buffer = ""
    let stdout = ""
    let stderr = ""
    let exitCode: number | undefined
    let durationMs = 0
    let truncated = false
    let timedOut = false
    let received = 0
    const consume = (line: string) => {
      if (!line.trim()) return
      const frame = JSON.parse(line)
      if (!frame || typeof frame !== "object" || Array.isArray(frame)) throw new Error("Invalid exec frame")
      if ("error" in frame) throw new Error(`Execution failed: ${String(frame.error)}`)
      if (exitCode !== undefined) throw new Error("Unexpected frame after exec exit")
      if (frame.t === "out" || frame.t === "err") {
        if (typeof frame.d !== "string") throw new Error("Invalid exec output frame")
        if (frame.t === "out") stdout += frame.d
        else stderr += frame.d
        args.onChunk?.(frame.d)
      } else if (frame.t === "exit") {
        if (!Number.isInteger(frame.code) || frame.code < 0 || frame.code > 255) throw new Error("Invalid exec exit code")
        if (frame.durationMs !== undefined && (!Number.isFinite(frame.durationMs) || frame.durationMs < 0)) throw new Error("Invalid exec duration")
        if (frame.truncated !== undefined && typeof frame.truncated !== "boolean") throw new Error("Invalid exec truncation flag")
        exitCode = frame.code
        durationMs = frame.durationMs ?? 0
        truncated = frame.truncated ?? false
        timedOut = frame.timedOut === true
      } else throw new Error("Unknown exec frame")
    }
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > 8 * 1024 * 1024) throw new Error("Exec response exceeds byte limit")
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""
        for (const line of lines) consume(line)
      }
      buffer += decoder.decode()
      consume(buffer)
      if (exitCode === undefined) throw new Error("Execution ended without an exit frame")
      return { stdout, stderr, exitCode, durationMs, truncated, timedOut }
    } catch (error) {
      await reader.cancel().catch(() => {})
      throw error
    } finally {
      reader.releaseLock()
    }
  }

  async readFile(
    agentId: string,
    args: ReadFileArgs,
  ): Promise<FilePage> {
    return this.request(`/v1/computers/${agentId}/files/read`, {
      method: "POST",
      body: JSON.stringify(args),
    })
  }

  async writeFile(
    agentId: string,
    args: { path: string; content: string; encoding?: "utf8" | "base64"; mode?: number; allowOverwriteLarge?: boolean },
  ): Promise<{ bytes: number }> {
    return this.request(`/v1/computers/${agentId}/files/write`, {
      method: "POST",
      body: JSON.stringify(args),
    })
  }

  async editFile(agentId: string, args: EditFileArgs): Promise<{ ok: boolean; path: string; bytes: number; hash: string; previousHash: string; replacements: number; matchMode: string }> {
    return this.request(`/v1/computers/${agentId}/files/edit`, { method: "POST", body: JSON.stringify(args) })
  }

  async applyPatch(agentId: string, args: ApplyPatchArgs): Promise<ApplyPatchResult> {
    return this.request(`/v1/computers/${agentId}/files/patch`, { method: "POST", body: JSON.stringify(args) })
  }

  async codeIntelligence(agentId: string, args: CodeIntelligenceArgs): Promise<Record<string, unknown>> {
    return this.request(`/v1/computers/${agentId}/code`, { method: "POST", body: JSON.stringify(args) })
  }

  async listFiles(
    agentId: string,
    args: { path?: string; depth?: number },
  ): Promise<{ entries: FileEntry[] }> {
    return this.request(`/v1/computers/${agentId}/files/list`, {
      method: "POST",
      body: JSON.stringify(args),
    })
  }

  async browser(agentId: string, action: string, params: Record<string, unknown>): Promise<unknown> {
    return this.request(`/v1/computers/${agentId}/browser`, {
      method: "POST",
      body: JSON.stringify({ action, ...params }),
    })
  }

  async stop(agentId: string): Promise<{ ok: boolean }> {
    return this.request(`/v1/computers/${agentId}/stop`, {
      method: "POST",
    })
  }

  async stats(agentId: string): Promise<Record<string, unknown>> {
    return this.request(`/v1/computers/${agentId}/stats`, {
      method: "GET",
    })
  }
}

let defaultClient: ComputerClient | null = null

export function getComputerClient(): ComputerClient {
  if (!defaultClient) {
    defaultClient = new ComputerClient()
  }
  return defaultClient
}
