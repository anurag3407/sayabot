import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export interface VersionInfo {
  version: string
  gitCommit: string
  buildTime: string
  latestDesktopVersion: string
  latestMobileVersion: string
  dmgUrl: string
  apkUrl: string
  releaseNotes: string
}

const RELEASES_API = "https://api.github.com/repos/anurag3407/sayabot/releases/latest"
const FALLBACK_DESKTOP_VERSION = "1.0.0"

/**
 * The newest Mac app is whatever the latest GitHub release is (published by
 * .github/workflows/desktop-release.yml, tagged v<version>). Cached for 10 minutes so we stay
 * far below GitHub's unauthenticated rate limit. DESKTOP_LATEST_VERSION overrides it.
 */
async function latestDesktopVersion(): Promise<string> {
  const override = process.env.DESKTOP_LATEST_VERSION
  if (override) return override
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return FALLBACK_DESKTOP_VERSION
    const data = (await res.json()) as { tag_name?: string }
    const version = data.tag_name?.replace(/^v/, "")
    return version && /^\d+\.\d+\.\d+$/.test(version) ? version : FALLBACK_DESKTOP_VERSION
  } catch {
    return FALLBACK_DESKTOP_VERSION
  }
}

export async function GET() {
  const versionInfo: VersionInfo = {
    version: process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || "1.0.1",
    gitCommit: (process.env.GIT_COMMIT_SHA || "593567b").slice(0, 7),
    buildTime: process.env.BUILD_TIME || "2026-11-12T00:50:00Z",
    latestDesktopVersion: await latestDesktopVersion(),
    latestMobileVersion: process.env.MOBILE_LATEST_VERSION || "1.1.0",
    dmgUrl: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot-arm64.dmg",
    apkUrl: "https://github.com/anurag3407/sayabot/releases/latest/download/Sayabot.apk",
    releaseNotes:
      "Seamless Mac app deep-link login handoff, local model usage analytics, and automatic update alerts.",
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
