import { describe, expect, it } from "vitest"
import { recoveryHint, retryHelps } from "@/lib/recovery-hint"
import { replySourceLabel, runsOnLabel } from "@/lib/runs-on"

const base = { orgSlug: "acme", roomId: "r1", text: "", reason: null }

describe("the way forward from a failed reply", () => {
  it("offers Switch model instead of Retry when retrying fails the same way", () => {
    expect(recoveryHint({ ...base, kind: "request_too_large" })).toEqual({ label: "Switch model", action: "switch_model" })
    expect(retryHelps("request_too_large")).toBe(false)
    expect(retryHelps("auth_error")).toBe(false)
  })

  it("keeps Retry for passing trouble and a Mac that's off", () => {
    expect(retryHelps("rate_limit")).toBe(true)
    expect(retryHelps("mac_offline")).toBe(true)
    expect(retryHelps(null)).toBe(true)
    expect(recoveryHint({ ...base, kind: "mac_offline" })?.action).toBe("switch_model")
  })

  it("sends key and computer problems to the page that fixes them", () => {
    expect(recoveryHint({ ...base, kind: "auth_error" })?.href).toBe("/acme/settings/keys")
    expect(recoveryHint({ ...base, kind: "runner_off" })?.href).toBe("/acme/settings/computers")
  })
})

describe("where a bot answers from", () => {
  const host = "11111111-1111-1111-1111-111111111111"
  it("names the Mac app and model, a key, or Sayabot's model", () => {
    expect(runsOnLabel({ params: { runner: { hostId: host, app: "claude-code", model: "claude-opus-5-5" } } })).toBe(
      "Claude Code · claude-opus-5-5 on your Mac",
    )
    expect(runsOnLabel({ params: {}, provider_key_id: "k1", model: "gpt-oss-120b" })).toBe("gpt-oss-120b · API key")
    expect(runsOnLabel({ params: {}, model: "saya/pro" })).toBe("Sayabot's model")
  })

  it("labels each reply from its own metadata", () => {
    expect(replySourceLabel({ runsOn: "ollama", where: "mac", model: "llama3.2" })).toBe("Ollama · llama3.2 on your Mac")
    expect(replySourceLabel({ runsOn: "codex" })).toBe("Codex on the server")
    expect(replySourceLabel({ model: "openai/gpt-oss-120b" })).toBe("openai/gpt-oss-120b")
    expect(replySourceLabel({})).toBeNull()
  })
})
