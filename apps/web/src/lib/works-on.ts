/** What each Works on choice means. The agent process stays on this Mac or on Cloud. */
export const WORKS_ON_OPTIONS = [
  ["auto", "Auto", "Reuses a desktop that is already ready. It does not create or wake a Boat. The bot calls select_computer."],
  ["this_computer", "This computer", "Uses this Mac's screen and apps. Off until you turn it on for this bot."],
  ["local_vm", "Local VM", "A container desktop on this Mac. Its files stay when the container is recreated."],
  ["boat", "Boat", "A hosted desktop at boat.dev. The agent keeps running here. The Boat sleeps after 10 idle minutes and wakes with its files in /home/user."],
  ["vps", "Your own VPS", "Docker over SSH on a server you own. The agent stays here. Sayabot does not turn that server off."],
  ["off", "Off", "This bot has no desktop."],
] as const
