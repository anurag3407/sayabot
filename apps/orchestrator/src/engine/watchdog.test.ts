import { afterEach, describe, expect, it, vi } from "vitest"
import {
  TOOL_STALL_MS,
  TURN_STALL_MS,
  assessStall,
  stallLimitFor,
  startRunWatchdog,
} from "./watchdog"

describe("assessStall", () => {
  it("leaves a turn that is producing output alone", () => {
    const verdict = assessStall({
      now: 1_000_000,
      lastActivityAt: 1_000_000 - 60_000,
      toolsInFlight: 0,
    })
    expect(verdict.stalled).toBe(false)
    expect(verdict.reason).toBeNull()
    expect(verdict.limitMs).toBe(TURN_STALL_MS)
  })

  it("stops a turn that has been silent past the limit", () => {
    const verdict = assessStall({
      now: 10_000_000,
      lastActivityAt: 10_000_000 - TURN_STALL_MS - 1,
      toolsInFlight: 0,
    })
    expect(verdict.stalled).toBe(true)
    expect(verdict.reason).toContain("No activity")
  })

  it("gives a running tool a much longer allowance", () => {
    const silentFor = TURN_STALL_MS + 60_000
    const quiet = assessStall({
      now: 10_000_000,
      lastActivityAt: 10_000_000 - silentFor,
      toolsInFlight: 0,
    })
    const working = assessStall({
      now: 10_000_000,
      lastActivityAt: 10_000_000 - silentFor,
      toolsInFlight: 1,
    })
    expect(quiet.stalled).toBe(true)
    expect(working.stalled).toBe(false)
    expect(working.limitMs).toBe(TOOL_STALL_MS)

    const abandoned = assessStall({
      now: 10_000_000,
      lastActivityAt: 10_000_000 - TOOL_STALL_MS - 1,
      toolsInFlight: 1,
    })
    expect(abandoned.stalled).toBe(true)
    expect(abandoned.reason).toContain("tool")
  })

  it("honours an explicit limit", () => {
    expect(stallLimitFor(0, 5_000)).toBe(5_000)
    expect(stallLimitFor(3, 5_000)).toBe(5_000)
    expect(stallLimitFor(0, 0)).toBe(TURN_STALL_MS)
  })
})

describe("startRunWatchdog", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("stops only the runs that are actually wedged", () => {
    vi.useFakeTimers()
    const now = 10_000_000
    const stop = vi.fn(() => true)
    const notify = vi.fn(async () => undefined)
    const stopWatching = startRunWatchdog({
      intervalMs: 1_000,
      now: () => now,
      stop,
      notify,
      list: () => [
        {
          runId: "wedged",
          roomId: "room-a",
          lastActivityAt: now - TURN_STALL_MS - 1,
          toolsInFlight: 0,
        },
        { runId: "working", roomId: "room-b", lastActivityAt: now - 1_000, toolsInFlight: 0 },
        {
          runId: "tool-running",
          roomId: "room-c",
          lastActivityAt: now - TURN_STALL_MS - 1,
          toolsInFlight: 1,
        },
      ],
    })

    vi.advanceTimersByTime(1_000)

    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith("wedged")
    expect(notify).toHaveBeenCalledWith(
      "room-a",
      expect.objectContaining({ type: "run.step", kind: "watchdog", runId: "wedged" }),
    )
    stopWatching()
    vi.advanceTimersByTime(5_000)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it("does not report a stop it could not perform", () => {
    vi.useFakeTimers()
    const now = 10_000_000
    const stop = vi.fn(() => false)
    const notify = vi.fn(async () => undefined)
    const stopWatching = startRunWatchdog({
      intervalMs: 1_000,
      now: () => now,
      stop,
      notify,
      list: () => [
        {
          runId: "elsewhere",
          roomId: "room-a",
          lastActivityAt: now - TURN_STALL_MS - 1,
          toolsInFlight: 0,
        },
      ],
    })
    vi.advanceTimersByTime(1_000)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
    stopWatching()
  })
})
