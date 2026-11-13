import { describe, expect, it } from "vitest"
import { eventsFromPayload, inboundRoomText, readInbound } from "./inbound"

describe("inbound chat", () => {
  it("mentions the agent so a mentions room wakes them", () => {
    expect(inboundRoomText("ada", "Sam", "hello")).toBe("@ada Sam says:\nhello")
  })

  it("reads a telegram message and skips bots", () => {
    const raw = JSON.stringify({ message: { message_id: 4, text: "hi", chat: { id: -100 }, from: { username: "sam" } } })
    expect(eventsFromPayload("telegram", raw)).toEqual([{ externalId: "4", chatId: "-100", sender: "@sam", text: "hi" }])
    const bot = JSON.stringify({ message: { message_id: 5, text: "hi", chat: { id: 1 }, from: { is_bot: true } } })
    expect(eventsFromPayload("telegram", bot)).toEqual([])
  })

  it("reads a whatsapp text and ignores other kinds", () => {
    const raw = JSON.stringify({
      entry: [{ changes: [{ value: { messages: [{ id: "wamid", from: "14155550123", type: "text", text: { body: "ping" } }, { id: "x", from: "1", type: "image" }] } }] }],
    })
    expect(eventsFromPayload("whatsapp", raw)).toEqual([{ externalId: "wamid", chatId: "14155550123", sender: "+14155550123", text: "ping" }])
  })

  it("only delivers replies that started from a chat", () => {
    expect(readInbound({ inbound: { platform: "discord", connectorId: "c", chatId: "1", externalId: "m" } })?.platform).toBe("discord")
    expect(readInbound({ note: "nope" })).toBeNull()
  })
})
