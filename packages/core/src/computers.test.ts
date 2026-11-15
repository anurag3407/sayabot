import { describe, expect, it } from "vitest"
import {
  BOAT_BACKGROUND_MAX_MS,
  BOAT_IDLE_MS,
  BOAT_ROUTINE_LOOKAHEAD_MS,
  boatCredential,
  boatShouldSleep,
  desktopGuidance,
  desktopHome,
  macScreenAllowed,
  rememberSelectedDesktop,
  resolveComputer,
  type ComputerAvailability,
} from "./computers"

const idle: ComputerAvailability = {
  thisComputer: false,
  localVmReady: false,
  boatConfigured: true,
  boatState: "sleeping",
  vpsReady: false,
  startVpsAutomatically: false,
}

describe("resolveComputer", () => {
  it("lets Auto reuse a running desktop and refuses to wake a Boat", () => {
    expect(resolveComputer("auto", { ...idle, boatState: "running" }).surface).toBe("boat")
    const asleep = resolveComputer("auto", idle)
    expect(asleep.action).toBe("none")
    expect(asleep.reason).toContain("select_computer")
  })

  it("keeps a Boat woken in this turn ready for the next command", () => {
    const available = { ...idle }
    const params: Record<string, unknown> = { worksOn: "auto", computer: { boatState: "sleeping" } }
    const decision = resolveComputer("auto", available, "boat")
    rememberSelectedDesktop(available, params, decision, { ok: true, boatId: "box-1" })
    expect(available.boatState).toBe("running")
    expect(resolveComputer("auto", available).action).toBe("use")
    expect((params.computer as { boatId: string }).boatId).toBe("box-1")
  })

  it("wakes or creates a Boat only when the bot asks", () => {
    expect(resolveComputer("auto", idle, "boat")).toEqual({ surface: "boat", action: "wake", reason: "" })
    expect(resolveComputer("boat", { ...idle, boatState: "absent" })).toEqual({
      surface: "boat",
      action: "provision",
      reason: "",
    })
  })

  it("keeps this computer off until that bot turns it on", () => {
    expect(resolveComputer("this_computer", idle).action).toBe("none")
    expect(resolveComputer("this_computer", { ...idle, thisComputer: true }).surface).toBe("this_computer")
  })

  it("creates a local VM when asked, and reuses one that Auto already finds ready", () => {
    expect(resolveComputer("local_vm", idle).action).toBe("provision")
    expect(resolveComputer("auto", { ...idle, localVmReady: true }).surface).toBe("local_vm")
    expect(resolveComputer("auto", idle, "local_vm").action).toBe("provision")
  })

  it("reuses a ready VPS and never starts the server on its own", () => {
    expect(resolveComputer("auto", { ...idle, vpsReady: true }).surface).toBe("vps")
    expect(resolveComputer("vps", idle).action).toBe("none")
    expect(resolveComputer("vps", { ...idle, startVpsAutomatically: true }).action).toBe("provision")
  })

  it("does not let select_computer leave a bot that is pinned to one desktop", () => {
    const decision = resolveComputer("boat", idle, "vps")
    expect(decision.action).toBe("none")
    expect(decision.reason).toContain("boat")
  })
})

describe("boatCredential", () => {
  it("prefers the person's own key over a Cloud relay token", () => {
    expect(boatCredential(" boat_own ", "relay")).toEqual({ token: "boat_own", source: "own" })
    expect(boatCredential("  ", "relay")).toEqual({ token: "relay", source: "included" })
    expect(boatCredential(null, null)).toBeNull()
  })
})

describe("desktopGuidance", () => {
  it("tells the agent that Auto does not create or wake a Boat", () => {
    const text = desktopGuidance("auto")
    expect(text).toContain("select_computer")
    expect(text).toContain("does not create or wake a Boat")
    expect(text).toContain("/home/user")
    expect(desktopHome("boat")).toBe("/home/user")
    expect(desktopHome("local_vm")).toBe("/home/bot")
    expect(desktopHome("vps")).toBe("/home/bot")
    expect(text).toContain("computer_screenshot")
    expect(text).toContain("computer_click")
    expect(text).toContain("do not turn that server off")
  })
})

describe("macScreenAllowed", () => {
  it("stays off until this bot is allowed to use the Mac", () => {
    expect(macScreenAllowed({ worksOn: "this_computer" })).toBe(false)
    expect(macScreenAllowed({ worksOn: "this_computer", computer: { thisComputer: true } })).toBe(true)
    expect(macScreenAllowed({ worksOn: "auto", computer: { thisComputer: true } })).toBe(true)
    expect(macScreenAllowed({ worksOn: "boat", computer: { thisComputer: true } })).toBe(false)
    expect(macScreenAllowed({ worksOn: "vps", computer: { thisComputer: true } })).toBe(false)
  })
})

describe("boatShouldSleep", () => {
  const now = 1_000_000_000_000

  it("sleeps after 10 idle minutes", () => {
    expect(boatShouldSleep({ now, lastUsedAt: now - BOAT_IDLE_MS, nextRoutineAt: null, backgroundStartedAt: null, watching: false })).toBe(true)
    expect(boatShouldSleep({ now, lastUsedAt: now - BOAT_IDLE_MS + 1, nextRoutineAt: null, backgroundStartedAt: null, watching: false })).toBe(false)
  })

  it("stays awake for a routine due within 30 minutes, a watcher, or a background command under 2 hours", () => {
    expect(boatShouldSleep({ now, lastUsedAt: now - BOAT_IDLE_MS, nextRoutineAt: now + BOAT_ROUTINE_LOOKAHEAD_MS, backgroundStartedAt: null, watching: false })).toBe(false)
    expect(boatShouldSleep({ now, lastUsedAt: now - BOAT_IDLE_MS, nextRoutineAt: now + BOAT_ROUTINE_LOOKAHEAD_MS + 1, backgroundStartedAt: null, watching: false })).toBe(true)
    expect(boatShouldSleep({ now, lastUsedAt: now - BOAT_IDLE_MS, nextRoutineAt: now - 60_000, backgroundStartedAt: null, watching: false })).toBe(false)
    expect(boatShouldSleep({ now, lastUsedAt: now - BOAT_IDLE_MS, nextRoutineAt: now - BOAT_ROUTINE_LOOKAHEAD_MS - 1, backgroundStartedAt: null, watching: false })).toBe(true)
    expect(boatShouldSleep({ now, lastUsedAt: null, nextRoutineAt: null, backgroundStartedAt: null, watching: true })).toBe(false)
    expect(boatShouldSleep({ now, lastUsedAt: null, nextRoutineAt: null, backgroundStartedAt: now - BOAT_BACKGROUND_MAX_MS + 1, watching: false })).toBe(false)
    expect(boatShouldSleep({ now, lastUsedAt: null, nextRoutineAt: null, backgroundStartedAt: now - BOAT_BACKGROUND_MAX_MS, watching: false })).toBe(true)
  })
})
