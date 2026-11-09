import { describe, expect, it } from "vitest"
import { colorForUser, peersFromAwareness, remoteCursorCss } from "@/lib/canvas-presence"

describe("canvas presence", () => {
  it("gives a person the same colour every time", () => {
    expect(colorForUser("user-a")).toBe(colorForUser("user-a"))
    expect(colorForUser("user-a")).toMatch(/^#[0-9a-f]{6}$/)
  })

  it("leaves out this client and states with no user", () => {
    const states = new Map<number, unknown>([
      [1, { user: { id: "me", name: "Me", color: "#112233" } }],
      [2, {}],
      [3, { user: { id: "them", name: "Them", color: "#445566" } }],
    ])
    expect(peersFromAwareness(states, 1).map((peer) => peer.clientId)).toEqual([3])
  })

  it("does not let a peer inject CSS through its colour or name", () => {
    const peers = peersFromAwareness(
      new Map([[7, { user: { id: "x", name: 'a"}body{display:none}', color: "red;}body{display:none" } }]]),
      1,
    )
    const css = remoteCursorCss(peers)
    expect(css).not.toContain("body{display")
    expect(css).not.toContain("red;")
    expect(css).toContain('content:"abodydisplaynone"')
  })

  it("keeps names in other scripts", () => {
    const css = remoteCursorCss([{ clientId: 1, userId: "u", name: "अनुराग", color: "#112233" }])
    expect(css).toContain("अनु")
  })
})
