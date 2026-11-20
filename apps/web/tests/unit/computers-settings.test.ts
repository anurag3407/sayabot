import { decryptSecret } from "@sayabot/llm"
import { describe, expect, it } from "vitest"
import { cloudProviderReady, type ComputerProvidersView } from "@/lib/computer-providers-shared"
import { computerProviderUpdate, parseSshAddress } from "@/lib/computer-settings"
import { visibleSettingsGroups } from "@/lib/settings-nav"
import { tileOf, WORKS_ON_OPTIONS } from "@/lib/works-on"

const KEK = Buffer.alloc(32, 7).toString("base64")
const NOW = "2026-11-17T00:00:00.000Z"
const KEY =
  "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----"

function open(row: Record<string, unknown>, prefix: string): string {
  return decryptSecret(
    {
      ciphertext: String(row[`${prefix}_ciphertext`]),
      iv: String(row[`${prefix}_iv`]),
      tag: String(row[`${prefix}_tag`]),
    },
    KEK,
  )
}

describe("Settings → Computers", () => {
  it("places AI providers above computers and below phones in the Account group", () => {
    const groups = visibleSettingsGroups(true)
    const accountGroup = groups.find((g) => g.label === "Account")
    expect(accountGroup).toBeDefined()
    const segments = accountGroup?.links.map((link) => link.segment)
    expect(segments).toEqual(["profile", "phones", "keys", "computers"])

    const workspaceGroup = groups.find((g) => g.label === "Workspace")
    expect(workspaceGroup?.links.some((link) => link.segment === "keys")).toBe(false)
  })

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

  it("seals the Boat and E2B keys, and saves only that provider's columns", () => {
    const boat = computerProviderUpdate({
      orgId: "org-1",
      provider: "boat",
      token: "boat_workspace_key",
      kek: KEK,
      now: NOW,
    })
    expect(boat.ok).toBe(true)
    if (!boat.ok) return
    expect(JSON.stringify(boat.row)).not.toContain("boat_workspace_key")
    expect(boat.row.boat_last4).toBe("_key")
    expect(open(boat.row, "boat")).toBe("boat_workspace_key")
    expect(Object.keys(boat.row).some((k) => k.startsWith("vps") || k.startsWith("e2b"))).toBe(
      false,
    )

    const e2b = computerProviderUpdate({
      orgId: "org-1",
      provider: "e2b",
      token: "e2b_abcdef123456",
      kek: KEK,
      now: NOW,
    })
    expect(e2b.ok && open(e2b.row, "e2b")).toBe("e2b_abcdef123456")
    expect(e2b.ok && Object.keys(e2b.row).some((k) => k.startsWith("boat"))).toBe(false)

    expect(
      computerProviderUpdate({ orgId: "org-1", provider: "boat", token: "sk-nope", kek: KEK }).ok,
    ).toBe(false)
    expect(
      computerProviderUpdate({ orgId: "org-1", provider: "e2b", token: "sk-nope", kek: KEK }).ok,
    ).toBe(false)
    const cleared = computerProviderUpdate({
      orgId: "org-1",
      provider: "e2b",
      clear: true,
      kek: KEK,
    })
    expect(cleared.ok && cleared.row.e2b_ciphertext).toBeNull()
  })

  it("saves a VPS by address with a sealed private key", () => {
    const built = computerProviderUpdate({
      orgId: "org-1",
      provider: "vps",
      address: "ssh -p 2222 ubuntu@203.0.113.7",
      privateKey: KEY,
      startAutomatically: true,
      kek: KEK,
      now: NOW,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.row).toMatchObject({
      vps_host: "203.0.113.7",
      vps_user: "ubuntu",
      vps_port: 2222,
      vps_ssh_alias: null,
      vps_start_automatically: true,
    })
    expect(JSON.stringify(built.row)).not.toContain("b3BlbnNzaC1rZXktdjEAAAAA")
    expect(open(built.row, "vps_key")).toBe(KEY)
    expect(Object.keys(built.row).some((k) => k.startsWith("boat"))).toBe(false)
  })

  it("saves a VPS by SSH config name and drops any saved key", () => {
    const built = computerProviderUpdate({
      orgId: "org-1",
      provider: "vps",
      alias: "lab.example",
      kek: KEK,
    })
    expect(built.ok && built.row).toMatchObject({
      vps_ssh_alias: "lab.example",
      vps_host: null,
      vps_key_ciphertext: null,
    })
    expect(
      computerProviderUpdate({
        orgId: "org-1",
        provider: "vps",
        alias: "-oProxyCommand=x",
        kek: KEK,
      }).ok,
    ).toBe(false)
    expect(computerProviderUpdate({ orgId: "org-1", provider: "vps", kek: KEK }).ok).toBe(false)
  })

  it("refuses keys SSH cannot use without a person at the keyboard", () => {
    const encrypted = KEY.replace("b3Bl", "Proc-Type: 4,ENCRYPTED\nb3Bl")
    const built = computerProviderUpdate({
      orgId: "o",
      provider: "vps",
      address: "h",
      privateKey: encrypted,
      kek: KEK,
    })
    expect(built.ok ? "" : built.error).toContain("passphrase")
    expect(
      computerProviderUpdate({
        orgId: "o",
        provider: "vps",
        address: "h",
        privateKey: "ssh-ed25519 AAAA",
        kek: KEK,
      }).ok,
    ).toBe(false)
  })

  it("reads the SSH addresses people paste", () => {
    expect(parseSshAddress("ubuntu@203.0.113.7")).toEqual({
      host: "203.0.113.7",
      user: "ubuntu",
      port: 22,
    })
    expect(parseSshAddress("box.tail1234.ts.net:2200")).toEqual({
      host: "box.tail1234.ts.net",
      user: "root",
      port: 2200,
    })
    expect(parseSshAddress("ssh admin@vps -p 2022")).toEqual({
      host: "vps",
      user: "admin",
      port: 2022,
    })
    expect("error" in parseSshAddress("root@bad host")).toBe(true)
    expect("error" in parseSshAddress("root@h:99999")).toBe(true)
    expect("error" in parseSshAddress("r;id@h")).toBe(true)
  })

  it("knows which cloud desktops are set up", () => {
    const view: ComputerProvidersView = {
      boat: { last4: null, included: true },
      e2b: { last4: null, included: false },
      vps: { address: "ubuntu@h", alias: null, hasKey: true, startAutomatically: false },
    }
    expect(cloudProviderReady(view, "boat")).toBe(true)
    expect(cloudProviderReady(view, "e2b")).toBe(false)
    expect(cloudProviderReady(view, "vps")).toBe(true)
    expect(cloudProviderReady(null, "vps")).toBe(false)
  })

  it("groups Boat, VPS and E2B under one Cloud desktop tile", () => {
    expect(tileOf("boat")).toBe("cloud")
    expect(tileOf("vps")).toBe("cloud")
    expect(tileOf("e2b")).toBe("cloud")
    expect(tileOf("local_vm")).toBe("local_vm")
    expect(tileOf("nonsense")).toBe("auto")
  })

  it("explains each Works on choice", () => {
    const text = WORKS_ON_OPTIONS.map((option) => option[2]).join(" ")
    expect(text).toContain("does not create or wake a Boat")
    expect(text).toContain("Off until you turn it on")
    expect(text).toContain("files stay")
    expect(text).toContain("10 idle minutes")
    expect(text).toContain("/home/user")
    expect(text).toContain("does not turn that server off")
    expect(text).toContain("e2b.dev")
  })
})
