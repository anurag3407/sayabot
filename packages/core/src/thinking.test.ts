import { describe, expect, it } from "vitest"
import { appendThinking, closeThinking, formatReply, splitThinking } from "./thinking"

describe("splitThinking", () => {
  it("leaves an ordinary reply alone", () => {
    expect(splitThinking("Hello there.")).toEqual({
      thinking: "",
      answer: "Hello there.",
      open: false,
    })
  })

  it("pulls a closed think block out of the answer", () => {
    expect(splitThinking("<think>\nLook it up.\n</think>\n\nFound Anurag.")).toEqual({
      thinking: "Look it up.",
      answer: "Found Anurag.",
      open: false,
    })
  })

  it("joins several blocks and accepts the tags models actually emit", () => {
    const split = splitThinking(
      "<thinking>first</thinking>\n\nAnswer one.\n\n<reasoning>second</reasoning>\n\nAnswer two.",
    )
    expect(split.thinking).toBe("first\n\nsecond")
    expect(split.answer).toBe("Answer one.\n\nAnswer two.")
    expect(split.open).toBe(false)
  })

  it("keeps an unfinished block out of the answer while it streams", () => {
    expect(splitThinking("<think>\nStill going")).toEqual({
      thinking: "Still going",
      answer: "",
      open: true,
    })
  })

  it("hides a half-written tag so it doesn't flash in the reply", () => {
    expect(splitThinking("The answer is ready <thi")).toEqual({
      thinking: "",
      answer: "The answer is ready",
      open: true,
    })
    expect(splitThinking("<think>\nAlmost </thi").thinking).toBe("Almost")
  })

  it("strips leaked internal DSML tool tags from the answer", () => {
    const raw = "I'll check what's actually at that endpoint first.\n\n<｜DSML｜ calls>\n<｜DSML｜ invoke name=\"terminal_exec\">\n<｜DSML｜ parameter name=\"command\">curl localhost:6379</｜DSML｜ invoke>\n</｜DSML｜ calls>"
    expect(splitThinking(raw)).toEqual({
      thinking: "",
      answer: "I'll check what's actually at that endpoint first.",
      open: false,
    })
  })

  it("strips leaked internal DSML tool tags without swallowing text after the closing tag", () => {
    const raw = "Before call.\n\n<｜DSML｜ calls>\n<｜DSML｜ invoke name=\"terminal_exec\">\n<｜DSML｜ parameter name=\"command\">curl localhost:6379</｜DSML｜ invoke>\n</｜DSML｜ calls>\n\nAfter call."
    expect(splitThinking(raw)).toEqual({
      thinking: "",
      answer: "Before call.\n\nAfter call.",
      open: false,
    })
  })
})

describe("appendThinking", () => {
  it("opens, continues, and closes without rewriting earlier text", () => {
    let fold = { open: false }
    let text = ""
    const push = (kind: "thinking" | "answer", chunk: string) => {
      const next = appendThinking(fold, kind, chunk)
      fold = next.fold
      text += next.delta
    }
    push("thinking", "hmm")
    push("thinking", " more")
    push("answer", "Done.")
    expect(text).toBe("<think>\nhmm more\n</think>\n\nDone.")
    expect(splitThinking(text)).toEqual({ thinking: "hmm more", answer: "Done.", open: false })
  })

  it("closes a block that never reached an answer", () => {
    const next = closeThinking({ open: true })
    expect(next.delta).toBe("\n</think>\n\n")
    expect(closeThinking(next.fold).delta).toBe("")
  })
})

describe("formatReply", () => {
  it("omits an empty side", () => {
    expect(formatReply("", "Hi")).toBe("Hi")
    expect(formatReply("hmm", "")).toBe("<think>\nhmm\n</think>")
    expect(formatReply("hmm", "Hi")).toBe("<think>\nhmm\n</think>\n\nHi")
  })
})
