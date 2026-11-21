import { describe, expect, it } from "vitest"
import {
  GRANT_TTL_MS,
  MAX_STANDING_GRANTS,
  argsDigest,
  grantAllowed,
  matchStandingGrant,
  stableJson,
  standingGrants,
  withGrant,
  type StandingGrant,
} from "./grants"

const now = Date.parse("2026-01-01T00:00:00.000Z")

function grant(overrides: Partial<StandingGrant> = {}): StandingGrant {
  return {
    tool: "computer_shell",
    argsDigest: argsDigest({ command: "pnpm test" }),
    label: "computer_shell pnpm test",
    grantedBy: "profile-1",
    grantedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + GRANT_TTL_MS).toISOString(),
    ...overrides,
  }
}

describe("stableJson", () => {
  it("hashes equal arguments equally regardless of key order", () => {
    expect(stableJson({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      stableJson({ b: [1, { d: 3, c: 2 }], a: 1 }),
    )
    expect(argsDigest({ a: 1, b: 2 })).toBe(argsDigest({ b: 2, a: 1 }))
  })

  it("separates different arguments", () => {
    expect(argsDigest({ command: "pnpm test" })).not.toBe(argsDigest({ command: "pnpm test:unit" }))
  })
})

describe("grantAllowed", () => {
  it("covers ordinary work", () => {
    expect(grantAllowed("computer_shell")).toBe(true)
    expect(grantAllowed("fs_write")).toBe(true)
    expect(grantAllowed("git_commit")).toBe(true)
  })

  it("never covers credential reads, sends, installs or deletions", () => {
    expect(grantAllowed("use_secret")).toBe(false)
    expect(grantAllowed("vault_read")).toBe(false)
    expect(grantAllowed("slack_send_message")).toBe(false)
    expect(grantAllowed("gmail_send_email")).toBe(false)
    expect(grantAllowed("install_skill")).toBe(false)
    expect(grantAllowed("drive_delete_file")).toBe(false)
  })
})

describe("matchStandingGrant", () => {
  it("matches the exact call it was granted for", () => {
    const covered = [grant()]
    expect(matchStandingGrant(covered, "computer_shell", { command: "pnpm test" }, now)).not.toBe(
      null,
    )
    expect(
      matchStandingGrant(covered, "computer_shell", { command: "pnpm test --watch" }, now),
    ).toBeNull()
    expect(matchStandingGrant(covered, "fs_write", { command: "pnpm test" }, now)).toBeNull()
  })

  it("stops granting once it lapses", () => {
    const covered = [grant({ expiresAt: new Date(now - 1).toISOString() })]
    expect(matchStandingGrant(covered, "computer_shell", { command: "pnpm test" }, now)).toBeNull()
  })

  it("refuses a tool that may never be covered, even if a grant names it", () => {
    const covered = [grant({ tool: "use_secret", argsDigest: argsDigest({ name: "KEY" }) })]
    expect(matchStandingGrant(covered, "use_secret", { name: "KEY" }, now)).toBeNull()
  })
})

describe("withGrant", () => {
  it("keeps one entry per exact call and drops expired ones", () => {
    const expired = grant({
      argsDigest: argsDigest({ command: "old" }),
      expiresAt: new Date(now - 1).toISOString(),
    })
    const fresh = grant()
    const params = withGrant({ standingGrants: [expired] }, fresh, now)
    const list = standingGrants(params, now)
    expect(list).toHaveLength(1)
    expect(list[0]?.argsDigest).toBe(fresh.argsDigest)
  })

  it("caps the list so agent params stay small", () => {
    let params: Record<string, unknown> = {}
    for (let index = 0; index < MAX_STANDING_GRANTS + 5; index += 1) {
      params = withGrant(
        params,
        grant({ argsDigest: argsDigest({ command: `cmd-${index}` }) }),
        now,
      )
    }
    const list = standingGrants(params, now)
    expect(list).toHaveLength(MAX_STANDING_GRANTS)
    // Newest first.
    expect(list[0]?.argsDigest).toBe(argsDigest({ command: `cmd-${MAX_STANDING_GRANTS + 4}` }))
  })
})

describe("standingGrants", () => {
  it("ignores malformed entries instead of throwing", () => {
    expect(standingGrants({ standingGrants: [{ tool: "x" }, null, 3] }, now)).toEqual([])
    expect(standingGrants({ standingGrants: "nope" }, now)).toEqual([])
    expect(standingGrants(null, now)).toEqual([])
  })
})
