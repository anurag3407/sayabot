import { describe, expect, it } from "vitest"
import {
  formatPairingCode,
  isPairingCode,
  normalizePairingCode,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  pairingDeepLink,
} from "./pairing"
import { generateDeviceToken, generatePairingCode, hashAgentApiKey } from "./server"

describe("pairing codes", () => {
  it("generates codes only from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePairingCode()
      expect(code).toHaveLength(PAIRING_CODE_LENGTH)
      expect(isPairingCode(code)).toBe(true)
      expect([...code].every((ch) => PAIRING_ALPHABET.includes(ch))).toBe(true)
    }
  })

  it("normalizes what people type", () => {
    expect(normalizePairingCode(" abcd-2345 ")).toBe("ABCD2345")
    expect(normalizePairingCode("abcd 2345")).toBe("ABCD2345")
    expect(normalizePairingCode(null)).toBe("")
  })

  it("folds look-alikes so they never match a real code", () => {
    // O/I/L become 0/1, which the alphabet never uses, so a mistyped code fails cleanly.
    expect(isPairingCode(normalizePairingCode("ABCDOIL2"))).toBe(false)
  })

  it("formats for display and builds a deep link", () => {
    expect(formatPairingCode("ABCD2345")).toBe("ABCD-2345")
    expect(pairingDeepLink("ABCD2345", "https://x.test/")).toBe("sayabot://pair?code=ABCD2345&server=https%3A%2F%2Fx.test")
  })

  it("device tokens hash consistently", () => {
    const t = generateDeviceToken()
    expect(t.token.startsWith("sd_")).toBe(true)
    expect(t.hash).toBe(hashAgentApiKey(t.token))
  })
})
