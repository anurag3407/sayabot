import type { AgentdFrame } from "../transport"

export type ComputerProfile = "standard" | "browser"
export type BackendKind = "docker" | "smolvm" | "e2b"
export type ComputerStatus = "running" | "stopped" | "missing"

/** What computerd needs to reach a running computer. */
export interface Ready {
  /** Container id, machine name or sandbox id — reported to the orchestrator. */
  id?: string
  /** Container IP, for backends whose egress traffic is attributed by source IP. */
  ip?: string
  /** Host-side agentd socket, when the backend exposes one (the ~1 ms fast path). */
  ctlSocket?: string
}

/** The computer stopped or vanished under us; the lifecycle wakes it and retries once. */
export class ComputerGoneError extends Error {}
/** The backend itself cannot be reached (Docker stopped, smolvm missing, no E2B key). */
export class BackendUnavailableError extends Error {}

/**
 * One way of giving each agent its own computer. Every backend keeps one computer
 * (and one disk) per agent; the lifecycle above it decides when computers run.
 */
export interface ComputerBackend {
  readonly kind: BackendKind
  /** Egress attributes this backend's traffic by container IP (its cache must be reset on reuse). */
  readonly ipIdentity: boolean
  /** Concurrency budget when COMPUTER_MAX_RUNNING=auto. */
  autoMaxRunning(memMb: number, fraction: number): Promise<number>
  /** Agent ids whose computers are running right now. */
  listRunning(): Promise<string[]>
  status(agentId: string): Promise<ComputerStatus>
  /** Connection details for a computer that is already running. */
  attach(agentId: string): Promise<Ready>
  /** Creates the computer if needed, then starts or resumes it. */
  start(agentId: string, orgId: string, profile: ComputerProfile): Promise<Ready>
  /** One agentd request; throws ComputerGoneError if the computer is not running. */
  transport(agentId: string, ready: Ready, payload: AgentdFrame): AsyncGenerator<AgentdFrame>
  /** Stops or pauses the computer, keeping its disk. */
  sleep(agentId: string, timeoutSec: number): Promise<void>
  remove(agentId: string, deleteDisk: boolean): Promise<void>
  /** Human-readable notes for /v1/capacity (transport, isolation, egress). */
  describe(): Record<string, unknown>
}

/** argv strings are capped at 128 KiB on Linux; agentd-cli joins chunks back together. */
export function argvChunks(payload: AgentdFrame, size = 100_000): string[] {
  const json = JSON.stringify(payload)
  const chunks: string[] = []
  for (let i = 0; i < json.length; i += size) chunks.push(json.slice(i, i + size))
  return chunks.length ? chunks : ["{}"]
}
