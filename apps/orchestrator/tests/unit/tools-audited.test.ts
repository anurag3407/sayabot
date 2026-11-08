import { describe, expect, it } from "vitest"
import { redactValue } from "../../src/tools/audited"

describe("redactValue", () => {
  it("redacts known secret patterns in strings, deeply", () => {
    const out = redactValue({ a: ["token sk-1234567890abcdefghij", { b: "hello" }], n: 42 }) as any
    expect(out.a[0]).not.toContain("sk-1234567890abcdefghij")
    expect(out.a[1].b).toBe("hello")
    expect(out.n).toBe(42)
  })

  it("applies the run scrubber before pattern redaction", () => {
    const out = redactValue("my-secret-value here", (s) => s.replaceAll("my-secret-value", "[scrubbed]"))
    expect(out).toBe("[scrubbed] here")
  })

  it("truncates beyond depth 8 instead of recursing forever", () => {
    let deep: any = "leaf"
    for (let i = 0; i < 12; i++) deep = { next: deep }
    const out = redactValue(deep)
    expect(JSON.stringify(out)).toContain("[truncated]")
  })

  it("passes through null/undefined/numbers/booleans untouched", () => {
    expect(redactValue(null)).toBeNull()
    expect(redactValue(undefined)).toBeUndefined()
    expect(redactValue(3.14)).toBe(3.14)
    expect(redactValue(true)).toBe(true)
  })
})
