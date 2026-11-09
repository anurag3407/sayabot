export interface RetryOptions {
  maxRetries?: number
  baseDelayMs?: number
  maxDelayMs?: number
  timeoutMs?: number
  fetchFn?: typeof fetch
}

/**
 * Executes an HTTP fetch with automatic exponential backoff, jitter,
 * and rate-limit handling (HTTP 429 Retry-After header and 5xx transient server errors).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3
  const baseDelayMs = options.baseDelayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 8000
  const timeoutMs = options.timeoutMs ?? 25000
  const customFetch = options.fetchFn ?? fetch

  let attempt = 0

  while (true) {
    attempt++
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await customFetch(url, {
        ...init,
        signal: controller.signal,
      })
      clearTimeout(timeout)

      if (response.ok) {
        return response
      }

      // Check for rate limit (429) or transient server errors (500, 502, 503, 504)
      const isRateLimit = response.status === 429
      const isTransient = response.status >= 500 && response.status <= 504

      if ((isRateLimit || isTransient) && attempt <= maxRetries) {
        let delayMs = baseDelayMs * Math.pow(2, attempt - 1)

        // Parse standard Retry-After header if present
        const retryAfterHeader = response.headers.get("retry-after")
        if (retryAfterHeader) {
          const seconds = parseInt(retryAfterHeader, 10)
          if (!Number.isNaN(seconds)) {
            delayMs = seconds * 1000
          } else {
            const date = new Date(retryAfterHeader).getTime()
            if (!Number.isNaN(date)) {
              delayMs = Math.max(0, date - Date.now())
            }
          }
        }

        // Add random jitter between 0 and 250ms to prevent thundering herd
        const jitter = Math.floor(Math.random() * 250)
        const finalDelay = Math.min(maxDelayMs, delayMs + jitter)

        await new Promise((resolve) => setTimeout(resolve, finalDelay))
        continue
      }

      return response
    } catch (error: any) {
      clearTimeout(timeout)
      if (attempt <= maxRetries && error?.name !== "AbortError") {
        const jitter = Math.floor(Math.random() * 250)
        const finalDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1) + jitter)
        await new Promise((resolve) => setTimeout(resolve, finalDelay))
        continue
      }
      throw error
    }
  }
}
