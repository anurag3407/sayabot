import { describe, expect, it } from "vitest"
import { LOCAL_AGENT_APPS, localAgentStatus } from "@/lib/local-agents-shared"

describe("localAgentStatus", () => {
  it("reads installed + signed in as ready", () => {
    expect(localAgentStatus({ installed: true, signedIn: true })).toBe("ready")
    expect(localAgentStatus({ installed: true, signedIn: false })).toBe("signed_out")
    expect(localAgentStatus({ installed: true, signedIn: null })).toBe("installed")
    expect(localAgentStatus({ installed: false, signedIn: false })).toBe("not_installed")
  })

  it("trusts a login even when the program isn't on the server's PATH", () => {
    expect(localAgentStatus({ installed: false, signedIn: true })).toBe("ready")
  })

  it("every app maps to an invite app", () => {
    for (const app of LOCAL_AGENT_APPS) expect(app.inviteApp.length).toBeGreaterThan(0)
  })
})

import { effectiveProvider } from "@/lib/format"

describe("effectiveProvider", () => {
  it("recovers OpenRouter and Copilot from their base URLs", () => {
    expect(effectiveProvider("openai-compatible", "https://openrouter.ai/api/v1")).toBe("openrouter")
    expect(effectiveProvider("openai-compatible", "https://api.githubcopilot.com")).toBe("copilot")
    expect(effectiveProvider("openai-compatible", "http://localhost:11434/v1")).toBe("openai-compatible")
    expect(effectiveProvider("anthropic", null)).toBe("anthropic")
  })
})

import { formatBytes } from "@/lib/format"

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(0)).toBe("0 KB")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(1536)).toBe("1.5 KB")
    expect(formatBytes(1024 * 1024)).toBe("1 MB")
    expect(formatBytes(1.4 * 1024 ** 3)).toBe("1.4 GB")
  })
})
