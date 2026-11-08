import { describe, expect, it } from "vitest"
import { scrubResponseText } from "../../src/scrub"

describe("scrubResponseText edge cases", () => {
  it("empty map is identity", () => {
    expect(scrubResponseText("hello", new Map())).toBe("hello")
  })

  it("ignores secrets shorter than 4 chars (avoids destroying text)", () => {
    const m = new Map([["abc", "[X]"]])
    expect(scrubResponseText("abc abc", m)).toBe("abc abc")
  })

  it("replaces every occurrence, raw + base64 + url-encoded", () => {
    const secret = "tok en/with+specials"
    const m = new Map([[secret, "saaya_ph_x"]])
    const b64 = Buffer.from(secret).toString("base64")
    const url = encodeURIComponent(secret)
    const input = `a=${secret} b=${secret} c=${b64} d=${url}`
    const out = scrubResponseText(input, m)
    expect(out).not.toContain(secret)
    expect(out).not.toContain(b64)
    expect(out).not.toContain(url)
    expect(out.match(/saaya_ph_x/g)).toHaveLength(4)
  })

  it("multiple secrets are all scrubbed", () => {
    const m = new Map([["secret-one", "[1]"], ["secret-two", "[2]"]])
    expect(scrubResponseText("secret-one and secret-two", m)).toBe("[1] and [2]")
  })

  it("empty text stays empty", () => {
    expect(scrubResponseText("", new Map([["secret-one", "[1]"]]))).toBe("")
  })
})
