import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }))

const { pickDefaultApp, withLocalDefault } = await import("@/lib/desktop-hosts")

const ready = (id: string) => ({ id, status: "ready" })
const signedOut = (id: string) => ({ id, status: "not_signed_in" })

describe("pickDefaultApp", () => {
  it("prefers Claude Code, then Codex, then the others", () => {
    expect(pickDefaultApp([ready("opencode"), ready("codex"), ready("claude-code")])).toBe(
      "claude-code",
    )
    expect(pickDefaultApp([ready("gemini"), ready("codex")])).toBe("codex")
  })

  it("ignores apps that are installed but not signed in", () => {
    expect(pickDefaultApp([signedOut("claude-code"), ready("gemini")])).toBe("gemini")
    expect(pickDefaultApp([signedOut("claude-code")])).toBeNull()
  })
})

describe("withLocalDefault (Mac runs agents by default)", () => {
  it("turns the runner and the default on the first time an app is signed in", () => {
    expect(withLocalDefault({ whoCanControl: "only_me" }, [ready("codex")])).toEqual({
      whoCanControl: "only_me",
      runnerEnabled: true,
      localDefault: { app: "codex" },
    })
  })

  it("does nothing until an app is signed in", () => {
    expect(withLocalDefault({}, [signedOut("claude-code")])).toBeNull()
  })

  it("never turns it back on after the owner turned it off", () => {
    expect(withLocalDefault({ localDefault: false }, [ready("claude-code")])).toBeNull()
  })

  it("leaves a working choice alone, even if a better app appears", () => {
    const settings = { runnerEnabled: true, localDefault: { app: "codex" } }
    expect(withLocalDefault(settings, [ready("codex"), ready("claude-code")])).toBeNull()
  })

  it("switches apps when the chosen one is signed out", () => {
    const settings = { runnerEnabled: true, localDefault: { app: "claude-code" } }
    expect(withLocalDefault(settings, [signedOut("claude-code"), ready("gemini")])).toEqual({
      runnerEnabled: true,
      localDefault: { app: "gemini" },
    })
  })
})
