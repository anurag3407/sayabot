import { describe, expect, it } from "vitest"
import {
  GATEWAY_SILENCE_TOKENS,
  gatewayChatRoomName,
  isGatewaySource,
  isSilentGatewayReply,
  looksLikeTelegramToken,
} from "./gateways"

describe("gateways", () => {
  it("accepts only the supported sources", () => {
    expect(isGatewaySource("telegram")).toBe(true)
    expect(isGatewaySource("discord")).toBe(true)
    expect(isGatewaySource("slack")).toBe(false)
    expect(isGatewaySource(undefined)).toBe(false)
  })

  it("recognises every silence token, and treats an empty reply as silence", () => {
    for (const token of GATEWAY_SILENCE_TOKENS) {
      expect(isSilentGatewayReply(token)).toBe(true)
    }
    expect(isSilentGatewayReply("  [SILENT]\n")).toBe(true)
    expect(isSilentGatewayReply("")).toBe(true)
    expect(isSilentGatewayReply("Nothing to report, all green.")).toBe(false)
    expect(isSilentGatewayReply("SILENT but here is the summary")).toBe(false)
  })

  it("names a mirrored room from the platform and chat title", () => {
    expect(gatewayChatRoomName("telegram", "saya", "Ada")).toBe("Telegram · Ada")
    expect(gatewayChatRoomName("discord", "saya", "  #dev   channel ")).toBe(
      "Discord · #dev channel",
    )
    expect(gatewayChatRoomName("telegram", "saya", "")).toBe("Telegram · chat")
  })

  it("validates the Telegram token shape", () => {
    expect(looksLikeTelegramToken("123456789:AAHkfjdslkfjsdlkfjsdlkfjsdlkfjsdlk")).toBe(true)
    expect(looksLikeTelegramToken("not-a-token")).toBe(false)
  })
})
