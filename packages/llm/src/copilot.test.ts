import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CopilotAuthError,
  clearCopilotSessions,
  copilotFetch,
  copilotSessionToken,
  isCopilotBaseUrl,
} from "./copilot"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

afterEach(() => clearCopilotSessions())

describe("copilot", () => {
  it("swaps a GitHub token for a Copilot token and reuses it until it nearly expires", async () => {
    let now = 1_000_000
    const fetch = vi.fn(async () =>
      json({ token: "tid=abc", expires_at: (now + 30 * 60_000) / 1000 }),
    )
    const first = await copilotSessionToken("gho_secret", { fetch, now: () => now })
    const second = await copilotSessionToken("gho_secret", { fetch, now: () => now })
    expect(first).toBe("tid=abc")
    expect(second).toBe("tid=abc")
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "token gho_secret" })
    now += 29.5 * 60_000
    await copilotSessionToken("gho_secret", { fetch, now: () => now })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it("passes a token that is not a GitHub token through untouched", async () => {
    const fetch = vi.fn()
    expect(await copilotSessionToken("tid=already-copilot", { fetch })).toBe("tid=already-copilot")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("explains a refused account without echoing the token", async () => {
    const fetch = vi.fn(async () => json({ message: "Not Found" }, 404))
    const failure = copilotSessionToken("gho_topsecret", { fetch })
    await expect(failure).rejects.toBeInstanceOf(CopilotAuthError)
    await expect(copilotSessionToken("gho_topsecret", { fetch })).rejects.not.toThrow(/topsecret/)
  })

  it("signs each API call with the Copilot token and Copilot's client headers", async () => {
    const base = vi.fn(async (input: string | URL | Request) =>
      String(input).includes("copilot_internal")
        ? json({ token: "tid=xyz", expires_at: Date.now() / 1000 + 1800 })
        : json({ ok: true }),
    )
    const signed = copilotFetch("ghu_secret", base)
    await signed("https://api.githubcopilot.com/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer ghu_secret" },
    })
    const call = base.mock.calls.find(([url]) => String(url).includes("chat/completions"))
    const headers = new Headers(call?.[1]?.headers)
    expect(headers.get("authorization")).toBe("Bearer tid=xyz")
    expect(headers.get("copilot-integration-id")).toBe("vscode-chat")
  })

  it("recognises Copilot base URLs", () => {
    expect(isCopilotBaseUrl("https://api.githubcopilot.com")).toBe(true)
    expect(isCopilotBaseUrl("https://api.individual.githubcopilot.com/")).toBe(true)
    expect(isCopilotBaseUrl("https://openrouter.ai/api/v1")).toBe(false)
    expect(isCopilotBaseUrl(null)).toBe(false)
  })
})
