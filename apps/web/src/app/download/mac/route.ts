import { NextResponse } from "next/server"
import { DOWNLOADS } from "@/components/landing/content"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const arch = searchParams.get("arch")
  const target = arch === "x64" ? DOWNLOADS.macIntel : DOWNLOADS.macArm64

  return NextResponse.redirect(target, {
    status: 302,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  })
}
