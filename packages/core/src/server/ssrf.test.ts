import { describe, expect, it } from "vitest"
import { assertSafeEgressHost, isPrivateIp } from "./ssrf"

describe("SSRF Protection Core", () => {
  it("correctly identifies private and loopback IPv4 addresses", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true)
    expect(isPrivateIp("10.0.0.1")).toBe(true)
    expect(isPrivateIp("172.16.0.1")).toBe(true)
    expect(isPrivateIp("172.31.255.255")).toBe(true)
    expect(isPrivateIp("192.168.0.1")).toBe(true)
    expect(isPrivateIp("169.254.169.254")).toBe(true)
    expect(isPrivateIp("100.64.0.1")).toBe(true)
    expect(isPrivateIp("0.0.0.0")).toBe(true)
    expect(isPrivateIp("255.255.255.255")).toBe(true)
    // RFC 2544 benchmarking
    expect(isPrivateIp("198.18.0.1")).toBe(true)
    expect(isPrivateIp("198.19.255.254")).toBe(true)
    // TEST-NET
    expect(isPrivateIp("192.0.2.1")).toBe(true)
    expect(isPrivateIp("198.51.100.1")).toBe(true)
    expect(isPrivateIp("203.0.113.1")).toBe(true)
    // Multicast & Reserved
    expect(isPrivateIp("224.0.0.1")).toBe(true)
    expect(isPrivateIp("240.0.0.1")).toBe(true)
  })

  it("correctly identifies private IPv6 and IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateIp("::1")).toBe(true)
    expect(isPrivateIp("::")).toBe(true)
    expect(isPrivateIp("fe80::1")).toBe(true)
    expect(isPrivateIp("feb0::1")).toBe(true)
    expect(isPrivateIp("fc00::1")).toBe(true)
    expect(isPrivateIp("fd00::1")).toBe(true)
    expect(isPrivateIp("ff02::1")).toBe(true)
    expect(isPrivateIp("100::1")).toBe(true)
    expect(isPrivateIp("2001:db8::1")).toBe(true)

    // IPv4-mapped IPv6 addresses
    expect(isPrivateIp("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateIp("::ffff:169.254.169.254")).toBe(true)
    expect(isPrivateIp("::ffff:10.0.0.1")).toBe(true)
    expect(isPrivateIp("::ffff:7f00:1")).toBe(true)
    expect(isPrivateIp("::ffff:a9fe:a9fe")).toBe(true)

    // Bracketed IPv6 addresses
    expect(isPrivateIp("[::1]")).toBe(true)
    expect(isPrivateIp("[::ffff:169.254.169.254]")).toBe(true)
  })

  it("permits public IP addresses", () => {
    expect(isPrivateIp("8.8.8.8")).toBe(false)
    expect(isPrivateIp("1.1.1.1")).toBe(false)
    expect(isPrivateIp("::ffff:8.8.8.8")).toBe(false)
    expect(isPrivateIp("2607:f8b0:4005:805::200e")).toBe(false)
  })

  it("rejects private IPs and internal domains via assertSafeEgressHost", async () => {
    await expect(assertSafeEgressHost("127.0.0.1")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("169.254.169.254")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("::ffff:169.254.169.254")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("[::ffff:169.254.169.254]")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("[::1]")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("localhost")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("sub.localhost")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("metadata.google.internal")).rejects.toThrow(/SSRF blocked/)
    await expect(assertSafeEgressHost("kubernetes.default.svc.cluster.local")).rejects.toThrow(/SSRF blocked/)
  })
})
