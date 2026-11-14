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

export async function GET() {
  const versionInfo: VersionInfo = {
    version: process.env.APP_VERSION || process.env.NEXT_PUBLIC_APP_VERSION || "1.0.1",
    gitCommit: (process.env.GIT_COMMIT_SHA || "593567b").slice(0, 7),
    buildTime: process.env.BUILD_TIME || "2026-11-12T00:50:00Z",
    latestDesktopVersion: process.env.DESKTOP_LATEST_VERSION || "1.0.1",
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
