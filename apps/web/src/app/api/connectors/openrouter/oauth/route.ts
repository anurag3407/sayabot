import { NextResponse } from "next/server"
import { requireRouteUser } from "@/lib/route-auth"
import { getPublicOrigin } from "@/lib/public-origin"
import {
  buildOpenRouterOAuthUrl,
  exchangeOpenRouterCode,
  getOpenRouterKeyDetails,
} from "@/lib/connectors/openrouter"

export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  try {
    const origin = getPublicOrigin(request)
    const callbackUrl = `${origin}/oauth/callback/openrouter`
    const { authUrl, codeVerifier } = await buildOpenRouterOAuthUrl(callbackUrl)

    const response = NextResponse.json({ authUrl, codeVerifier })
    response.cookies.set("openrouter_pkce_verifier", codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 15, // 15 mins
      path: "/",
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate OpenRouter auth URL" },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  try {
    const body = (await request.json()) as { code?: string; codeVerifier?: string }
    const { code } = body
    let codeVerifier = body.codeVerifier

    if (!codeVerifier) {
      // Check cookie
      const cookieHeader = request.headers.get("cookie") || ""
      const match = cookieHeader.match(/openrouter_pkce_verifier=([^;]+)/)
      if (match) codeVerifier = decodeURIComponent(match[1]!)
    }

    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: "Missing authorization code or code verifier" },
        { status: 400 },
      )
    }

    const { apiKey } = await exchangeOpenRouterCode(code, codeVerifier)
    const keyDetails = await getOpenRouterKeyDetails(apiKey).catch(() => ({
      label: "OpenRouter OAuth Key",
      usage: 0,
      limit: null,
      isFreeTier: false,
    }))

    return NextResponse.json({
      ok: true,
      apiKey,
      keyDetails,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to exchange OpenRouter code" },
      { status: 500 },
    )
  }
}
