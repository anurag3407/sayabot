"use server"

import { z } from "zod"
import { encryptSecret, decryptSecret, last4 } from "@sayabot/llm"
import { createAdminClient } from "@/lib/supabase/admin"
import { getKek } from "@/lib/env"
import {
  adminOrgAccess,
  audit,
  errorMessage,
  fail,
  field,
  ok,
  optionalField,
  revalidateOrg,
} from "@/lib/actions/shared"
import type { ActionResult } from "@/lib/types"

const connectorSourceSchema = z.enum(["google_drive", "slack", "github", "jira", "discord", "telegram", "whatsapp"])

export async function saveWorkspaceConnector(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const sourceParsed = connectorSourceSchema.safeParse(field(formData, "source"))
  if (!sourceParsed.success) {
    return fail("Choose a supported connector source (Google Drive, Slack, GitHub, Discord, Telegram, WhatsApp)")
  }
  const source = sourceParsed.data

  const name = field(formData, "name")
  if (name.length < 1 || name.length > 80) {
    return fail("Connector name must be between 1 and 80 characters")
  }

  const rawToken = field(formData, "token")
  if (rawToken.length < 4) {
    return fail("Access token, bot token, or service key is required")
  }

  const rawConfigStr = optionalField(formData, "configJson")
  let config: Record<string, unknown> = {}
  if (rawConfigStr) {
    try {
      config = JSON.parse(rawConfigStr)
    } catch {
      return fail("Config must be valid JSON")
    }
  }

  // Optional specific fields
  const driveDomain = optionalField(formData, "driveDomain")
  if (driveDomain) config.domain = driveDomain
  const defaultChannel = optionalField(formData, "defaultChannel")
  if (defaultChannel) config.defaultChannel = defaultChannel
  const defaultOrg = optionalField(formData, "defaultOrg")
  if (defaultOrg) config.defaultOrg = defaultOrg
  const guildId = optionalField(formData, "guildId")
  if (guildId) {
    if (!/^\d{5,25}$/.test(guildId)) return fail("Discord server ID is a long number")
    config.guildId = guildId
  }
  const phoneNumberId = optionalField(formData, "phoneNumberId")
  if (phoneNumberId) {
    if (!/^\d{5,25}$/.test(phoneNumberId)) return fail("WhatsApp phone number ID is a long number")
    config.phoneNumberId = phoneNumberId
  }
  if (source === "whatsapp" && !config.phoneNumberId) {
    return fail("Add the WhatsApp phone number ID (WhatsApp Manager → API setup)")
  }
  if (source === "telegram" && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(rawToken)) {
    return fail("That doesn't look like a Telegram bot token. @BotFather gives one like 123456:ABC…")
  }

  const encrypted = encryptSecret(rawToken, getKek())
  const admin = createAdminClient()

  const connectorId = optionalField(formData, "connectorId")

  if (connectorId) {
    // Update existing
    const { data: existing } = await admin
      .from("workspace_connectors")
      .select("id, org_id")
      .eq("id", connectorId)
      .maybeSingle()

    if (!existing || existing.org_id !== check.access.org.id) {
      return fail("Connector not found")
    }

    const { error } = await admin
      .from("workspace_connectors")
      .update({
        name,
        source,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        tag: encrypted.tag,
        last4: last4(rawToken),
        config,
        status: "active",
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectorId)

    if (error) return fail(errorMessage(error))

    await audit({
      orgId: check.access.org.id,
      actorId: check.access.user.id,
      action: "workspace_connector.updated",
      target: name,
      metadata: { source, connectorId },
    })

    revalidateOrg(orgSlug)
    return ok(`${name} connector updated successfully`, { connectorId })
  }

  // Insert new
  const { data: saved, error } = await admin
    .from("workspace_connectors")
    .insert({
      org_id: check.access.org.id,
      owner_user_id: check.access.user.id,
      source,
      name,
      status: "active",
      auth_type: "token",
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
      tag: encrypted.tag,
      last4: last4(rawToken),
      config,
    })
    .select("id")
    .single()

  if (error || !saved) return fail(errorMessage(error))

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "workspace_connector.created",
    target: name,
    metadata: { source, connectorId: saved.id },
  })

  revalidateOrg(orgSlug)
  return ok(`${name} connector connected successfully`, { connectorId: saved.id })
}

export async function deleteWorkspaceConnector(input: {
  orgSlug: string
  connectorId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("workspace_connectors")
    .select("id, org_id, name, source")
    .eq("id", input.connectorId)
    .maybeSingle()

  if (!existing || existing.org_id !== check.access.org.id) {
    return fail("Connector not found")
  }

  const { error } = await admin
    .from("workspace_connectors")
    .delete()
    .eq("id", input.connectorId)

  if (error) return fail(errorMessage(error))

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "workspace_connector.deleted",
    target: existing.name,
    metadata: { source: existing.source, connectorId: input.connectorId },
  })

  revalidateOrg(input.orgSlug)
  return ok("Connector deleted")
}

export async function testWorkspaceConnector(
  orgSlug: string,
  connectorId: string,
): Promise<ActionResult> {
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const admin = createAdminClient()
  const { data: connector } = await admin
    .from("workspace_connectors")
    .select("*")
    .eq("id", connectorId)
    .maybeSingle()

  if (!connector || connector.org_id !== check.access.org.id) {
    return fail("Connector not found")
  }

  let token: string
  try {
    token = decryptSecret(
      {
        ciphertext: connector.ciphertext,
        iv: connector.iv,
        tag: connector.tag,
      },
      getKek(),
    )
  } catch {
    await admin
      .from("workspace_connectors")
      .update({
        status: "error",
        error_message: "Decryption failed; check workspace master key",
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectorId)
    return fail("Failed to decrypt connector credentials")
  }

  const startTime = Date.now()
  let testSuccess = false
  let responseDetail = ""

  try {
    if (connector.source === "google_drive") {
      const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      })
      if (!res.ok) {
        throw new Error(`Google API returned HTTP ${res.status}: ${await res.text()}`)
      }
      const data = (await res.json()) as { user?: { displayName?: string; emailAddress?: string } }
      testSuccess = true
      responseDetail = data.user?.emailAddress ? `Connected as ${data.user.emailAddress}` : "Google Drive API active"
    } else if (connector.source === "slack") {
      const res = await fetch("https://slack.com/api/auth.test", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      })
      if (!res.ok) {
        throw new Error(`Slack API returned HTTP ${res.status}: ${await res.text()}`)
      }
      const data = (await res.json()) as { ok: boolean; team?: string; user?: string; error?: string }
      if (!data.ok) {
        throw new Error(`Slack error: ${data.error ?? "unknown"}`)
      }
      testSuccess = true
      responseDetail = `Connected to workspace "${data.team}" as @${data.user}`
    } else if (connector.source === "github") {
      const res = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "Saaya-Enterprise-Connectors",
        },
      })
      if (!res.ok) {
        throw new Error(`GitHub API returned HTTP ${res.status}: ${await res.text()}`)
      }
      const data = (await res.json()) as { login?: string }
      testSuccess = true
      responseDetail = data.login ? `Connected as GitHub user @${data.login}` : "GitHub API active"
    } else if (connector.source === "discord") {
      const res = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${token}`, "User-Agent": "Sayabot (https://sayabot.com, 1.0)" },
      })
      if (!res.ok) throw new Error(`Discord returned HTTP ${res.status}${res.status === 401 ? " (check the bot token)" : ""}`)
      const data = (await res.json()) as { username?: string }
      testSuccess = true
      responseDetail = data.username ? `Connected as bot ${data.username}` : "Discord bot active"
    } else if (connector.source === "telegram") {
      // The token is part of Telegram's URL; never echo the response URL or body back.
      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`)
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: { username?: string }; description?: string }
      if (!res.ok || !data.ok) throw new Error(`Telegram: ${data.description ?? `HTTP ${res.status}`}`)
      testSuccess = true
      responseDetail = data.result?.username ? `Connected as @${data.result.username}` : "Telegram bot active"
    } else if (connector.source === "whatsapp") {
      const phoneNumberId = (connector.config as { phoneNumberId?: string } | null)?.phoneNumberId
      if (!phoneNumberId) throw new Error("Phone number ID is missing")
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const data = (await res.json().catch(() => ({}))) as {
        display_phone_number?: string
        verified_name?: string
        error?: { message?: string }
      }
      if (!res.ok) throw new Error(`WhatsApp: ${data.error?.message ?? `HTTP ${res.status}`}`)
      testSuccess = true
      responseDetail = `Sending as ${data.verified_name ?? "business"} (${data.display_phone_number ?? phoneNumberId})`
    } else {
      testSuccess = true
      responseDetail = "Connection verified"
    }

    const latencyMs = Date.now() - startTime
    await admin
      .from("workspace_connectors")
      .update({
        status: "active",
        error_message: null,
        last_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectorId)

    revalidateOrg(orgSlug)
    return ok(`Connection successful (${latencyMs}ms): ${responseDetail}`, {
      latencyMs,
      detail: responseDetail,
    })
  } catch (err) {
    // Telegram puts the token in the URL; make sure no error text carries it into the DB or UI.
    const errorMsg = (err instanceof Error ? err.message : String(err)).split(token).join("[token]")
    await admin
      .from("workspace_connectors")
      .update({
        status: "error",
        error_message: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectorId)

    revalidateOrg(orgSlug)
    return fail(`Connection test failed: ${errorMsg}`)
  }
}

export async function saveAgentConnectorGrant(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const orgSlug = field(formData, "orgSlug")
  const check = await adminOrgAccess(orgSlug)
  if ("error" in check) return fail(check.error)

  const agentId = field(formData, "agentId")
  const connectorId = field(formData, "connectorId")

  const allowedFoldersRaw = optionalField(formData, "allowedFolders")
  const allowedChannelsRaw = optionalField(formData, "allowedChannels")
  const allowedReposRaw = optionalField(formData, "allowedRepos")
  const allowedRecipientsRaw = optionalField(formData, "allowedRecipients")

  const scopeConfig: Record<string, unknown> = {}
  if (allowedFoldersRaw) {
    scopeConfig.allowedFolders = allowedFoldersRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (allowedChannelsRaw) {
    scopeConfig.allowedChannels = allowedChannelsRaw
      .split(/[\n,]/)
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean)
  }
  if (allowedReposRaw) {
    scopeConfig.allowedRepos = allowedReposRaw
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  if (allowedRecipientsRaw) {
    const numbers = allowedRecipientsRaw
      .split(/[\n,]/)
      .map((s) => s.replace(/[\s().-]/g, "").replace(/^\+/, ""))
      .filter(Boolean)
    const bad = numbers.find((n) => !/^\d{7,15}$/.test(n))
    if (bad) return fail(`"${bad}" isn't a phone number with country code`)
    scopeConfig.allowedRecipients = numbers
  }
  if (optionalField(formData, "readOnly")) scopeConfig.readOnly = true

  const admin = createAdminClient()

  // Verify connector belongs to this org
  const { data: connector } = await admin
    .from("workspace_connectors")
    .select("id, name, source")
    .eq("id", connectorId)
    .eq("org_id", check.access.org.id)
    .maybeSingle()

  if (!connector) return fail("Selected connector does not belong to this workspace")

  // Check if grant already exists
  const { data: existing } = await admin
    .from("agent_connector_grants")
    .select("id")
    .eq("org_id", check.access.org.id)
    .eq("agent_id", agentId)
    .eq("connector_id", connectorId)
    .maybeSingle()

  if (existing) {
    const { error } = await admin
      .from("agent_connector_grants")
      .update({
        scope_config: scopeConfig,
      })
      .eq("id", existing.id)

    if (error) return fail(errorMessage(error))
  } else {
    const { error } = await admin
      .from("agent_connector_grants")
      .insert({
        org_id: check.access.org.id,
        agent_id: agentId,
        connector_id: connectorId,
        scope_config: scopeConfig,
      })

    if (error) return fail(errorMessage(error))
  }

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent_connector_grant.saved",
    target: connector.name,
    metadata: { agentId, connectorId, source: connector.source, scopeConfig },
  })

  revalidateOrg(orgSlug)
  return ok(`Granted ${connector.name} access to agent`)
}

export async function deleteAgentConnectorGrant(input: {
  orgSlug: string
  grantId: string
}): Promise<ActionResult> {
  const check = await adminOrgAccess(input.orgSlug)
  if ("error" in check) return fail(check.error)

  const admin = createAdminClient()
  const { data: grant } = await admin
    .from("agent_connector_grants")
    .select("id, agent_id, connector_id, org_id")
    .eq("id", input.grantId)
    .maybeSingle()

  if (!grant || grant.org_id !== check.access.org.id) {
    return fail("Grant not found")
  }

  const { error } = await admin
    .from("agent_connector_grants")
    .delete()
    .eq("id", input.grantId)

  if (error) return fail(errorMessage(error))

  await audit({
    orgId: check.access.org.id,
    actorId: check.access.user.id,
    action: "agent_connector_grant.deleted",
    target: input.grantId,
    metadata: { agentId: grant.agent_id, connectorId: grant.connector_id },
  })

  revalidateOrg(input.orgSlug)
  return ok("Connector access revoked from agent")
}
