import { describe, expect, it } from "vitest"
import { assertSecretQuery, passwordArgv, summarizeItems } from "./passwords"

describe("password managers", () => {
  it("refuses flag-like names", () => {
    expect(() => assertSecretQuery("-reveal")).toThrow(/isn't allowed/)
    expect(() => assertSecretQuery("hello\nworld")).toThrow(/isn't allowed/)
  })

  it("builds a fixed command and never puts the token in it", () => {
    expect(passwordArgv("onepassword", "read", "Login", "Employee")).toEqual({
      bin: "op",
      args: ["item", "get", "Login", "--format", "json", "--reveal", "--vault", "Employee"],
    })
    expect(passwordArgv("bitwarden", "search", "wifi")).toEqual({
      bin: "bw",
      args: ["list", "items", "--search", "wifi"],
    })
    expect(passwordArgv("protonpass", "read", "Bank").args.join(" ")).not.toMatch(/token|secret/i)
  })

  it("search results are titles and ids", () => {
    expect(summarizeItems([{ id: "1", title: "Wifi", password: "nope" }])).toEqual([{ id: "1", title: "Wifi" }])
  })
})
