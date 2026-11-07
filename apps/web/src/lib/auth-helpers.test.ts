import { describe, expect, it } from "vitest"
import { safeNextPath } from "./safe-next"

describe("safeNextPath", () => {
  it("allows relative paths", () => {
    expect(safeNextPath("/")).toBe("/")
    expect(safeNextPath("/onboarding")).toBe("/onboarding")
    expect(safeNextPath("/workspace-1/room/2")).toBe("/workspace-1/room/2")
    expect(safeNextPath("/settings?tab=profile")).toBe("/settings?tab=profile")
  })

  it("rejects open redirect attacks", () => {
    expect(safeNextPath("//evil.com")).toBe("/")
    expect(safeNextPath("/\\evil.com")).toBe("/")
    expect(safeNextPath("https://evil.com")).toBe("/")
    expect(safeNextPath("http://evil.com")).toBe("/")
    expect(safeNextPath("javascript:alert(1)")).toBe("/")
  })

  it("handles null or undefined with custom fallback", () => {
    expect(safeNextPath(null, "/fallback")).toBe("/fallback")
    expect(safeNextPath(undefined, "/fallback")).toBe("/fallback")
    expect(safeNextPath("", "/fallback")).toBe("/fallback")
  })
})

describe("OAuth metadata resolution", () => {
  function resolveOAuthProfile(user: {
    email?: string | null
    user_metadata?: Record<string, any>
  }) {
    const meta = user.user_metadata ?? {}
    const displayName =
      (typeof meta.full_name === "string" && meta.full_name.trim()) ||
      (typeof meta.name === "string" && meta.name.trim()) ||
      (typeof meta.user_name === "string" && meta.user_name.trim()) ||
      user.email?.split("@")[0] ||
      "member"
    const avatarUrl =
      (typeof meta.avatar_url === "string" && meta.avatar_url.trim()) ||
      (typeof meta.picture === "string" && meta.picture.trim()) ||
      null
    return { displayName, avatarUrl }
  }

  it("resolves Google OAuth metadata correctly", () => {
    const googleUser = {
      email: "alex@gmail.com",
      user_metadata: {
        name: "Alex Mercer",
        picture: "https://lh3.googleusercontent.com/a/photo.jpg",
      },
    }
    const profile = resolveOAuthProfile(googleUser)
    expect(profile.displayName).toBe("Alex Mercer")
    expect(profile.avatarUrl).toBe("https://lh3.googleusercontent.com/a/photo.jpg")
  })

  it("resolves GitHub OAuth metadata correctly", () => {
    const githubUser = {
      email: "octocat@github.com",
      user_metadata: {
        user_name: "octocat",
        avatar_url: "https://avatars.githubusercontent.com/u/583231",
      },
    }
    const profile = resolveOAuthProfile(githubUser)
    expect(profile.displayName).toBe("octocat")
    expect(profile.avatarUrl).toBe("https://avatars.githubusercontent.com/u/583231")
  })

  it("falls back to email prefix when metadata is empty", () => {
    const emailUser = {
      email: "engineer@company.org",
      user_metadata: {},
    }
    const profile = resolveOAuthProfile(emailUser)
    expect(profile.displayName).toBe("engineer")
    expect(profile.avatarUrl).toBeNull()
  })
})
