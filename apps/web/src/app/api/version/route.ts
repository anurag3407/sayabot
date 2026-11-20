import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export interface VersionInfo {
  version: string
  gitCommit: string
  buildTime: string
  latestDesktopVersion: string
  latestMobileVersion: string
  dmgUrl: string
  /** The DMGs of exactly latestDesktopVersion, per chip (Mac app updater). */
  dmgUrls: { arm64: string; x64: string }
  /** Unpacked Windows app zips of exactly latestDesktopVersion (in-app updater). */
  winUrls: { arm64: string; x64: string }
  /** NSIS installers (first-run download). */
  winSetupUrls: { arm64: string; x64: string }
  apkUrl: string
  releaseNotes: string
}

const RELEASES_API = "https://api.github.com/repos/anurag3407/sayabot/releases?per_page=10"
const DOWNLOADS = "https://github.com/anurag3407/sayabot/releases/download"
const FALLBACK_DESKTOP_VERSION = "1.0.0"
const DMG_NAMES = ["Sayabot-arm64.dmg", "Sayabot-x64.dmg"] as const

interface GithubRelease {
  tag_name?: string
  draft?: boolean
  prerelease?: boolean
  assets?: Array<{ name?: string; state?: string; size?: number }>
}

/**
 * The newest Mac app whose disk images are fully uploaded. A release can exist for a minute
 * before its DMGs finish uploading; announcing it then makes installed apps fail to download.
 * Cached for 10 minutes to stay far below GitHub's unauthenticated rate limit.
 * DESKTOP_LATEST_VERSION overrides it.
 */
async function latestDesktopVersion(): Promise<string> {
  const override = process.env.DESKTOP_LATEST_VERSION
  if (override) return override
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) return FALLBACK_DESKTOP_VERSION
    const releases = (await res.json()) as GithubRelease[]
    let best: [number, number, number] | null = null
    for (const release of Array.isArray(releases) ? releases : []) {
      if (release.draft || release.prerelease) continue
      const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(release.tag_name ?? "")
      if (!match) continue
      const ready = DMG_NAMES.every((name) =>
        release.assets?.some(
          (asset) => asset.name === name && asset.state === "uploaded" && (asset.size ?? 0) > 0,
        ),
      )
      if (!ready) continue
      const version: [number, number, number] = [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
      ]
      if (
        !best ||
        version[0] > best[0] ||
        (version[0] === best[0] &&
          (version[1] > best[1] || (version[1] === best[1] && version[2] > best[2])))
      ) {
        best = version
      }
    }
    return best ? best.join(".") : FALLBACK_DESKTOP_VERSION
  } catch {
    return FALLBACK_DESKTOP_VERSION
  }
}

export async function GET() {
  const desktop = await latestDesktopVersion()
  const versionInfo: VersionInfo = {
    version: process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || "1.0.1",
    gitCommit: (process.env.GIT_COMMIT_SHA || "593567b").slice(0, 7),
    buildTime: process.env.BUILD_TIME || "2026-11-12T00:50:00Z",
    latestDesktopVersion: desktop,
    latestMobileVersion: process.env.MOBILE_LATEST_VERSION || "1.1.0",
    dmgUrl: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-arm64.dmg",
    dmgUrls: {
      arm64: `${DOWNLOADS}/v${desktop}/Sayabot-arm64.dmg`,
      x64: `${DOWNLOADS}/v${desktop}/Sayabot-x64.dmg`,
    },
    winUrls: {
      arm64: `${DOWNLOADS}/v${desktop}/Sayabot-win-arm64.zip`,
      x64: `${DOWNLOADS}/v${desktop}/Sayabot-win-x64.zip`,
    },
    winSetupUrls: {
      arm64: `${DOWNLOADS}/v${desktop}/Sayabot-Setup-arm64.exe`,
      x64: `${DOWNLOADS}/v${desktop}/Sayabot-Setup-x64.exe`,
    },
    apkUrl: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot.apk",
    releaseNotes: "",
  }

  return NextResponse.json(versionInfo, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  })
}
