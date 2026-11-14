import { createClient, type User } from "@supabase/supabase-js"
import { audit } from "@/lib/actions/shared"
import {
  getComputerdUrl,
  getOrchestratorUrl,
  getSupabaseAnonKey,
  getSupabaseUrl,
} from "@/lib/env"
import { createAdminClient } from "@/lib/supabase/admin"
import { macApprovalBlock, readMacMarker } from "@/lib/mac-runner"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const maxDuration = 300

async function authenticateUser(request: Request): Promise<User | null> {
  const authHeader = request.headers.get("authorization")
  if (authHeader && authHeader.slice(0, 7).toLowerCase() === "bearer ") {
    const token = authHeader.slice(7).trim()
    const tokenClient = createClient<any>(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await tokenClient.auth.getUser(token)
    if (!error && data?.user) return data.user
  }
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.auth.getUser()
  return data?.user ?? null
}

async function handleToolApproval(request: Request, toolCallId: string): Promise<Response> {
  const user = await authenticateUser(request)
  if (!user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })
  }

  const body = (await request.json().catch(() => ({}))) as { approved?: boolean }
  const decision: "approved" | "rejected" = body.approved ? "approved" : "rejected"

  const admin = createAdminClient()
  const { data: toolCall } = await admin
    .from("tool_calls")
    .select("id, room_id, status, tool_name, args")
    .eq("id", toolCallId)
    .maybeSingle()

  if (!toolCall) {
    return new Response(JSON.stringify({ error: "Tool call not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  }

  if (toolCall.status !== "pending_approval") {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Tool call is not pending approval",
        status: toolCall.status,
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    )
  }

  const { data: room } = await admin
    .from("rooms")
    .select("id, org_id")
    .eq("id", toolCall.room_id)
    .single()

  if (!room) {
    return new Response(JSON.stringify({ error: "Room not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    })
  }

  const { data: roomMember } = await admin
    .from("room_members")
    .select("role")
    .eq("room_id", room.id)
    .eq("user_id", user.id)
    .maybeSingle()

  const { data: orgMember } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", room.org_id)
    .eq("user_id", user.id)
    .maybeSingle()

  // A step on someone's Mac is theirs to allow (from the phone too); anything else needs an admin.
  const macBlock = await macApprovalBlock(toolCall.args, user.id)
  if (macBlock) {
    return new Response(JSON.stringify({ error: macBlock }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  }
  const isMac = Boolean(readMacMarker(toolCall.args))
  const canAdmin =
    isMac ||
    roomMember?.role === "admin" ||
    orgMember?.role === "owner" ||
    orgMember?.role === "admin"

  if (!canAdmin) {
    return new Response(
      JSON.stringify({ error: "Only room or organization admins can approve tool calls" }),
      { status: 403, headers: { "content-type": "application/json" } },
    )
  }

  const { error: updateError } = await admin
    .from("tool_calls")
    .update({
      status: decision,
      approved_by: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", toolCallId)
    .eq("status", "pending_approval")

  if (updateError) {
    return new Response(JSON.stringify({ error: updateError.message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })
  }

  await admin.rpc("notify_tool_resolution", {
    p_tool_call: toolCallId,
    p_status: decision,
  })

  await audit({
    orgId: room.org_id,
    actorId: user.id,
    action: `tool.${decision}`,
    target: toolCallId,
    metadata: { tool: toolCall.tool_name, roomId: toolCall.room_id },
  })

  return new Response(JSON.stringify({ ok: true, status: decision }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

async function authorizeComputerAccess(
  request: Request,
  agentId: string,
  requiredRole: "member" | "admin" = "member",
): Promise<{ ok: true; user: User; orgId: string } | { ok: false; response: Response }> {
  const user = await authenticateUser(request)
  if (!user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    }
  }

  const admin = createAdminClient()
  let orgId: string | null = null

  // 1. Check agent_computers table
  const { data: computer } = await admin
    .from("agent_computers")
    .select("org_id")
    .eq("agent_id", agentId)
    .maybeSingle()

  if (computer?.org_id) {
    orgId = computer.org_id
  } else {
    // 2. Check agents table
    const { data: agent } = await admin
      .from("agents")
      .select("org_id")
      .eq("id", agentId)
      .maybeSingle()
    if (agent?.org_id) {
      orgId = agent.org_id
    }
  }

  if (!orgId) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Computer or agent not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    }
  }

  // 3. Check membership in organization
  const { data: orgMember } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle()

  if (!orgMember) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Forbidden: you are not a member of this workspace" }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    }
  }

  if (requiredRole === "admin" && orgMember.role !== "owner" && orgMember.role !== "admin") {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Only organization admins can perform this action" }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    }
  }

  return { ok: true, user, orgId }
}

async function handleComputerStop(request: Request, agentId: string): Promise<Response> {
  const auth = await authorizeComputerAccess(request, agentId, "admin")
  if (!auth.ok) return auth.response
  const { user, orgId } = auth

  const computerdUrl = getComputerdUrl()
  const secret = process.env.ORCHESTRATOR_INTERNAL_SECRET || ""

  try {
    await fetch(`${computerdUrl}/v1/computers/${agentId}/stop`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      signal: AbortSignal.timeout(5000),
    })
  } catch (err) {
    console.error(`[computers/stop] failed to call computerd stop:`, err)
  }

  const admin = createAdminClient()
  await admin.from("agent_computers").update({ status: "stopped" }).eq("agent_id", agentId)

  await audit({
    orgId,
    actorId: user.id,
    action: "computer.stopped",
    target: agentId,
  })

  return new Response(JSON.stringify({ ok: true, status: "stopped" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

async function forward(request: Request, path: string[]) {
  if (!path.length || !path.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) {
    return new Response("not found", { status: 404 })
  }

  // Handle mobile tool approval endpoint
  if (path[0] === "tools" && path[2] === "approve" && path.length === 3 && request.method === "POST" && path[1]) {
    return handleToolApproval(request, path[1])
  }

  // Reject any unauthorized access to internal tool endpoints
  if (path[0] === "tools") {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })
  }

  // Handle mobile computer stop endpoint
  if (path[0] === "computers" && path[2] === "stop" && path.length === 3 && request.method === "POST" && path[1]) {
    return handleComputerStop(request, path[1])
  }

  const isComputerRoute = path[0] === "computers"

  // CRITICAL SECURITY ENFORCEMENT: All computer routes must be authenticated and authorized
  if (isComputerRoute) {
    const agentId = path[1]
    if (!agentId) {
      return new Response(JSON.stringify({ error: "agentId is required" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      })
    }
    const requiredRole = request.method === "DELETE" ? "admin" : "member"
    const auth = await authorizeComputerAccess(request, agentId, requiredRole)
    if (!auth.ok) {
      return auth.response
    }

    if (path[2] === "exec") {
      await audit({
        orgId: auth.orgId,
        actorId: auth.user.id,
        action: "computer.exec",
        target: agentId,
      })
    }
  }

  const url = new URL(request.url)
  const baseTarget = isComputerRoute ? getComputerdUrl() : getOrchestratorUrl()
  const target = `${baseTarget}/v1/${path.join("/")}${url.search}`

  const headers = new Headers()
  for (const name of [
    "authorization",
    "content-type",
    "accept",
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

  if (isComputerRoute && process.env.ORCHESTRATOR_INTERNAL_SECRET) {
    headers.set("x-internal-secret", process.env.ORCHESTRATOR_INTERNAL_SECRET)
  }

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
  for (const name of ["content-type", "www-authenticate", "allow", "mcp-session-id"]) {
    const value = response.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  // Disable buffering for live streaming
  responseHeaders.set("x-accel-buffering", "no")

  return new Response(response.body, { status: response.status, headers: responseHeaders })
}

type RouteContext = { params: Promise<{ path: string[] }> }

export async function POST(request: Request, context: RouteContext) {
  const { path } = await context.params
  return forward(request, path)
}

export async function GET(request: Request, context: RouteContext) {
  const { path } = await context.params
  return forward(request, path)
}

export async function DELETE(request: Request, context: RouteContext) {
  const { path } = await context.params
  return forward(request, path)
}
