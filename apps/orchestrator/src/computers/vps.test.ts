import { describe, expect, it } from "vitest"
import { boatReadCommand } from "./boat-shell"
import { vpsTargetFromSettings } from "./open-vps"
import { vpsContainerName, vpsDesktopRemote, vpsExecRemote, vpsSshPrefix } from "./vps"

const AGENT = "3f0c2a8e-1111-4222-8333-944455556666"

describe("vpsDesktopRemote", () => {
  it("starts this bot's own container and never turns the server off", () => {
    const remote = vpsDesktopRemote(AGENT, { surface: "vps", action: "provision", reason: "" })
    expect(remote).toContain(`docker start sayabot-bot-${AGENT}`)
    expect(remote).toContain("docker run -d")
    expect(remote).toContain(`sayabot-bot-${AGENT}:/home/bot`)
    expect(remote).toContain("sleep infinity")
    expect(remote).not.toMatch(/\b(shutdown|poweroff|reboot|halt)\b/)
    expect(vpsDesktopRemote(AGENT, { surface: "vps", action: "use", reason: "" })).toContain(
      "docker inspect",
    )
    expect(() => vpsDesktopRemote(AGENT, { surface: "boat", action: "use", reason: "" })).toThrow(
      /Not a VPS/,
    )
  })

  it("keeps bots apart: one container per bot id", () => {
    expect(vpsContainerName("a")).not.toBe(vpsContainerName("b"))
    expect(() => vpsContainerName("x; rm -rf /")).toThrow()
  })
})

describe("vpsExecRemote", () => {
  it("runs a command inside the bot's container, quoted as data", () => {
    const remote = vpsExecRemote(AGENT, "echo it's")
    expect(remote.startsWith(`docker exec -i -w /home/bot sayabot-bot-${AGENT} sh -lc `)).toBe(true)
    expect(remote).toContain(`'echo it'\\''s'`)
    const read = vpsExecRemote(AGENT, boatReadCommand("/home/bot/note.txt", 1, 2) ?? "")
    expect(read).toContain("sed -n 1,2p")
    expect(() => vpsExecRemote(AGENT, "  ")).toThrow()
  })
})

describe("vpsSshPrefix", () => {
  it("uses the SSH config alias as is", () => {
    const argv = vpsSshPrefix({ kind: "alias", alias: "lab.example" })
    expect(argv[0]).toBe("ssh")
    expect(argv).toContain("BatchMode=yes")
    expect(argv.at(-1)).toBe("lab.example")
    expect(() => vpsSshPrefix({ kind: "alias", alias: "bad name" })).toThrow(/SSH config name/)
    expect(() => vpsSshPrefix({ kind: "alias", alias: "-oProxyCommand=x" })).toThrow()
  })

  it("reaches a host with its user, port and key file, pinning the host key on first use", () => {
    const argv = vpsSshPrefix(
      { kind: "host", host: "203.0.113.7", user: "ubuntu", port: 2222, privateKey: "k" },
      "/tmp/k/id",
    )
    expect(argv.at(-1)).toBe("ubuntu@203.0.113.7")
    expect(argv.join(" ")).toContain("-p 2222")
    expect(argv.join(" ")).toContain("-i /tmp/k/id")
    expect(argv).toContain("StrictHostKeyChecking=accept-new")
    expect(() =>
      vpsSshPrefix({ kind: "host", host: "-x", user: "u", port: 22, privateKey: null }),
    ).toThrow()
    expect(() =>
      vpsSshPrefix({ kind: "host", host: "h", user: "u;id", port: 22, privateKey: null }),
    ).toThrow()
    expect(() =>
      vpsSshPrefix({ kind: "host", host: "h", user: "u", port: 70_000, privateKey: null }),
    ).toThrow()
  })
})

describe("vpsTargetFromSettings", () => {
  it("prefers a saved host over the alias and defaults user and port", () => {
    const base = {
      alias: "vps",
      host: null,
      user: null,
      port: null,
      keyCiphertext: null,
      keyIv: null,
      keyTag: null,
    }
    expect(vpsTargetFromSettings(base, "k")).toEqual({ kind: "alias", alias: "vps" })
    expect(vpsTargetFromSettings({ ...base, host: "box.example" }, "k")).toEqual({
      kind: "host",
      host: "box.example",
      user: "root",
      port: 22,
      privateKey: null,
    })
    expect(vpsTargetFromSettings({ ...base, alias: null }, "k")).toBeNull()
  })
})
