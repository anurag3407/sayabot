import { NextResponse } from "next/server"
import { DOWNLOADS } from "@/components/landing/content"

export const dynamic = "force-dynamic"

export async function GET() {
  return NextResponse.redirect(DOWNLOADS.androidApk, {
    status: 302,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}
