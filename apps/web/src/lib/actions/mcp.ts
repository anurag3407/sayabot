"use server"

import { z } from "zod"
import { createMCPClient } from "@ai-sdk/mcp"
import { openSecret, sealSecret } from "@sayabot/llm"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek } from "@/lib/env"
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

import { testWebSearchInOrchestrator, testDocumentOcrInOrchestrator } from "@/lib/orchestrator"

const transportSchema = z.enum(["http", "sse"])
const builtinToolSchema = z.enum([
  "github_bridge",
  "postgres_inspector",
  "web_search",
  "document_extract",
  "terminal_sandbox",
])

function parseHeaders(text: string): { ok: true; value: Record<string, string> } | { ok: false; error: string } {
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

function headersFor(row: { headers_enc: string | null }): Record<string, string> {
  if (!row.headers_enc) return {}
  const parsed = JSON.parse(openSecret(row.headers_enc, getKek())) as {
    headers?: Record<string, string>
  }
  return parsed.headers ?? {}
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
    return ok("This program runs when an agent uses it.", { tools: [] })
  }
  let client
  try {
    client = await createMCPClient({
      transport: {
        type: row.transport,
        url: row.url,
        headers: headersFor(row),
        redirect: "error",
        authProvider: mcpAuthProviderFor(row),
      },
    })
    const result = await client.listTools()
    return ok(`${result.tools.length} tools`, {
      tools: result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description ?? "",
      })),
    })
  } catch (error) {
    return fail(`Could not reach ${row.name}: ${errorMessage(error)}`)
  } finally {
    await client?.close().catch(() => {})
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
  let client
  try {
    client = await createMCPClient({
      transport: {
        type: row.transport,
        url: row.url,
        headers: headersFor(row),
        redirect: "error",
        authProvider: mcpAuthProviderFor(row),
      },
    })
    const result = (await client.callTool({
      name: toolName,
      arguments: args,
    })) as { content?: unknown[]; isError?: boolean }
    return ok(result.isError ? "Tool returned an error" : "Tool result", {
      content: result.content ?? [],
    })
  } catch (error) {
    return fail(`Tool call failed: ${errorMessage(error)}`)
  } finally {
    await client?.close().catch(() => {})
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

    if (apiKey) {
      config.apiKey = apiKey
    } else if (provider !== "duckduckgo" && provider !== "searxng") {
      // Check existing config to allow keeping previous key
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
          if (old.apiKey) config.apiKey = old.apiKey
        } catch {}
      }
      if (!config.apiKey && provider !== "duckduckgo" && provider !== "searxng") {
        return fail(`Please enter an API key for ${provider}`)
      }
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
      if (!config.apiKey && provider !== "docling" && provider !== "marker" && provider !== "tesseract" && provider !== "vision_llm") {
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
  const baseUrl = field(formData, "baseUrl")
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
        if (old.apiKey) apiKey = old.apiKey
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
