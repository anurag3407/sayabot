import { decryptSecret } from "@sayabot/llm"
import { describe, expect, it } from "vitest"
import { WORKS_ON_OPTIONS } from "@/lib/works-on"
import { computerSettingsUpdate } from "@/lib/computer-settings"
import { visibleSettingsGroups } from "@/lib/settings-nav"

const KEK = Buffer.alloc(32, 7).toString("base64")

describe("Settings → Computers", () => {
  it("is one app setting for the Boat key, the VPS, and this Mac", () => {
    const link = visibleSettingsGroups(false)
      .flatMap((group) => group.links)
      .find((item) => item.segment === "computers")
    expect(link?.label).toBe("Computers")
    expect(link?.adminOnly).toBe(false)
    expect(link?.description).toContain("Boat key")
    expect(link?.description).toContain("VPS")
    expect(link?.description).toContain("Mac")
  })

  it("seals the Boat key and keeps it out of the saved row", () => {
    const token = "boat_workspace_key"
    const built = computerSettingsUpdate({
      orgId: "org-1",
      boatToken: token,
      vpsSshAlias: "lab.example",
      vpsStartAutomatically: true,
      kek: KEK,
      now: "2026-11-15T00:00:00.000Z",
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(JSON.stringify(built.row)).not.toContain(token)
    expect(built.row.boat_last4).toBe(token.slice(-4))
    expect(built.row.vps_ssh_alias).toBe("lab.example")
    expect(
      decryptSecret(
        {
          ciphertext: String(built.row.boat_ciphertext),
          iv: String(built.row.boat_iv),
          tag: String(built.row.boat_tag),
        },
        KEK,
      ),
    ).toBe(token)
    expect(computerSettingsUpdate({ orgId: "org-1", boatToken: "sk-nope", kek: KEK }).ok).toBe(false)
    const cleared = computerSettingsUpdate({ orgId: "org-1", clearBoat: true, kek: KEK, now: "2026-11-15T00:00:00.000Z" })
    expect(cleared.ok && cleared.row.boat_ciphertext).toBeNull()
  })

  it("explains each Works on choice", () => {
    const text = WORKS_ON_OPTIONS.map((option) => option[2]).join(" ")
    expect(text).toContain("does not create or wake a Boat")
    expect(text).toContain("Off until you turn it on")
    expect(text).toContain("files stay")
    expect(text).toContain("10 idle minutes")
    expect(text).toContain("/home/user")
    expect(text).toContain("does not turn that server off")
  })
})