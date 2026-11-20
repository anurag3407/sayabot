"use server"

import { z } from "zod"
import { openSecret, sealSecret } from "@sayabot/llm"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek } from "@/lib/env"
import {
  assertMcpTestable,
  callMcpServerTool,
  listMcpServerTools,
  STDIO_TOOLS_MESSAGE,
} from "@/lib/mcp-client"
import { mcpAuthProviderFor } from "@/lib/mcp-oauth"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  optionalField,
  parseJsonObject,
  revalidateOrg,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

import {
  testWebSearchInOrchestrator,
  testDocumentOcrInOrchestrator,
  fetchSearchProviderCreditsInOrchestrator,
} from "@/lib/orchestrator"

const transportSchema = z.enum(["http", "sse"])
const builtinToolSchema = z.enum([
  "github_bridge",
  "postgres_inspector",
  "web_search",
  "document_extract",
  "terminal_sandbox",
])

function parseHeaders(
  text: string,
): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: {} }
  const parsed = parseJsonObject(text)
  if (!parsed.ok) return parsed
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed.value)) {
    if (typeof value !== "string") return { ok: false, error: "Header values must be strings" }
    headers[key] = value
  }
  return { ok: true, value: headers }
}

async function loadServer(orgId: string, serverId: string) {
  const admin = createAdminClient()
  const { data } = await admin.from("mcp_servers").select("*").eq("id", serverId).maybeSingle()
  if (!data || data.org_id !== orgId) return null
  return data
}

export async function addMcpServer(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const name = field(formData, "name")
  const transport = transportSchema.safeParse(field(formData, "transport") || "http")
  const url = field(formData, "url")
  const roomId = optionalField(formData, "roomId")
  if (name.length < 1 || name.length > 60) return fail("Name must be 1 to 60 characters")
  if (!transport.success) return fail("Choose a transport")
  if (!/^https?:\/\//.test(url)) return fail("MCP URL must start with http(s)://")
  const headers = parseHeaders(field(formData, "headers"))
  if (!headers.ok) return fail(headers.error)
  const dangerousTools = field(formData, "dangerousTools")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const admin = createAdminClient()
  if (roomId) {
    const { data: room } = await admin
      .from("rooms")
      .select("id, org_id")
      .eq("id", roomId)
      .maybeSingle()
    if (!room || room.org_id !== check.access.org.id) return fail("Room not found")
  }
  const { error } = await admin.from("mcp_servers").insert({
    org_id: check.access.org.id,
    room_id: roomId,
    name,
    transport: transport.data,
    url,
    headers_enc: Object.keys(headers.value).length
      ? sealSecret(JSON.stringify({ headers: headers.value }), getKek())
      : null,
    dangerous_tools: dangerousTools,
    enabled: true,
    created_by: check.access.user.id,
  })
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "mcp_server.created",
    target: name,
    metadata: { transport: transport.data, url },
  })
  revalidateOrg(orgSlug)
  return ok("MCP server added")
}

export async function updateMcpServer(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const serverId = field(formData, "serverId")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const existing = await loadServer(check.access.org.id, serverId)
  if (!existing) return fail("MCP server not found")
  const updates: Record<string, unknown> = {
    enabled: field(formData, "enabled") === "true",
    dangerous_tools: field(formData, "dangerousTools")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  }
  const url = field(formData, "url")
  if (url) {
    if (!/^https?:\/\//.test(url)) return fail("MCP URL must start with http(s)://")
    updates.url = url
  }
  const headersText = field(formData, "headers")
  if (headersText) {
    const headers = parseHeaders(headersText)
    if (!headers.ok) return fail(headers.error)
    updates.headers_enc = Object.keys(headers.value).length
      ? sealSecret(JSON.stringify({ headers: headers.value }), getKek())
      : null
  }
  const admin = createAdminClient()
  const { error } = await admin.from("mcp_servers").update(updates).eq("id", serverId)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "mcp_server.updated",
    target: existing.name,
    metadata: { enabled: updates.enabled },
  })
  revalidateOrg(orgSlug)
  return ok("MCP server saved")
}

export async function listMcpTools(orgSlug: string, serverId: string): Promise<ActionResult> {
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const row = await loadServer(check.access.org.id, serverId)
  if (!row) return fail("MCP server not found")
  if (row.transport === "stdio") {
    return ok(STDIO_TOOLS_MESSAGE, { tools: [] })
  }
  try {
    const tools = await listMcpServerTools(row, {
      kek: getKek(),
      authProvider: mcpAuthProviderFor(row),
    })
    return ok(`${tools.length} tools`, { tools })
  } catch (error) {
    return fail(`Could not reach ${row.name}: ${errorMessage(error)}`)
  }
}

export async function invokeMcpTool(
  orgSlug: string,
  serverId: string,
  toolName: string,
  argsJson: string,
): Promise<ActionResult> {
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const row = await loadServer(check.access.org.id, serverId)
  if (!row) return fail("MCP server not found")
  // A local program has no web-side transport; running it is the orchestrator's job.
  try {
    assertMcpTestable(row)
  } catch (error) {
    return fail(errorMessage(error))
  }
  let args: Record<string, unknown> = {}
  if (argsJson.trim()) {
    try {
      const parsed = JSON.parse(argsJson) as unknown
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return fail("Arguments must be a JSON object")
      }
      args = parsed as Record<string, unknown>
    } catch {
      return fail("Arguments must be valid JSON")
    }
  }
  try {
    const result = await callMcpServerTool(
      row,
      { kek: getKek(), authProvider: mcpAuthProviderFor(row) },
      toolName,
      args,
    )
    return ok(result.isError ? "Tool returned an error" : "Tool result", {
      content: result.content,
    })
  } catch (error) {
    return fail(`Tool call failed: ${errorMessage(error)}`)
  }
}

export async function saveOrgToolConfig(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)
  const toolParsed = builtinToolSchema.safeParse(field(formData, "tool"))
  if (!toolParsed.success) return fail("Unknown built-in tool")
  const tool = toolParsed.data
  const enabled = field(formData, "enabled") !== "false"
  const config: Record<string, string> = {}
  if (tool === "github_bridge") {
    const token = field(formData, "githubToken")
    if (!token) return fail("Paste a GitHub token")
    config.token = token
  } else if (tool === "web_search") {
    const provider = field(formData, "provider") || "duckduckgo"
    config.provider = provider
    const apiKey = field(formData, "apiKey")
    const baseUrl = field(formData, "baseUrl")
    if (baseUrl) config.baseUrl = baseUrl

    // Load existing config to retain keys for other providers and allow keeping current key
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("org_tool_configs")
      .select("config_enc")
      .eq("org_id", check.access.org.id)
      .eq("tool", "web_search")
      .maybeSingle()

    let existingKeys: Record<string, string> = {}
    let existingBaseUrls: Record<string, string> = {}
    if (existing?.config_enc) {
      try {
        const old = JSON.parse(openSecret(existing.config_enc, getKek()))
        if (old.keys && typeof old.keys === "object") existingKeys = { ...old.keys }
        if (old.baseUrls && typeof old.baseUrls === "object") existingBaseUrls = { ...old.baseUrls }
        if (old.provider && old.apiKey) existingKeys[old.provider] = old.apiKey
        if (old.provider && old.baseUrl) existingBaseUrls[old.provider] = old.baseUrl
      } catch {}
    }

    if (apiKey) {
      config.apiKey = apiKey
      existingKeys[provider] = apiKey
    } else if (existingKeys[provider]) {
      config.apiKey = existingKeys[provider]
    }

    if (baseUrl) {
      existingBaseUrls[provider] = baseUrl
    }

    config.keys = existingKeys as any
    config.baseUrls = existingBaseUrls as any

    if (!config.apiKey && provider !== "duckduckgo" && provider !== "searxng") {
      return fail(`Please enter an API key for ${provider}`)
    }
  } else if (tool === "document_extract") {
    const provider = field(formData, "provider") || "docling"
    config.provider = provider
    const apiKey = field(formData, "apiKey")
    const baseUrl = field(formData, "baseUrl")
    const fallbackToVision = field(formData, "fallbackToVision") !== "false"
    config.fallbackToVision = String(fallbackToVision)
    if (baseUrl) config.baseUrl = baseUrl

    if (apiKey) {
      config.apiKey = apiKey
    } else if (provider !== "docling" && provider !== "marker" && provider !== "tesseract") {
      const admin = createAdminClient()
      const { data: existing } = await admin
        .from("org_tool_configs")
        .select("config_enc")
        .eq("org_id", check.access.org.id)
        .eq("tool", "document_extract")
        .maybeSingle()
      if (existing?.config_enc) {
        try {
          const old = JSON.parse(openSecret(existing.config_enc, getKek()))
          if (old.apiKey) config.apiKey = old.apiKey
        } catch {}
      }
      if (
        !config.apiKey &&
        provider !== "docling" &&
        provider !== "marker" &&
        provider !== "tesseract" &&
        provider !== "vision_llm"
      ) {
        return fail(`Please enter an API key for ${provider}`)
      }
    }
  } else if (tool === "terminal_sandbox") {
    const provider = field(formData, "provider") || "local"
    config.provider = provider
    const apiKey = field(formData, "apiKey")
    const baseUrl = field(formData, "baseUrl")
    if (baseUrl) config.baseUrl = baseUrl
    if (apiKey) {
      config.apiKey = apiKey
    } else if (provider !== "local" && provider !== "docker") {
      const admin = createAdminClient()
      const { data: existing } = await admin
        .from("org_tool_configs")
        .select("config_enc")
        .eq("org_id", check.access.org.id)
        .eq("tool", "terminal_sandbox")
        .maybeSingle()
      if (existing?.config_enc) {
        try {
          const old = JSON.parse(openSecret(existing.config_enc, getKek()))
          if (old.apiKey) config.apiKey = old.apiKey
        } catch {}
      }
    }
  } else {
    const connectionString = field(formData, "connectionString")
    if (!/^postgres(ql)?:\/\//.test(connectionString)) {
      return fail("Enter a Postgres connection string")
    }
    config.connectionString = connectionString
  }
  const admin = createAdminClient()
  const { error } = await admin.from("org_tool_configs").upsert(
    {
      org_id: check.access.org.id,
      tool,
      config_enc: sealSecret(JSON.stringify(config), getKek()),
      enabled,
      updated_by: check.access.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,tool" },
  )
  if (error) return fail(errorMessage(error))
  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "tool_config.updated",
    target: tool,
    metadata: { enabled },
  })
  revalidateOrg(orgSlug)
  return ok(`${tool} saved`)
}

export async function testWebSearchAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const provider = field(formData, "provider") || "duckduckgo"
  let apiKey = field(formData, "apiKey")
  let baseUrl = field(formData, "baseUrl")
  const query = field(formData, "query") || "latest artificial intelligence news"

  // If apiKey is not provided in form and provider requires key, try reading saved apiKey
  if (!apiKey && provider !== "duckduckgo" && provider !== "searxng") {
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("org_tool_configs")
      .select("config_enc")
      .eq("org_id", check.access.org.id)
      .eq("tool", "web_search")
      .maybeSingle()
    if (existing?.config_enc) {
      try {
        const old = JSON.parse(openSecret(existing.config_enc, getKek()))
        apiKey = old.keys?.[provider] || (old.provider === provider ? old.apiKey : undefined)
        if (!baseUrl)
          baseUrl =
            old.baseUrls?.[provider] || (old.provider === provider ? old.baseUrl : undefined)
      } catch {}
    }
  }

  const result = await testWebSearchInOrchestrator({
    orgId: check.access.org.id,
    provider,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    query,
  })

  if (!result.ok) {
    return fail(result.error)
  }

  return ok(`Search succeeded (${result.count} results in ${result.latencyMs}ms)`, {
    provider: result.provider,
    count: result.count,
    latencyMs: result.latencyMs,
    answer: result.answer,
    results: result.results,
  })
}

export async function fetchSearchProviderCreditsAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const provider = field(formData, "provider") || "duckduckgo"
  let apiKey = field(formData, "apiKey")
  let baseUrl = field(formData, "baseUrl")

  if (!apiKey && provider !== "duckduckgo" && provider !== "searxng" && provider !== "whoogle") {
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("org_tool_configs")
      .select("config_enc")
      .eq("org_id", check.access.org.id)
      .eq("tool", "web_search")
      .maybeSingle()
    if (existing?.config_enc) {
      try {
        const old = JSON.parse(openSecret(existing.config_enc, getKek()))
        apiKey = old.keys?.[provider] || (old.provider === provider ? old.apiKey : undefined)
        if (!baseUrl)
          baseUrl =
            old.baseUrls?.[provider] || (old.provider === provider ? old.baseUrl : undefined)
      } catch {}
    }
  }

  const result = await fetchSearchProviderCreditsInOrchestrator({
    orgId: check.access.org.id,
    provider,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
  })

  if (!result.ok) {
    return fail(result.error || `Failed to check credits for ${provider}`)
  }

  return ok(result.details || `Balance: ${result.credits || "Active"}`, {
    provider: result.provider,
    credits: result.credits,
    remaining: result.remaining,
    total: result.total,
    plan: result.plan,
    resetDate: result.resetDate,
    details: result.details,
  })
}

export async function testDocumentOcrAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const provider = field(formData, "provider") || "docling"
  let apiKey = field(formData, "apiKey")
  const baseUrl = field(formData, "baseUrl")
  const source =
    field(formData, "source") ||
    "https://raw.githubusercontent.com/DS4SD/docling/main/tests/data/2206.01062.pdf"

  if (!apiKey && provider !== "docling" && provider !== "marker" && provider !== "tesseract") {
    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("org_tool_configs")
      .select("config_enc")
      .eq("org_id", check.access.org.id)
      .eq("tool", "document_extract")
      .maybeSingle()
    if (existing?.config_enc) {
      try {
        const old = JSON.parse(openSecret(existing.config_enc, getKek()))
        if (old.apiKey) apiKey = old.apiKey
      } catch {}
    }
  }

  const result = await testDocumentOcrInOrchestrator({
    orgId: check.access.org.id,
    provider,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
    source,
  })

  if (!result.ok) {
    return fail(result.error)
  }

  return ok(
    `Document test succeeded with ${result.provider} (${result.tablesCount} tables, ${result.processingTimeMs}ms)${result.fallback ? " [Fell back to Vision]" : ""}`,
    {
      provider: result.provider,
      source: result.source,
      pageCount: result.pageCount,
      tablesCount: result.tablesCount,
      markdownPreview: result.markdownPreview,
      processingTimeMs: result.processingTimeMs,
      fallback: result.fallback,
      warning: result.warning,
    },
  )
}

/**
 * Where a connected app's tools apply: every room (`roomId: null`) or just one room. Room
 * settings uses this for "Only this room" / "All rooms" on each app.
 */
export async function setMcpServerRoomAction(input: {
  orgSlug: string
  serverId: string
  roomId: string | null
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)
  const orgId = check.access.org.id
  const server = await loadServer(orgId, input.serverId)
  if (!server) return fail("Connection not found")
  const admin = createAdminClient()
  if (input.roomId) {
    const { data: room } = await admin
      .from("rooms")
      .select("id, org_id")
      .eq("id", input.roomId)
      .maybeSingle()
    if (!room || room.org_id !== orgId) return fail("Room not found")
  }
  const { error } = await admin
    .from("mcp_servers")
    .update({ room_id: input.roomId, updated_at: new Date().toISOString() })
    .eq("id", server.id)
  if (error) return fail(errorMessage(error))
  await audit({
    orgId,
    actorId: check.access.user.id,
    action: "mcp_server.scope_changed",
    target: server.name as string,
    metadata: { roomId: input.roomId },
  })
  revalidateOrg(input.orgSlug)
  return ok(
    input.roomId
      ? `${server.name} now works only in this room`
      : `${server.name} now works in every room`,
  )
}
