import { describe, expect, it } from "vitest"
import { assertSafeWebhookUrl, isPrivateIp } from "../../src/ssrf"

describe("orchestrator isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.0.1", "169.254.169.254", "100.64.1.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "ff02::1", "2001:db8::1", "::ffff:192.168.1.1", "not-an-ip"])("private: %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true)
  })
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "2001:4860:4860::8888"])("public: %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false)
  })
})

describe("assertSafeWebhookUrl", () => {
  it("rejects non-http(s), credentials, and bad URLs", async () => {
    await expect(assertSafeWebhookUrl("ftp://example.com/x", false)).rejects.toThrow(/http or https/)
    await expect(assertSafeWebhookUrl("https://user:pass@example.com/x", false)).rejects.toThrow(/credentials/)
    await expect(assertSafeWebhookUrl("not a url", false)).rejects.toThrow(/invalid/)
  })

  it("blocks private hostnames and private IP literals", async () => {
    for (const u of ["https://localhost/x", "https://foo.localhost/x", "https://a.local/x", "https://a.internal/x", "https://127.0.0.1/x", "https://10.0.0.1/x"]) {
      await expect(assertSafeWebhookUrl(u, false), u).rejects.toThrow(/private/)
    }
  })

  it("allows public IP literals without DNS", async () => {
    await expect(assertSafeWebhookUrl("https://8.8.8.8/hook", false)).resolves.toBeInstanceOf(URL)
  })

  it("allowPrivate bypasses host checks entirely", async () => {
    await expect(assertSafeWebhookUrl("https://localhost:9999/x", true)).resolves.toBeInstanceOf(URL)
    await expect(assertSafeWebhookUrl("https://127.0.0.1/x", true)).resolves.toBeInstanceOf(URL)
  })
})
