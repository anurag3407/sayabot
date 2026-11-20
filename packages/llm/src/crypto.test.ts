import { describe, expect, it } from "vitest"
import { decryptSecret, encryptSecret, last4, openSecret, parseKek, sealSecret } from "./crypto"

const kek = Buffer.alloc(32, 7).toString("base64")

describe("AES-256-GCM secrets", () => {
  it("round-trips a column envelope with a fresh IV", () => {
    const a = encryptSecret("sk-test-1234567890", kek)
    const b = encryptSecret("sk-test-1234567890", kek)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(decryptSecret(a, kek)).toBe("sk-test-1234567890")
  })

  it("rejects a tampered ciphertext or tag", () => {
    const secret = encryptSecret("hello", kek)
    const tamperedTag = { ...secret, tag: Buffer.alloc(16, 1).toString("base64") }
    expect(() => decryptSecret(tamperedTag, kek)).toThrow()
    const tamperedCiphertext = {
      ...secret,
      ciphertext: Buffer.from("tampered").toString("base64"),
    }
    expect(() => decryptSecret(tamperedCiphertext, kek)).toThrow()
  })

  it("fails with the wrong key", () => {
    const secret = encryptSecret("hello", kek)
    const other = Buffer.alloc(32, 8).toString("base64")
    expect(() => decryptSecret(secret, other)).toThrow()
  })

  it("validates the key length", () => {
    expect(() => parseKek(Buffer.alloc(16, 1).toString("base64"))).toThrow(/32 bytes/)
  })

  it("round-trips the single-column envelope", () => {
    const sealed = sealSecret(JSON.stringify({ token: "abc" }), kek)
    expect(openSecret(sealed, kek)).toBe('{"token":"abc"}')
  })

  it("returns the last four characters", () => {
    expect(last4("sk-abcdefgh1234")).toBe("1234")
  })
})
