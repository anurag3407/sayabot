import { describe, expect, it } from "vitest"
import { canOpenHost, hostOnline, parseRemoteInput } from "./remote"

describe("canOpenHost", () => {
  const base = { ownerId: "u1", viewerId: "u2", hostOrgId: "o1", whoCanControl: "members" as const, viewerOrgRole: "member" as const }
  it("always lets the owner in", () => {
    expect(canOpenHost({ ...base, viewerId: "u1", hostOrgId: null, whoCanControl: "only_me", viewerOrgRole: null })).toBe(true)
  })
  it("respects who can control", () => {
    expect(canOpenHost(base)).toBe(true)
    expect(canOpenHost({ ...base, whoCanControl: "admins" })).toBe(false)
    expect(canOpenHost({ ...base, whoCanControl: "admins", viewerOrgRole: "admin" })).toBe(true)
    expect(canOpenHost({ ...base, whoCanControl: "only_me", viewerOrgRole: "owner" })).toBe(false)
  })
  it("needs the host shared with a workspace the viewer is in", () => {
    expect(canOpenHost({ ...base, hostOrgId: null })).toBe(false)
    expect(canOpenHost({ ...base, viewerOrgRole: null })).toBe(false)
  })
})

describe("hostOnline", () => {
  it("is online within 30 seconds of the last heartbeat", () => {
    const now = Date.now()
    expect(hostOnline(new Date(now - 5_000), now)).toBe(true)
    expect(hostOnline(new Date(now - 60_000), now)).toBe(false)
    expect(hostOnline(null, now)).toBe(false)
  })
})

describe("parseRemoteInput", () => {
  it("clamps coordinates and normalizes buttons", () => {
    expect(parseRemoteInput({ t: "move", x: 1.4, y: -2 })).toEqual({ t: "move", x: 1, y: 0 })
    expect(parseRemoteInput({ t: "down", x: 0.5, y: 0.5, b: 7 })).toEqual({ t: "down", x: 0.5, y: 0.5, b: 0 })
    expect(parseRemoteInput({ t: "up", x: 0.5, y: 0.5, b: 2 })).toMatchObject({ b: 2 })
  })
  it("drops junk", () => {
    expect(parseRemoteInput({ t: "move", x: "a", y: 1 })).toBeNull()
    expect(parseRemoteInput({ t: "exec", cmd: "rm -rf" })).toBeNull()
    expect(parseRemoteInput({ t: "text", s: "" })).toBeNull()
    expect(parseRemoteInput({ t: "scroll", dy: 0, dx: 0 })).toBeNull()
    expect(parseRemoteInput(null)).toBeNull()
  })
  it("keeps only known modifier keys", () => {
    expect(parseRemoteInput({ t: "key", key: "c", mods: ["cmd", "sudo", 4] })).toEqual({ t: "key", key: "c", mods: ["cmd"] })
  })
})
