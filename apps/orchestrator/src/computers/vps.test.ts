import { describe, expect, it } from "vitest"
import { boatReadCommand } from "./boat-shell"
import { vpsDesktopArgv, vpsExecArgv } from "./vps"

describe("vpsDesktopArgv", () => {
  it("starts the desktop container over SSH and never turns the server off", () => {
    const argv = vpsDesktopArgv("vps", { surface: "vps", action: "provision", reason: "" })
    expect(argv[0]).toBe("ssh")
    expect(argv).toContain("vps")
    expect(argv.join(" ")).toContain("docker run")
    expect(argv.join(" ")).toContain("sayabot-desktop:/home/bot")
    expect(argv.join(" ")).not.toMatch(/shutdown|poweroff|reboot|halt/)
    expect(vpsDesktopArgv("vps", { surface: "vps", action: "use", reason: "" }).join(" ")).toContain("docker inspect")
  })

  it("runs a command inside the desktop container and leaves the server up", () => {
    const argv = vpsExecArgv("lab.example", "echo it's")
    expect(argv.slice(0, 4)).toEqual(["ssh", "-o", "BatchMode=yes", "lab.example"])
    const remote = argv[4] ?? ""
    expect(remote.startsWith("docker exec -i sayabot-desktop sh -lc ")).toBe(true)
    expect(remote).toContain(`'echo it'\\''s'`)
    expect(remote).not.toMatch(/\b(shutdown|poweroff|reboot|halt)\b/)
    expect(() => vpsExecArgv("bad name", "echo hi")).toThrow(/SSH config name/)
    const read = boatReadCommand("/home/bot/note.txt", 1, 2)
    const file = vpsExecArgv("vps", read ?? "")
    expect(file[4]).toContain("docker exec -i sayabot-desktop")
    expect(file[4]).toContain("sed -n 1,2p")
    expect(file[4]).toContain("/home/bot/note.txt")
    expect(file.join(" ")).not.toMatch(/\b(shutdown|poweroff|reboot|halt)\b/)
  })
})