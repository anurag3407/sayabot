import { describe, expect, it } from "vitest"
import { generateCodeChallenge, generateCodeVerifier } from "../../src/lib/connectors/pkce"

describe("PKCE (RFC 7636)", () => {
  it("verifier length is honoured and charset is base64url", () => {
    for (const len of [32, 43, 64, 128]) {
      const v = generateCodeVerifier(len)
      expect(v).toHaveLength(len)
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it("challenge is the base64url SHA-256 of the verifier (RFC test vector)", async () => {
    // RFC 7636 Appendix B
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
  })

  it("verifiers are unique", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })
})
