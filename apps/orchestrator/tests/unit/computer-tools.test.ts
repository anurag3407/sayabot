import { describe, expect, it } from "vitest"
import { replaceLiteral, shellQuote } from "../../src/tools/builtins/computer"

describe("shellQuote", () => {
  it("wraps in single quotes and escapes embedded quotes", () => {
    expect(shellQuote("abc")).toBe("'abc'")
    expect(shellQuote("a'b")).toBe("'a'\\''b'")
    expect(shellQuote("")).toBe("''")
  })
})

describe("replaceLiteral", () => {
  it("replaces the first occurrence by default, all with the flag", () => {
    expect(replaceLiteral("a-a-a", "a", "b", false)).toBe("b-a-a")
    expect(replaceLiteral("a-a-a", "a", "b", true)).toBe("b-b-b")
  })
  it("is literal: $ and regex chars have no special meaning", () => {
    expect(replaceLiteral("cost: $5 and $5", "$5", "$9", false)).toBe("cost: $9 and $5")
    expect(replaceLiteral("a.b", ".", "X", true)).toBe("aXb")
  })
  it("no match returns the input unchanged", () => {
    expect(replaceLiteral("hello", "z", "q", true)).toBe("hello")
  })
})
