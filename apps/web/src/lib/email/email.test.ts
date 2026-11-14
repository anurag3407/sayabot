import { describe, expect, it } from "vitest"
import {
  renderMagicLinkTemplate,
  renderPasswordResetTemplate,
  renderRoomInviteTemplate,
  renderVerificationTemplate,
  renderWorkspaceInviteTemplate,
} from "./index"

describe("Email Templates Suite", () => {
  it("renders verification template with 6-digit code and verify link", () => {
    const { subject, html, text } = renderVerificationTemplate({
      code: "123456",
      link: "https://sayalabs.in/auth/callback?code=test",
      name: "Alice",
    })

    expect(subject).toBe("Verify your Sayalabs account")
    expect(html).toContain("123456")
    expect(html).toContain("https://sayalabs.in/auth/callback?code=test")
    expect(html).toContain("Alice")
    expect(text).toContain("123456")
  })

  it("renders magic link template with OTP code and sign-in link", () => {
    const { subject, html, text } = renderMagicLinkTemplate({
      code: "654321",
      link: "https://sayalabs.in/auth/callback?code=magic",
    })

    expect(subject).toBe("Your Sayalabs sign-in code")
    expect(html).toContain("654321")
    expect(html).toContain("https://sayalabs.in/auth/callback?code=magic")
    expect(text).toContain("654321")
  })

  it("renders password reset template with action link", () => {
    const { subject, html, text } = renderPasswordResetTemplate({
      link: "https://sayalabs.in/auth/complete?type=recovery",
    })

    expect(subject).toBe("Reset your Sayalabs password")
    expect(html).toContain("https://sayalabs.in/auth/complete?type=recovery")
    expect(text).toContain("Reset your Sayalabs password")
  })

  it("renders workspace invite template with inviter and role details", () => {
    const { subject, html, text } = renderWorkspaceInviteTemplate({
      inviterName: "Anurag Mishra",
      workspaceName: "Sayalabs Core",
      role: "admin",
      joinUrl: "https://sayalabs.in/join/j_12345",
      isExistingUser: false,
    })

    expect(subject).toContain("Anurag Mishra invited you to join Sayalabs Core")
    expect(html).toContain("Sayalabs Core")
    expect(html).toContain("Workspace Admin")
    expect(html).toContain("https://sayalabs.in/join/j_12345")
    expect(text).toContain("Anurag Mishra")
  })

  it("renders room invite template", () => {
    const { subject, html, text } = renderRoomInviteTemplate({
      inviterName: "Anurag",
      roomName: "general",
      joinUrl: "https://sayalabs.in/org/r/general",
    })

    expect(subject).toContain("#general")
    expect(html).toContain("#general")
    expect(html).toContain("https://sayalabs.in/org/r/general")
    expect(text).toContain("#general")
  })
})
