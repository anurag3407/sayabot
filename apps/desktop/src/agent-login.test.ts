import { describe, expect, it } from "vitest"
import { canSignIn, cleanCode, loginUrl } from "./agent-login"

describe("agent sign-in", () => {
  it("is offered for Antigravity only", () => {
    expect(canSignIn("antigravity")).toBe(true)
    expect(canSignIn("claude-code")).toBe(false)
  })

  it("finds the Google link in what `agy acp --login` prints", () => {
    const printed = [
      "Open this link in a browser to log in with Google:",
      "",
      "  https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=x&state=y",
      "",
      "Then paste the authorization code, or the full URL of the page you land on, and press Enter:",
    ].join("\n")
    expect(loginUrl(printed)).toBe(
      "https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=x&state=y",
    )
    expect(loginUrl("Starting…")).toBeNull()
    expect(loginUrl("https://evil.example/accounts.google.com/x")).toBeNull()
  })

  it("passes one line of code or URL, nothing else", () => {
    expect(cleanCode("  4/0AbC-dEf  ")).toBe("4/0AbC-dEf")
    expect(cleanCode("https://antigravity.google/oauth-callback?code=1")).toBe(
      "https://antigravity.google/oauth-callback?code=1",
    )
    expect(cleanCode("a\nb")).toBeNull()
    expect(cleanCode("")).toBeNull()
    expect(cleanCode("x".repeat(5_000))).toBeNull()
    expect(cleanCode(42)).toBeNull()
  })
})
