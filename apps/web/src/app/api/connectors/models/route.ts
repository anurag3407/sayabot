import { NextResponse } from "next/server"
import { getAllGroupedModels } from "@/lib/connectors/registry"

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const openRouterKey = searchParams.get("openRouterKey") || process.env.OPENROUTER_API_KEY
    const data = await getAllGroupedModels(openRouterKey)
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load models" },
      { status: 500 },
    )
  }
}
