import { NextResponse } from "next/server"
import { requireRouteUser } from "@/lib/route-auth"
import { getAllGroupedModels } from "@/lib/connectors/registry"

export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  try {
    // Header, not query string: keys in URLs end up in proxy and access logs.
    const openRouterKey = request.headers.get("x-openrouter-key") || process.env.OPENROUTER_API_KEY
    const data = await getAllGroupedModels(openRouterKey)
    return NextResponse.json(data)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load models" },
      { status: 500 },
    )
  }
}
