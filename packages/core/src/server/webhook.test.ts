import { describe, expect, it } from "vitest"
import { generateWebhookSecret, signWebhook, verifyWebhook } from "./webhook"

const secret = generateWebhookSecret()
const body = JSON.stringify({ event: "message.created", content: "hello" })
const id = "msg_123"
const now = 1_800_000_000

describe("webhook signatures", () => {
  it("verifies a freshly signed payload", () => {
    const timestamp = now
    const signature = signWebhook({ secret, id, timestamp, body })
    expect(
      verifyWebhook({ secret, id, timestamp: String(timestamp), signature, body, nowSeconds: now }),
    ).toEqual({ valid: true })
  })

  it("rejects a tampered body", () => {
    const timestamp = now
    const signature = signWebhook({ secret, id, timestamp, body })
    const result = verifyWebhook({
      secret,
      id,
      timestamp: String(timestamp),
      signature,
      body: body + "x",
      nowSeconds: now,
    })
    expect(result.valid).toBe(false)
    expect(result.reason).toBe("signature mismatch")
  })

  it("rejects the wrong secret", () => {
    const timestamp = now
    const signature = signWebhook({ secret, id, timestamp, body })
    const result = verifyWebhook({
      secret: generateWebhookSecret(),
      id,
      timestamp: String(timestamp),
      signature,
      body,
      nowSeconds: now,
    })
    expect(result.valid).toBe(false)
  })

  it("rejects stale timestamps", () => {
    const timestamp = now - 301
    const signature = signWebhook({ secret, id, timestamp, body })
    const result = verifyWebhook({
      secret,
      id,
      timestamp: String(timestamp),
      signature,
      body,
      nowSeconds: now,
    })
    expect(result.reason).toBe("timestamp outside tolerance")
  })

  it("accepts a matching signature from a list", () => {
    const timestamp = now
    const signature = `v1,AAAA ${signWebhook({ secret, id, timestamp, body })}`
    expect(
      verifyWebhook({ secret, id, timestamp: String(timestamp), signature, body, nowSeconds: now })
        .valid,
    ).toBe(true)
  })

  it("rejects missing headers", () => {
    expect(
      verifyWebhook({ secret, id: undefined, timestamp: undefined, signature: undefined, body }),
    ).toEqual({ valid: false, reason: "missing signature headers" })
  })
})
