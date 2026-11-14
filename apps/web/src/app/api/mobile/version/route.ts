import { NextResponse } from "next/server"
import { DOWNLOADS } from "@/components/landing/content"

export const dynamic = "force-dynamic"

export interface MobileVersionInfo {
  latestVersion: string
  minSupportedVersion: string
  apkUrl: string
  releaseNotes: string
  publishedAt: string
}

export async function GET() {
  const versionInfo: MobileVersionInfo = {
    latestVersion: process.env.MOBILE_LATEST_VERSION || "1.1.0",
    minSupportedVersion: process.env.MOBILE_MIN_VERSION || "1.0.0",
    apkUrl: process.env.MOBILE_APK_URL || DOWNLOADS.androidApk,
    releaseNotes:
      process.env.MOBILE_RELEASE_NOTES ||
      "Performance improvements, updated agent tools, and stability fixes.",
    publishedAt: process.env.MOBILE_RELEASE_DATE || new Date().toISOString(),
  }

  return NextResponse.json(versionInfo, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
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
