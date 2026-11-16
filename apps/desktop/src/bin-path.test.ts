import { describe, expect, it } from "vitest"
import { quoteForCmd } from "./bin-path"

describe("quoteForCmd", () => {
  it("leaves plain tokens alone and quotes spaces", () => {
    expect(quoteForCmd("claude")).toBe("claude")
    expect(quoteForCmd("")).toBe('""')
    expect(quoteForCmd("C:\\Program Files\\Sayabot\\Sayabot.exe")).toBe(
      '"C:\\Program Files\\Sayabot\\Sayabot.exe"',
    )
  })
})
