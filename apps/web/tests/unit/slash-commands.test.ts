import { describe, expect, it } from "vitest"
import { parseSlashCommand, slashSuggestions } from "@/lib/slash-commands"

describe("parseSlashCommand", () => {
  it("reads a command and the text after it", () => {
    const parsed = parseSlashCommand("/goal ship the settings page\nwith tests")
    expect(parsed?.command.name).toBe("goal")
    expect(parsed?.rest).toBe("ship the settings page\nwith tests")
  })

  it("accepts commands without text and aliases", () => {
    expect(parseSlashCommand("/stop")?.command.name).toBe("stop")
    expect(parseSlashCommand("/cron daily at 9am")?.command.name).toBe("schedule")
  })

  it("ignores ordinary messages and unknown commands", () => {
    expect(parseSlashCommand("use /tmp for this")).toBeNull()
    expect(parseSlashCommand("/nope hi")).toBeNull()
  })
})

describe("slashSuggestions", () => {
  it("lists everything for a bare slash and filters as you type", () => {
    expect(slashSuggestions("/").length).toBeGreaterThan(5)
    expect(slashSuggestions("/go").map((c) => c.name)).toEqual(["goal"])
    expect(slashSuggestions("/cr").map((c) => c.name)).toEqual(["schedule"])
  })

  it("stops suggesting once the command is typed", () => {
    expect(slashSuggestions("/goal ")).toEqual([])
    expect(slashSuggestions("hello /go")).toEqual([])
  })
})
