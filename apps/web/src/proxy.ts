import { NextResponse, type NextRequest } from "next/server"
import { updateSession } from "@/lib/supabase/proxy"
import { safeNextPath } from "@/lib/safe-next"

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/terms",
  "/privacy",
  "/security",
  "/help",
  "/download",
  "/auth",
  "/offline",
  "/api/v1",
  "/api/connectors",
  "/api/mobile",
  "/api/version",
  "/api/download",
  // MCP connector short URL (/mcp/<agent key>). Authenticated by the key, not a session.
  "/mcp",
  // "Add an agent" links (/bot/<code>): a bot asks to join; a person approves in the Inbox.
  "/bot",
  // Desktop app (authenticated by its host token) and remote-desktop signaling (session or bearer).
  "/api/desktop",
  "/api/remote",
  // Chat attachments: the route checks room access itself (cookie or bearer).
  "/api/files",
  // Guest → account merge: the desktop calls it with its bearer token; the route checks auth.
  "/api/account/merge",
  // OAuth 2.1 public endpoints (discovery, dynamic registration, token exchange, callbacks)
  "/.well-known",
  "/oauth/register",
  "/oauth/token",
  "/oauth/callback",
]

function redirectWithCookies(url: URL | string, sourceResponse: NextResponse): NextResponse {
  const redirectRes = NextResponse.redirect(url)
  for (const cookie of sourceResponse.cookies.getAll()) {
    redirectRes.cookies.set(cookie.name, cookie.value, cookie)
  }
  return redirectRes
}

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)
  const pathname = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  const isForceAuth =
    request.nextUrl.searchParams.get("force") === "true" ||
    request.nextUrl.searchParams.get("reauth") === "true" ||
    request.nextUrl.searchParams.get("switch") === "true"

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", pathname)
    return redirectWithCookies(url, response)
  }
  if (user && (pathname === "/login" || pathname === "/signup") && !isForceAuth) {
    const rawNext = request.nextUrl.searchParams.get("next")
    const next = safeNextPath(rawNext, "")
    if (next && next !== "/" && next !== "/login" && next !== "/signup") {
      const url = new URL(next, request.url)
      return redirectWithCookies(url, response)
    }
    const url = request.nextUrl.clone()
    url.pathname = "/"
    url.search = ""
    return redirectWithCookies(url, response)
  }
  return response
}

export const config = {
  matcher: [
    "/((?!api/health|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|sw.js|swe-worker|workbox).*)",
  ],
}
