import { describe, expect, it } from "vitest"
import { isHostAllowed } from "../../src/swapper"

describe("isHostAllowed", () => {
  it("exact match only", () => {
    expect(isHostAllowed("api.github.com", ["api.github.com"])).toBe(true)
    expect(isHostAllowed("evilapi.github.com", ["api.github.com"])).toBe(false)
    expect(isHostAllowed("api.github.com.evil.com", ["api.github.com"])).toBe(false)
  })

  it("wildcard matches subdomains, apex, but not lookalikes", () => {
    expect(isHostAllowed("a.b.github.com", ["*.github.com"])).toBe(true)
    expect(isHostAllowed("github.com", ["*.github.com"])).toBe(true) // apex matches *.root by design
    expect(isHostAllowed("notgithub.com", ["*.github.com"])).toBe(false)
    expect(isHostAllowed("github.com.evil.com", ["*.github.com"])).toBe(false)
  })

  it("empty allowlist denies everything; any-match wins", () => {
    expect(isHostAllowed("api.github.com", [])).toBe(false)
    expect(isHostAllowed("api.stripe.com", ["api.github.com", "*.stripe.com"])).toBe(true)
  })
})
