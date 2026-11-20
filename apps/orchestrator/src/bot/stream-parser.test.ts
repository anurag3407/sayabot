import { describe, expect, it } from "vitest"
import { isPrivateIp } from "../ssrf"
import { BotStreamParser } from "./stream-parser"

describe("BotStreamParser", () => {
  it("parses NDJSON split across chunks", () => {
    const parser = new BotStreamParser("application/x-ndjson")
    expect(parser.push('{"delta":"hel')).toEqual({ deltas: [], done: false })
    expect(parser.push('lo"}\n{"delta":" world"}\n')).toEqual({
      deltas: ["hello", " world"],
      done: false,
    })
    expect(parser.push('{"done":true}\n')).toEqual({ deltas: [], done: true })
  })

  it("parses SSE data lines and [DONE]", () => {
    const parser = new BotStreamParser("text/event-stream; charset=utf-8")
    expect(parser.push('event: message\ndata: {"delta":"hi"}\n\n')).toEqual({
      deltas: ["hi"],
      done: false,
    })
    expect(parser.push("data: [DONE]\n\n")).toEqual({ deltas: [], done: true })
  })

  it("flushes a trailing line without a newline on finish", () => {
    const parser = new BotStreamParser("application/x-ndjson")
    parser.push('{"delta":"last"}')
    expect(parser.finish()).toEqual({ deltas: ["last"], done: false })
  })

  it("rejects malformed JSON and unknown payloads", () => {
    const parser = new BotStreamParser("application/x-ndjson")
    expect(() => parser.push("not json\n")).toThrow(/invalid bot stream line/)
    const other = new BotStreamParser("application/x-ndjson")
    expect(() => other.push('{"content":"nope"}\n')).toThrow(/unexpected bot stream payload/)
  })
})

describe("isPrivateIp", () => {
  it("blocks loopback, private and link-local ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fe80::1",
      "fd00::1",
      "::ffff:192.168.0.1",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})
