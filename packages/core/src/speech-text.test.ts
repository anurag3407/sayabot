import { describe, expect, it } from "vitest"
import { speakable, toUtterances, VOICE_FIRST_BLOCK_MAX_CHARS } from "./speech-text"

describe("speakable", () => {
  it("converts fenced code blocks into descriptive phrases", () => {
    const input = "Here is the code:\n```ts\nconst x: number = 42;\nconsole.log(x);\n```\nIt works!"
    const output = speakable(input)
    expect(output).toContain("(a TypeScript code block)")
    expect(output).not.toContain("const x: number")
  })

  it("strips bold and italics markers", () => {
    const input = "This is **very important** and *mildly interesting*."
    const output = speakable(input)
    expect(output).toBe("This is very important and mildly interesting.")
  })

  it("shortens deep file paths to base name", () => {
    const input = "Please inspect packages/core/src/speech-text.ts for details."
    const output = speakable(input)
    expect(output).toBe("Please inspect speech-text.ts for details.")
  })

  it("replaces links and URLs", () => {
    const input = "Visit [Sayabot Docs](https://sayabot.in/docs) or https://github.com/sayabot directly."
    const output = speakable(input)
    expect(output).toBe("Visit Sayabot Docs or a link directly.")
  })

  it("converts markdown tables into comma-separated text", () => {
    const input = "| Name | Status |\n|---|---|\n| Alice | Active |\n| Bob | Paused |"
    const output = speakable(input)
    expect(output).toContain("Name, Status")
    expect(output).toContain("Alice, Active")
    expect(output).toContain("Bob, Paused")
  })

  it("strips emojis to prevent synthesizer awkwardness", () => {
    const input = "Great job! 🎉🚀 Everything is ready! ✨"
    const output = speakable(input)
    expect(output).toBe("Great job! Everything is ready!")
  })
})

describe("toUtterances", () => {
  it("splits text into sentence utterances", () => {
    const input =
      "First sentence here is going to introduce the topic clearly and pleasantly. Second sentence follows up with more details that exceed ninety characters easily. Third sentence concludes the point."
    const utterances = toUtterances(input)
    expect(utterances.length).toBeGreaterThanOrEqual(2)
    expect(utterances[0]).toContain("First sentence here")
  })

  it("caps the first utterance to VOICE_FIRST_BLOCK_MAX_CHARS for rapid TTFB", () => {
    const input =
      "This is a relatively short intro. Here is a longer paragraph that continues explaining the details of how the voice engine works and streams audio chunk by chunk."
    const utterances = toUtterances(input)
    expect(utterances.length).toBeGreaterThan(1)
    expect(utterances[0]!.length).toBeLessThanOrEqual(VOICE_FIRST_BLOCK_MAX_CHARS + 10)
  })

  it("handles empty or whitespace text gracefully", () => {
    expect(toUtterances("")).toEqual([])
    expect(toUtterances("   ")).toEqual([])
  })
})
