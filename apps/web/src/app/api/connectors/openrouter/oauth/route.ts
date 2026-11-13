import { NextResponse } from "next/server"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { requireRouteUser } from "@/lib/route-auth"
import { getPublicOrigin } from "@/lib/public-origin"
import { storeProviderKey } from "@/lib/provider-key-store"
import {
  buildOpenRouterOAuthUrl,
  exchangeOpenRouterCode,
  getOpenRouterKeyDetails,
} from "@/lib/connectors/openrouter"

const VERIFIER_COOKIE = "openrouter_pkce_verifier"
const ORG_COOKIE = "openrouter_oauth_org"

function readCookie(request: Request, name: string): string | undefined {
  const match = (request.headers.get("cookie") || "").match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]+)`),
  )
  return match?.[1] ? decodeURIComponent(match[1]) : undefined
}

async function adminAccess(
  slug: string | undefined,
  user: Awaited<ReturnType<typeof requireRouteUser>>,
) {
  if (!slug || "response" in user) return null
  const access = await getOrgAccess(slug, { user: user.user })
  return access && isOrgAdmin(access.role) ? access : null
}

/**
 * Starts "Sign in with OpenRouter" for a workspace (`?org=<slug>`, admins only). The PKCE verifier
 * and the workspace ride in short-lived httpOnly cookies to the callback.
 */
export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  const slug = new URL(request.url).searchParams.get("org")?.trim()
  if (slug && !(await adminAccess(slug, auth))) {
    return NextResponse.json(
      { error: "Only workspace admins can connect AI accounts" },
      { status: 403 },
    )
  }
  try {
    const origin = getPublicOrigin(request)
    const { authUrl, codeVerifier } = await buildOpenRouterOAuthUrl(
      `${origin}/oauth/callback/openrouter`,
    )
    const response = NextResponse.json({ authUrl })
    const cookie = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 15,
      path: "/",
    }
    response.cookies.set(VERIFIER_COOKIE, codeVerifier, cookie)
    if (slug) response.cookies.set(ORG_COOKIE, slug, cookie)
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate OpenRouter auth URL" },
      { status: 500 },
    )
  }
}

/**
 * The callback's exchange: swaps the code for an OpenRouter key and saves it to the workspace,
 * encrypted. The key itself never goes back to the browser.
 */
export async function POST(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  try {
    const body = (await request.json().catch(() => ({}))) as {
      code?: string
      codeVerifier?: string
      org?: string
    }
    const code = body.code
    const codeVerifier = body.codeVerifier || readCookie(request, VERIFIER_COOKIE)
    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: "Missing authorization code or code verifier" },
        { status: 400 },
      )
    }
    const access = await adminAccess(body.org || readCookie(request, ORG_COOKIE), auth)
    if (!access) {
      return NextResponse.json(
        { error: "Start the sign-in again from Manage AI accounts in your workspace" },
        { status: 403 },
      )
    }

    const { apiKey } = await exchangeOpenRouterCode(code, codeVerifier)
    const details = await getOpenRouterKeyDetails(apiKey).catch(() => null)
    const saved = await storeProviderKey({
      access,
      provider: "openrouter",
      secret: apiKey,
      label: details?.isFreeTier ? "OpenRouter (free)" : "OpenRouter",
      verify: true,
    })
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 422 })

    const response = NextResponse.json({
      ok: true,
      label: saved.label,
      last4: saved.last4,
      freeTier: Boolean(details?.isFreeTier),
      ...(typeof details?.creditsRemaining === "number"
        ? { creditsRemaining: details.creditsRemaining }
        : {}),
    })
    response.cookies.delete(VERIFIER_COOKIE)
    response.cookies.delete(ORG_COOKIE)
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to exchange OpenRouter code" },
      { status: 500 },
    )
  }
}
