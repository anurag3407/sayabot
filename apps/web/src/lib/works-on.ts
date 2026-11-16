/** What each Works on choice means. The agent process stays on this Mac or on Cloud. */
export const WORKS_ON_OPTIONS = [
  [
    "auto",
    "Auto",
    "Reuses a desktop that is already ready. It does not create or wake a Boat. The bot calls select_computer.",
  ],
  [
    "this_computer",
    "This computer",
    "Uses this Mac's screen and apps. Off until you turn it on for this bot.",
  ],
  [
    "local_vm",
    "Private desktop",
    "A container desktop on this Mac. Its files stay when the container is recreated.",
  ],
  [
    "boat",
    "Boat",
    "A hosted desktop at boat.dev. The agent keeps running here. The Boat sleeps after 10 idle minutes and wakes with its files in /home/user.",
  ],
  [
    "vps",
    "Your own VPS",
    "Docker over SSH on a server you own, one container per bot. The agent stays here. Sayabot does not turn that server off.",
  ],
  [
    "e2b",
    "E2B",
    "A cloud Linux sandbox at e2b.dev, one per bot. It pauses when idle and resumes with its files in /home/user.",
  ],
  ["off", "Off", "This bot has no desktop."],
] as const

/** The tiles of the Works on picker. Boat, VPS and E2B share one "Cloud desktop" tile. */
export const WORKS_ON_TILES = [
  { value: "auto", label: "Auto", hint: "Choose automatically" },
  { value: "cloud", label: "Cloud desktop", hint: "A desktop in the cloud" },
  { value: "local_vm", label: "Private desktop", hint: "Isolated local desktop" },
  { value: "this_computer", label: "This computer", hint: "Your screen and apps" },
  { value: "off", label: "Off", hint: "No computer access" },
] as const

export type WorksOnTile = (typeof WORKS_ON_TILES)[number]["value"]

export function isCloudWorksOn(value: string): value is "boat" | "vps" | "e2b" {
  return value === "boat" || value === "vps" || value === "e2b"
}

export function tileOf(worksOn: string): WorksOnTile {
  if (isCloudWorksOn(worksOn)) return "cloud"
  return (WORKS_ON_TILES.some((tile) => tile.value === worksOn) ? worksOn : "auto") as WorksOnTile
}
