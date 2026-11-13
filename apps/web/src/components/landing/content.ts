/** Every outbound link on the public site. Change a destination here, once. */
export const GITHUB_URL = "https://github.com/anurag3407/sayabot"
export const SPONSOR_URL = "https://github.com/sponsors/anurag3407"
export const DOWNLOADS = {
  web: "/signup",
  mobile: "/download",
  macDmg: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-arm64.dmg",
  macArm64: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-arm64.dmg",
  macIntel: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-x64.dmg",
  androidApk: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot.apk",
  github: GITHUB_URL,
}

/** The agents used in the public demos. Each name also seeds its mascot. */
export const DEMO_AGENTS = {
  claude: { name: "Claude Code", handle: "claude-code" },
  codex: { name: "Codex", handle: "codex" },
  hermes: { name: "Hermes", handle: "hermes" },
  cursor: { name: "Cursor", handle: "cursor" },
} as const

export type DemoAgent = keyof typeof DEMO_AGENTS
