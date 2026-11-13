import { homedir } from "node:os"
import { join } from "node:path"

/**
 * Where model lists and catalogs are cached on disk. Under `providers/` so a backup of the data
 * folder can leave it out. SAYABOT_DATA_DIR moves it; the default is ~/.sayabot.
 */
export function modelDataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.SAYABOT_DATA_DIR?.trim() || join(homedir(), ".sayabot")
}

export function providersCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(modelDataDir(env), "providers")
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface CappedResponse {
  status: number
  ok: boolean
  text: string
  etag?: string
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u

/** An ETag is echoed back in a request header: keep only a plain, short one. */
export function safeEtag(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 256 && !CONTROL.test(value)
    ? value
    : undefined
}

export class FetchCapError extends Error {}

/**
 * GET with a timeout, no redirects (a redirect must never replay a credential to another
 * address, and a catalog must come from where we meant), and a byte cap so a host cannot make
 * this process buffer an unbounded body. Throws on network failure or timeout.
 */
export async function fetchCapped(
  url: string,
  options: {
    headers?: Record<string, string>
    timeoutMs: number
    maxBytes: number
    fetch?: FetchLike
  },
): Promise<CappedResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await (options.fetch ?? fetch)(url, {
      headers: { "user-agent": "Sayabot", ...options.headers },
      redirect: "error",
      signal: controller.signal,
    })
    const declared = Number(response.headers.get("content-length"))
    if (Number.isFinite(declared) && declared > options.maxBytes) {
      void response.body?.cancel().catch(() => {})
      throw new FetchCapError(`sent more than ${options.maxBytes} bytes`)
    }
    const text = await readCapped(response, options.maxBytes)
    return {
      status: response.status,
      ok: response.ok,
      text,
      etag: safeEtag(response.headers.get("etag")),
    }
  } catch (error) {
    if (controller.signal.aborted) throw new Error("did not answer in time")
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ""
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new FetchCapError(`sent more than ${maxBytes} bytes`)
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Credentials go out only over HTTPS, or over plain HTTP to this computer. */
export function safeCredentialUrl(url: string): boolean {
  try {
    const target = new URL(url)
    if (target.protocol === "https:") return true
    if (target.protocol !== "http:") return false
    const host = target.hostname.replace(/^\[|\]$/g, "")
    return host === "localhost" || host === "127.0.0.1" || host === "::1"
  } catch {
    return false
  }
}
