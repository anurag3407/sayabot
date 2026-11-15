import { describe, expect, it } from "vitest"
import { hostAuthPlan } from "./host-auth"

const url = "https://sayabot.sayalabs.in"

describe("hostAuthPlan", () => {
  it("registers when nothing is saved or the server changed", () => {
    expect(hostAuthPlan(null, url, "u1")).toBe("register")
    expect(hostAuthPlan({ serverUrl: "https://other.example", userId: "u1" }, url, "u1")).toBe(
      "register",
    )
  })

  it("reuses the registration of the same account", () => {
    expect(hostAuthPlan({ serverUrl: url, userId: "u1" }, url, "u1")).toBe("reuse")
  })

  it("registers again when another account is signed in now", () => {
    // A new guest after the old login expired must not report into the old account.
    expect(hostAuthPlan({ serverUrl: url, userId: "old-guest" }, url, "new-guest")).toBe("register")
  })

  it("verifies registrations saved before the account was recorded", () => {
    expect(hostAuthPlan({ serverUrl: url }, url, "u1")).toBe("verify")
  })

  it("keeps the saved one when the session does not say who it is", () => {
    expect(hostAuthPlan({ serverUrl: url }, url, "")).toBe("reuse")
  })
})
