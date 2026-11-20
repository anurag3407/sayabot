import { existsSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import type { Server } from "node:net"
import { startAgentd } from "../../agentd/agentd"
import { responseTimeoutMs, socketRequest, type AgentdFrame } from "../transport"
import {
  type ComputerBackend,
  type ComputerProfile,
  type ComputerStatus,
  type Ready,
} from "./types"
import type { ComputerdConfig } from "../lifecycle"

export class HostBackend implements ComputerBackend {
  readonly kind = "host" as const
  readonly ipIdentity = false
  private servers = new Map<string, Server>()
  private baseDir: string

  constructor(private config?: Partial<ComputerdConfig>) {
    this.baseDir =
      process.env.SAYABOT_SANDBOX_DIR || join(os.homedir(), ".sayabot", "sandbox")
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true })
    }
  }

  async autoMaxRunning(): Promise<number> {
    return 10
  }

  async listRunning(): Promise<string[]> {
    return Array.from(this.servers.keys())
  }

  async status(agentId: string): Promise<ComputerStatus> {
    const socketPath = join(this.baseDir, agentId, "agentd.sock")
    if (this.servers.has(agentId) && existsSync(socketPath)) {
      return "running"
    }
    return existsSync(join(this.baseDir, agentId)) ? "stopped" : "missing"
  }

  async attach(agentId: string): Promise<Ready> {
    const socketPath = join(this.baseDir, agentId, "agentd.sock")
    return {
      id: `host-${agentId}`,
      ctlSocket: socketPath,
    }
  }

  async start(
    agentId: string,
    _orgId: string,
    _profile: ComputerProfile,
  ): Promise<Ready> {
    const agentDir = join(this.baseDir, agentId)
    if (!existsSync(agentDir)) {
      mkdirSync(agentDir, { recursive: true })
    }
    const socketPath = join(agentDir, "agentd.sock")

    if (!this.servers.has(agentId)) {
      const server = startAgentd(socketPath, 0o600, agentDir)
      this.servers.set(agentId, server)
      // Allow socket server to bind cleanly
      await new Promise((r) => setTimeout(r, 60))
    }

    return {
      id: `host-${agentId}`,
      ctlSocket: socketPath,
    }
  }

  async *transport(
    _agentId: string,
    ready: Ready,
    payload: AgentdFrame,
  ): AsyncGenerator<AgentdFrame> {
    if (!ready.ctlSocket) {
      throw new Error("ctlSocket missing on host backend")
    }
    yield* socketRequest(ready.ctlSocket, payload, responseTimeoutMs(payload))
  }

  async sleep(agentId: string, _timeoutSec?: number): Promise<void> {
    const server = this.servers.get(agentId)
    if (server) {
      server.close()
      this.servers.delete(agentId)
    }
  }

  async remove(agentId: string, deleteDisk: boolean): Promise<void> {
    await this.sleep(agentId)
    if (deleteDisk) {
      const agentDir = join(this.baseDir, agentId)
      if (existsSync(agentDir)) {
        rmSync(agentDir, { recursive: true, force: true })
      }
    }
  }

  describe(): Record<string, unknown> {
    return {
      backend: "host",
      isolation: "user_directory",
      baseDir: this.baseDir,
    }
  }
}

export async function buildHost(config?: Partial<ComputerdConfig>): Promise<HostBackend> {
  return new HostBackend(config)
}
