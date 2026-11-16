/**
 * Every outbound link on the landing page. The site itself has no sign-in or app: it sends
 * people to a download, the hosted web app, or GitHub. Change a destination here, once.
 */
const REPO = "https://github.com/anurag3407/sayabot"
const RELEASE = `${REPO}/releases/latest/download`
/** The hosted web app. Override at build time for a self-hosted deployment. */
export const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://sayabot.sayalabs.in"

export const LINKS = {
  app: `${APP_URL}/login`,
  signup: `${APP_URL}/signup`,
  privacy: `${APP_URL}/privacy`,
  terms: `${APP_URL}/terms`,
  security: `${APP_URL}/security`,
  github: REPO,
  releases: `${REPO}/releases/latest`,
  sponsor: "https://github.com/sponsors/anurag3407",
  selfHost: `${REPO}/blob/main/docs/self-hosting-quickstart.md`,
  docs: `${REPO}/tree/main/docs`,
  issues: `${REPO}/issues`,
  license: `${REPO}/blob/main/LICENSING.md`,
} as const

export type DownloadId = "macArm" | "macIntel" | "winX64" | "winArm" | "android"

export const DOWNLOADS: Record<
  DownloadId,
  {
    label: string
    detail: string
    href: string
    file: string
    platform: "mac" | "windows" | "android"
  }
> = {
  macArm: {
    label: "Mac · Apple silicon",
    detail: "macOS 14+ · .dmg",
    href: `${RELEASE}/Sayabot-arm64.dmg`,
    file: "Sayabot-arm64.dmg",
    platform: "mac",
  },
  macIntel: {
    label: "Mac · Intel",
    detail: "macOS 14+ · .dmg",
    href: `${RELEASE}/Sayabot-x64.dmg`,
    file: "Sayabot-x64.dmg",
    platform: "mac",
  },
  winX64: {
    label: "Windows · x64",
    detail: "x64 · .exe installer",
    href: `${RELEASE}/Sayabot-Setup-x64.exe`,
    file: "Sayabot-Setup-x64.exe",
    platform: "windows",
  },
  winArm: {
    label: "Windows · ARM",
    detail: "ARM64 · .exe installer",
    href: `${RELEASE}/Sayabot-Setup-arm64.exe`,
    file: "Sayabot-Setup-arm64.exe",
    platform: "windows",
  },
  android: {
    label: "Android",
    detail: "Android 7+ · .apk",
    href: `${RELEASE}/Sayabot.apk`,
    file: "Sayabot.apk",
    platform: "android",
  },
}
