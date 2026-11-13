/**
 * Capacity policy for bot computers.
 *
 * Every agent keeps its own container, disk and network identity. What is
 * rationed is how many of those containers run at the same time: idle computers
 * go to sleep (container stopped, disk kept) and the least recently used idle one
 * is evicted when a new agent needs a slot. Waking a stopped container is a
 * `docker start`, much cheaper than creating one, and no agent ever runs inside
 * a container that another agent used.
 */

export interface ComputerUsage {
  agentId: string
  lastUsedAt: number
  inflight: number
}

/** Max concurrent computers that fit in `fraction` of the Docker host's memory. */
export function autoMaxRunning(
  memTotalBytes: number,
  memPerBotMb: number,
  fraction: number,
): number {
  if (!Number.isFinite(memTotalBytes) || memTotalBytes <= 0) return 4
  const perBot = memPerBotMb * 1024 * 1024
  return Math.max(1, Math.floor((memTotalBytes * fraction) / perBot))
}

/** Computers with no in-flight call that have been idle for at least `idleMs`. */
export function idleComputers(
  usage: ComputerUsage[],
  now: number,
  idleMs: number,
): ComputerUsage[] {
  return usage.filter((u) => u.inflight === 0 && now - u.lastUsedAt >= idleMs)
}

/**
 * The least recently used computer that may be stopped to make room. A computer
 * used within `graceMs` is protected: between tool calls in a turn the model may be
 * thinking for many seconds, and evicting it then would kill its background work.
 */
export function pickEvictionVictim(
  usage: ComputerUsage[],
  now: number,
  graceMs: number,
): ComputerUsage | null {
  const candidates = idleComputers(usage, now, graceMs)
  if (candidates.length === 0) return null
  return candidates.reduce((a, b) => (b.lastUsedAt < a.lastUsedAt ? b : a))
}

/** Minimal promise mutex so concurrent admissions cannot overshoot the cap. */
export class Mutex {
  private tail: Promise<void> = Promise.resolve()

  async lock(): Promise<() => void> {
    let release: () => void = () => {}
    const next = new Promise<void>((r) => {
      release = r
    })
    const prev = this.tail
    this.tail = prev.then(() => next)
    await prev
    return release
  }
}
