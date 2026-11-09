import { NextResponse } from "next/server"
import { requireRouteUser } from "@/lib/route-auth"
import { buildChatGptPlanAuthUrl, exchangeChatGptPlanCode } from "@/lib/connectors/chatgpt-plan"

export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  try {
    const { origin } = new URL(request.url)
    const callbackUrl = `${origin}/oauth/callback/chatgpt`
    const { authUrl, codeVerifier, state } = await buildChatGptPlanAuthUrl(callbackUrl)

    const response = NextResponse.json({ authUrl, codeVerifier, state })
    response.cookies.set("chatgpt_pkce_verifier", codeVerifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 15,
      path: "/",
    })
    return response
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate ChatGPT plan auth URL",
      },
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
      const cookieHeader = request.headers.get("cookie") || ""
      const match = cookieHeader.match(/chatgpt_pkce_verifier=([^;]+)/)
      if (match) codeVerifier = decodeURIComponent(match[1]!)
    }

    if (!code || !codeVerifier) {
      return NextResponse.json({ error: "Missing authorization code or verifier" }, { status: 400 })
    }

    const { origin } = new URL(request.url)
    const redirectUri = `${origin}/oauth/callback/chatgpt`
    const credentials = await exchangeChatGptPlanCode(code, codeVerifier, redirectUri)

    return NextResponse.json({
      ok: true,
      credentials,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to exchange ChatGPT authorization code",
      },
      { status: 500 },
    )
  }
}
