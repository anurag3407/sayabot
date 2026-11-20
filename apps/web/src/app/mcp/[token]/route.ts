import { getOrchestratorUrl } from "@/lib/env"

export const maxDuration = 300

async function forward(request: Request, token: string) {
  const url = new URL(request.url)
  const target = `${getOrchestratorUrl()}/v1/mcp/${encodeURIComponent(token)}${url.search}`
  const headers = new Headers()
  for (const name of [
    "authorization",
    "content-type",
    "accept",
    "user-agent",
    "x-sayabot-thread-id",
    "x-sayabot-reply-to",
    "x-mesh-thread-id",
    "x-mesh-reply-to",
    "mcp-protocol-version",
    "mcp-session-id",
  ]) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }

  // Preserve host/proto for instruction rendering
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")
  if (host) headers.set("x-forwarded-host", host)
  if (proto) headers.set("x-forwarded-proto", proto)

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
    cache: "no-store",
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body
    init.duplex = "half"
  }
  const response = await fetch(target, init)
  const responseHeaders = new Headers()
  for (const name of [
    "content-type",
    "www-authenticate",
    "allow",
    "mcp-session-id",
    "cache-control",
  ]) {
    const value = response.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  return new Response(response.body, { status: response.status, headers: responseHeaders })
}

type RouteContext = { params: Promise<{ token: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { token } = await context.params
  return forward(request, token)
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params
  return forward(request, token)
}
