import { describe, expect, it, vi } from "vitest"
import { DiscordConnector, normalizePhone, TelegramConnector, WhatsAppConnector } from "./messaging"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("normalizePhone", () => {
  it("strips formatting and the plus", () => {
    expect(normalizePhone("+1 (415) 555-0123")).toBe("14155550123")
  })
  it("rejects numbers without a country code", () => {
    expect(() => normalizePhone("555")).toThrow(/country code/)
  })
})

describe("DiscordConnector", () => {
  it("sends with the Bot scheme, blocks mass mentions and never retries", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: "9", channel_id: "123456", guild_id: "777777" }))
    const client = new DiscordConnector({ botToken: "tok", fetchFn })
    const sent = await client.sendMessage("123456", "hello @everyone")
    expect(sent.url).toBe("https://discord.com/channels/777777/123456/9")
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe("https://discord.com/api/v10/channels/123456/messages")
    expect(init.headers.Authorization).toBe("Bot tok")
    expect(JSON.parse(init.body).allowed_mentions).toEqual({ parse: ["users"] })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it("rejects non-numeric channel IDs before calling Discord", async () => {
    const fetchFn = vi.fn()
    await expect(new DiscordConnector({ botToken: "t", fetchFn }).readMessages("../guilds")).rejects.toThrow(/number/)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("does not retry a failed send", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ message: "boom" }, 500))
    await expect(new DiscordConnector({ botToken: "t", fetchFn }).sendMessage("123456", "x")).rejects.toThrow(/boom/)
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})

describe("TelegramConnector", () => {
  const token = "123456:ABCdefGHIjklMNOpqrSTUvwxYZ012345"

  it("rejects a malformed token", () => {
    expect(() => new TelegramConnector({ botToken: "nope" })).toThrow(/BotFather/)
  })

  it("maps updates to messages with chat IDs", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        ok: true,
        result: [
          { update_id: 1, message: { message_id: 5, date: 1_700_000_000, text: "hi", chat: { id: 42, first_name: "Ana" }, from: { username: "ana" } } },
          { update_id: 2 },
        ],
      }),
    )
    const messages = await new TelegramConnector({ botToken: token, fetchFn }).recentMessages()
    expect(messages).toEqual([
      { id: "5", author: "@ana", text: "hi", sentAt: new Date(1_700_000_000_000).toISOString(), chatId: "42", chatName: "Ana" },
    ])
  })

  it("surfaces Telegram's error description", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: false, description: "chat not found" }, 400))
    await expect(new TelegramConnector({ botToken: token, fetchFn }).sendMessage("42", "x")).rejects.toThrow(/chat not found/)
  })
})

describe("WhatsAppConnector", () => {
  it("requires the phone number ID", () => {
    expect(() => new WhatsAppConnector({ accessToken: "t", phoneNumberId: "" })).toThrow(/phone number ID/)
  })

  it("sends a text to the normalized number", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ messages: [{ id: "wamid.X" }] }))
    const client = new WhatsAppConnector({ accessToken: "t", phoneNumberId: "1234567890", fetchFn })
    await expect(client.sendText("+1 415 555 0123", "hello")).resolves.toEqual({ id: "wamid.X" })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890/messages")
    expect(JSON.parse(init.body)).toMatchObject({ to: "14155550123", type: "text", text: { body: "hello" } })
  })
})
