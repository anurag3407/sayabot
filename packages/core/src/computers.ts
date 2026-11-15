/**
 * Where a bot's hands are. The agent process stays on the Mac or on the Cloud home.
 * These surfaces are desktops it can see and click, not a different model.
 *
 * Auto reuses a desktop that is already running. It does not create or wake a Boat.
 * The bot calls select_computer for that.
 */

export const WORKS_ON = ["off", "auto", "this_computer", "local_vm", "boat", "vps"] as const
export type WorksOn = (typeof WORKS_ON)[number]

export type BoatState = "running" | "sleeping" | "absent"

export interface ComputerAvailability {
  /** This bot is allowed to use the Mac's screen and apps. Off until turned on for that bot. */
  thisComputer: boolean
  /** A local container desktop already exists, with its workspace intact. */
  localVmReady: boolean
  /** boat.dev key or a Cloud-included relay token is configured. */
  boatConfigured: boolean
  boatState: BoatState
  /** Docker-over-SSH desktop is already up. A VPS server is never stopped by Sayabot. */
  vpsReady: boolean
  /** When false, Auto will not create the VPS container. Reusing a ready one is still allowed. */
  startVpsAutomatically: boolean
}

export type ComputerAction = "use" | "wake" | "provision" | "none"

export interface ComputerDecision {
  /** The desktop to use. `off` means this turn has no computer. */
  surface: WorksOn
  action: ComputerAction
  /** Why Auto refused to create or wake something. Empty when the choice is carried out. */
  reason: string
}

const NONE: ComputerDecision = { surface: "off", action: "none", reason: "" }

/**
 * The Mac's screen and apps stay off until this bot is allowed to use them.
 * Boat, a local VM, and a VPS are other desktops, so they never take the Mac screen.
 */
export function macScreenAllowed(params: Record<string, unknown> | null | undefined): boolean {
  const worksOn = worksOnFromParams(params)
  if (worksOn === "boat" || worksOn === "local_vm" || worksOn === "vps" || worksOn === "off") return false
  return availabilityFromParams(params).thisComputer
}

/** What the agent is told about its desktop. The process stays on the Mac or on Cloud. */
export function desktopGuidance(worksOn: WorksOn): string {
  return [
    `Works on: ${worksOn}.`,
    "You keep running on this Mac or on Cloud. The desktop is only what you can see and click.",
    "Auto reuses a desktop that is already ready. It does not create or wake a Boat. Call select_computer with this_computer, local_vm, boat, or vps for that.",
    "This computer uses the Mac's screen and apps, and it is off until a person turns it on for you.",
    "A local VM keeps its files when the container is recreated.",
    "A Boat sleeps after 10 idle minutes and wakes with its files. Those files live in /home/user and /tmp, not /home/bot. computer_screenshot sees that desktop and computer_click presses it. computer_shell with background true keeps it awake for up to two hours.",
    "Your own VPS is Docker over SSH. You do not turn that server off.",
  ].join(" ")
}

/** Where this desktop keeps files. A Boat's home is /home/user. The local VM and a VPS use /home/bot. */
export function desktopHome(worksOn: WorksOn): "/home/user" | "/home/bot" {
  return worksOn === "boat" ? "/home/user" : "/home/bot"
}
export function worksOnFromParams(params: Record<string, unknown> | null | undefined): WorksOn {
  return isWorksOn(params?.worksOn) ? params.worksOn : "auto"
}

/** Desktops this bot may use, stored on the bot until a live Boat or VPS lookup replaces it. */
export function availabilityFromParams(params: Record<string, unknown> | null | undefined): ComputerAvailability {
  const raw = params?.computer
  const computer = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const boatState = computer.boatState
  return {
    thisComputer: computer.thisComputer === true,
    localVmReady: computer.localVmReady === true,
    boatConfigured: computer.boatConfigured === true,
    boatState: boatState === "running" || boatState === "sleeping" || boatState === "absent" ? boatState : "absent",
    vpsReady: computer.vpsReady === true,
    startVpsAutomatically: computer.startVpsAutomatically === true,
  }
}

export function isWorksOn(value: unknown): value is WorksOn {
  return typeof value === "string" && (WORKS_ON as readonly string[]).includes(value)
}

/** The person's own Boat key wins. A Cloud plan's relay token is used only when they have none. */
export function boatCredential(
  ownToken: string | null | undefined,
  includedToken: string | null | undefined,
): { token: string; source: "own" | "included" } | null {
  const own = ownToken?.trim()
  if (own) return { token: own, source: "own" }
  const included = includedToken?.trim()
  if (included) return { token: included, source: "included" }
  return null
}

function use(surface: WorksOn): ComputerDecision {
  return { surface, action: "use", reason: "" }
}

/**
 * Resolves one turn's desktop.
 * `selected` is a select_computer call. Without it, Auto only attaches to a desktop that is already running.
 */
export function resolveComputer(
  worksOn: WorksOn,
  available: ComputerAvailability,
  selected?: WorksOn | null,
): ComputerDecision {
  if (worksOn === "off") {
    return { ...NONE, reason: "This bot's computer is off." }
  }
  const asked = selected && selected !== "auto" && selected !== "off" ? selected : null
  if (worksOn !== "auto" && asked && asked !== worksOn) {
    return {
      surface: "off",
      action: "none",
      reason: `This bot works on ${worksOn}. select_computer cannot move it to ${asked}.`,
    }
  }
  const surface = asked ?? (worksOn === "auto" ? null : worksOn)
  if (!surface) return pickReady(available)
  // Auto's own choice never creates or wakes. An explicit select_computer does.
  return place(surface, available, !asked && worksOn === "auto")
}

function pickReady(available: ComputerAvailability): ComputerDecision {
  if (available.thisComputer) return use("this_computer")
  if (available.localVmReady) return use("local_vm")
  if (available.boatState === "running") return use("boat")
  if (available.vpsReady) return use("vps")
  return {
    surface: "off",
    action: "none",
    reason: "No desktop is ready. Call select_computer to choose one. Auto does not create or wake a Boat.",
  }
}

function place(surface: Exclude<WorksOn, "off" | "auto">, available: ComputerAvailability, fromAuto: boolean): ComputerDecision {
  switch (surface) {
    case "this_computer":
      return available.thisComputer
        ? use("this_computer")
        : { surface: "off", action: "none", reason: "This computer is off for this bot until it is turned on." }
    case "local_vm":
      return available.localVmReady
        ? use("local_vm")
        : fromAuto
          ? { surface: "off", action: "none", reason: "No local VM is ready. Call select_computer to create one." }
          : { surface: "local_vm", action: "provision", reason: "" }
    case "boat":
      if (!available.boatConfigured && available.boatState === "absent") {
        return { surface: "off", action: "none", reason: "No Boat key is set in Settings → Computers." }
      }
      if (available.boatState === "running") return use("boat")
      if (fromAuto) {
        return {
          surface: "off",
          action: "none",
          reason: "Auto does not create or wake a Boat. Call select_computer with boat.",
        }
      }
      return available.boatState === "sleeping"
        ? { surface: "boat", action: "wake", reason: "" }
        : { surface: "boat", action: "provision", reason: "" }
    case "vps":
      if (available.vpsReady) return use("vps")
      if (fromAuto || !available.startVpsAutomatically) {
        return {
          surface: "off",
          action: "none",
          reason: "The VPS desktop is not ready. Sayabot does not start your server.",
        }
      }
      return { surface: "vps", action: "provision", reason: "" }
  }
}

/**
 * A successful select_computer is visible to the next tool in the same turn.
 * Waking a Boat does not wait for the next message before a command can run on it.
 */
export function rememberSelectedDesktop(
  available: ComputerAvailability,
  params: Record<string, unknown>,
  decision: ComputerDecision,
  applied: Record<string, unknown>,
): void {
  if (applied.ok === false || decision.action === "none") return
  const current =
    params.computer && typeof params.computer === "object" ? { ...(params.computer as Record<string, unknown>) } : {}
  if (decision.surface === "boat" && typeof applied.boatId === "string") {
    available.boatState = "running"
    available.boatConfigured = true
    current.boatId = applied.boatId
    current.boatState = "running"
    current.boatConfigured = true
  } else if (decision.surface === "local_vm") {
    available.localVmReady = true
    current.localVmReady = true
    if (typeof applied.volume === "string") current.volume = applied.volume
  } else if (decision.surface === "vps") {
    available.vpsReady = true
    current.vpsReady = true
  } else {
    return
  }
  params.computer = current
}

/** A Boat sleeps after nothing has used it for this long. */
export const BOAT_IDLE_MS = 10 * 60 * 1000
/** Stay awake when a routine that uses it runs inside this window. */
export const BOAT_ROUTINE_LOOKAHEAD_MS = 30 * 60 * 1000
/** A background command keeps the Boat awake for at most this long after it started. */
export const BOAT_BACKGROUND_MAX_MS = 2 * 60 * 60 * 1000

export function boatShouldSleep(input: {
  now: number
  lastUsedAt: number | null
  /** Next routine that uses this Boat, or null. */
  nextRoutineAt: number | null
  /** When the current background command started, or null. */
  backgroundStartedAt: number | null
  /** Someone is watching the screen or holding the desktop. */
  watching: boolean
}): boolean {
  if (input.watching) return false
  if (input.backgroundStartedAt !== null && input.now - input.backgroundStartedAt < BOAT_BACKGROUND_MAX_MS) {
    return false
  }
  if (input.nextRoutineAt !== null) {
    const delta = input.nextRoutineAt - input.now
    // Due now, or within 30 minutes either side, so a run that just started still has the desktop.
    if (delta <= BOAT_ROUTINE_LOOKAHEAD_MS && delta >= -BOAT_ROUTINE_LOOKAHEAD_MS) return false
  }
  if (input.lastUsedAt === null) return true
  return input.now - input.lastUsedAt >= BOAT_IDLE_MS
}
