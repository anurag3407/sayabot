import { describe, expect, it } from "vitest"
import {
  DEFAULT_CAPABILITIES,
  agentCapabilitiesSchema,
  parseCapabilities,
} from "./capabilities"

describe("capabilities", () => {
  it("defaults to full capabilities with computer & secrets disabled", () => {
    expect(DEFAULT_CAPABILITIES).toEqual({
      canvas: true,
      tasks: true,
      sandbox: true,
      webSearch: true,
      document: true,
      github: true,
      postgres: true,
      mcp: true,
      computer: false,
      secrets: false,
      memory: true,
      subagents: true,
      cron: true,
      connectors: true,
    })
  })

  it("parses empty or invalid inputs into defaults", () => {
    expect(parseCapabilities(null)).toEqual(DEFAULT_CAPABILITIES)
    expect(parseCapabilities(undefined)).toEqual(DEFAULT_CAPABILITIES)
    expect(parseCapabilities("string")).toEqual(DEFAULT_CAPABILITIES)
    expect(parseCapabilities({})).toEqual(DEFAULT_CAPABILITIES)
  })

  it("preserves valid overrides and ignores unknown keys", () => {
    const parsed = parseCapabilities({
      webSearch: false,
      secrets: true,
      computer: { profile: "browser" },
      unknownKey: "surprise",
    })

    expect(parsed).toEqual({
      canvas: true,
      tasks: true,
      sandbox: true,
      webSearch: false,
      document: true,
      github: true,
      postgres: true,
      mcp: true,
      computer: { profile: "browser" },
      secrets: true,
      memory: true,
      subagents: true,
      cron: true,
      connectors: true,
    })
    expect((parsed as unknown as Record<string, unknown>).unknownKey).toBeUndefined()
  })

  it("validates using zod schema", () => {
    const res = agentCapabilitiesSchema.safeParse({
      canvas: false,
      computer: { profile: "standard" },
    })
    expect(res.success).toBe(true)
    if (res.success) {
      expect(res.data.canvas).toBe(false)
      expect(res.data.computer).toEqual({ profile: "standard" })
      expect(res.data.github).toBe(true)
    }
  })
})
