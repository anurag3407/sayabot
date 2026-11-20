import { describe, expect, it, vi } from "vitest"
import { classifyEngineError, executeWithRecovery } from "./recovery"

describe("Recovery and Retries (E6)", () => {
  it("classifies 429 rate limit with retry-after header parsing", () => {
    const err = new Error("Rate limit 429: please retry in 5.5 seconds")
    const res = classifyEngineError(err)
    expect(res.category).toBe("rate_limit")
    expect(res.retryable).toBe(true)
    expect(res.retryAfterMs).toBe(5500)
  })

  it("classifies 5xx and network errors as retryable", () => {
    const serverErr = classifyEngineError(new Error("503 Service Unavailable: overloaded"))
    expect(serverErr.category).toBe("server_error")
    expect(serverErr.retryable).toBe(true)

    const netErr = classifyEngineError(new Error("fetch failed: ECONNRESET"))
    expect(netErr.category).toBe("network")
    expect(netErr.retryable).toBe(true)
  })

  it("classifies context length exceeded as context_overflow", () => {
    const err = new Error("context_length_exceeded: maximum context length is 200000 tokens")
    const res = classifyEngineError(err)
    expect(res.category).toBe("context_overflow")
    expect(res.retryable).toBe(false)
  })

  it("classifies auth and quota errors properly", () => {
    const authErr = classifyEngineError(new Error("Invalid API key provided"))
    expect(authErr.category).toBe("auth_error")
    expect(authErr.retryable).toBe(false)

    const quotaErr = classifyEngineError(
      new Error("insufficient_quota: you exceeded your current quota"),
    )
    expect(quotaErr.category).toBe("quota_exhausted")
    expect(quotaErr.retryable).toBe(false)
  })

  it("retries retryable errors up to limit and recovers on success", async () => {
    let calls = 0
    const sleepSpy = vi.fn().mockResolvedValue(undefined)

    const operation = vi.fn().mockImplementation(async () => {
      calls++
      if (calls < 3) {
        throw new Error("502 Bad Gateway")
      }
      return "success"
    })

    const result = await executeWithRecovery(operation, {
      maxRetries: 4,
      baseDelayMs: 10,
      sleepFn: sleepSpy,
    })

    expect(result).toBe("success")
    expect(calls).toBe(3)
    expect(sleepSpy).toHaveBeenCalledTimes(2)
  })

  it("does not retry non-retryable errors", async () => {
    const sleepSpy = vi.fn()
    const operation = vi.fn().mockRejectedValue(new Error("Invalid API key"))

    await expect(executeWithRecovery(operation, { sleepFn: sleepSpy })).rejects.toThrow(
      "Invalid API key",
    )
    expect(sleepSpy).not.toHaveBeenCalled()
  })
})
