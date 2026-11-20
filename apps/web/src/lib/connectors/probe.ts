/**
 * Probes one saved workspace connector against its vendor and returns a human-readable detail
 * line ("Connected as @octocat", "Connected to bucket …"). The settings "Check connection"
 * action calls this with the decrypted token; it performs no database work and never returns the
 * token, so failures can be scrubbed and stored as-is.
 *
 * `bases` overrides vendor origins. Production never passes it; the integration suite points a
 * source at a local stub HTTP server to drive the real probe code without touching the internet.
 */

import { S3Client, HeadBucketCommand, ListObjectsV2Command } from "@aws-sdk/client-s3"

export interface ConnectorProbeBases {
  google_drive?: string
  slack?: string
  github?: string
  discord?: string
  telegram?: string
  whatsapp?: string
  bitwarden?: string
  huggingface?: string
  composio?: string
}

export interface ConnectorProbeArgs {
  source: string
  token: string
  config: Record<string, unknown>
  bases?: ConnectorProbeBases
}

function origin(base: string | undefined, fallback: string): string {
  return (base ?? fallback).replace(/\/+$/, "")
}

/** Runs the vendor's cheapest authenticated call. Returns a detail line or throws. */
export async function probeConnector(args: ConnectorProbeArgs): Promise<string> {
  const { source, token } = args
  const config = args.config as {
    domain?: string
    defaultChannel?: string
    defaultOrg?: string
    guildId?: string
    phoneNumberId?: string
    authMode?: string
    connectUrl?: string
    region?: string
    projectUrl?: string
    bucket?: string
    endpoint?: string
    accountId?: string
    accessKeyId?: string
    keyId?: string
    repoId?: string
    baseUrl?: string
  }
  const bases = args.bases ?? {}

  if (source === "google_drive") {
    const res = await fetch(
      `${origin(bases.google_drive, "https://www.googleapis.com")}/drive/v3/about?fields=user`,
      {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      },
    )
    if (!res.ok) throw new Error(`Google API returned HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { user?: { displayName?: string; emailAddress?: string } }
    return data.user?.emailAddress
      ? `Connected as ${data.user.emailAddress}`
      : "Google Drive API active"
  }

  if (source === "slack") {
    const res = await fetch(`${origin(bases.slack, "https://slack.com")}/api/auth.test`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    })
    if (!res.ok) throw new Error(`Slack API returned HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { ok: boolean; team?: string; user?: string; error?: string }
    if (!data.ok) throw new Error(`Slack error: ${data.error ?? "unknown"}`)
    return `Connected to workspace "${data.team}" as @${data.user}`
  }

  if (source === "github") {
    const res = await fetch(`${origin(bases.github, "https://api.github.com")}/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "Saaya-Enterprise-Connectors",
      },
    })
    if (!res.ok) throw new Error(`GitHub API returned HTTP ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as { login?: string }
    return data.login ? `Connected as GitHub user @${data.login}` : "GitHub API active"
  }

  if (source === "discord") {
    const res = await fetch(`${origin(bases.discord, "https://discord.com/api/v10")}/users/@me`, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "Sayabot (https://sayabot.com, 1.0)",
      },
    })
    if (!res.ok) {
      throw new Error(
        `Discord returned HTTP ${res.status}${res.status === 401 ? " (check the bot token)" : ""}`,
      )
    }
    const data = (await res.json()) as { username?: string }
    return data.username ? `Connected as bot ${data.username}` : "Discord bot active"
  }

  if (source === "telegram") {
    // The token is part of Telegram's URL; never echo the response URL or body back.
    const res = await fetch(
      `${origin(bases.telegram, "https://api.telegram.org")}/bot${token}/getMe`,
    )
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      result?: { username?: string }
      description?: string
    }
    if (!res.ok || !data.ok)
      throw new Error(`Telegram: ${data.description ?? `HTTP ${res.status}`}`)
    return data.result?.username ? `Connected as @${data.result.username}` : "Telegram bot active"
  }

  if (source === "onepassword" || source === "bitwarden" || source === "protonpass") {
    if (config.authMode === "computer" || token === "desktop") {
      return "Saved for the app signed in on a computer with Sayabot open"
    }
    if (source === "onepassword" && config.connectUrl) {
      const res = await fetch(`${config.connectUrl.replace(/\/+$/, "")}/v1/vaults`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`1Password Connect returned HTTP ${res.status}`)
      return "1Password Connect answered"
    }
    if (source === "bitwarden") {
      const host =
        bases.bitwarden?.replace(/\/+$/, "") ??
        (config.region === "eu" ? "https://api.bitwarden.eu" : "https://api.bitwarden.com")
      const res = await fetch(`${host}/public/secrets`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error(`Bitwarden returned HTTP ${res.status}`)
      return "Bitwarden Secrets Manager answered"
    }
    return "Saved. It will run through the app on your computer."
  }

  if (source === "whatsapp") {
    const phoneNumberId = config.phoneNumberId
    if (!phoneNumberId) throw new Error("Phone number ID is missing")
    const res = await fetch(
      `${origin(bases.whatsapp, "https://graph.facebook.com/v21.0")}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const data = (await res.json().catch(() => ({}))) as {
      display_phone_number?: string
      verified_name?: string
      error?: { message?: string }
    }
    if (!res.ok) throw new Error(`WhatsApp: ${data.error?.message ?? `HTTP ${res.status}`}`)
    return `Sending as ${data.verified_name ?? "business"} (${data.display_phone_number ?? phoneNumberId})`
  }

  if (source === "supabase") {
    const projectUrl = (config.projectUrl || "").replace(/\/+$/, "")
    const bucket = config.bucket || "sayabot-storage"
    if (!projectUrl) throw new Error("Supabase Project URL is missing")
    const res = await fetch(`${projectUrl}/storage/v1/bucket`, {
      headers: { Authorization: `Bearer ${token}`, apikey: token },
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Supabase Storage returned HTTP ${res.status}: ${err.slice(0, 100)}`)
    }
    return `Connected to Supabase bucket "${bucket}" (1 GB Free)`
  }

  if (source === "cloudflare_r2" || source === "backblaze_b2" || source === "s3_storage") {
    const rawEndpoint =
      config.endpoint ||
      (config.accountId ? `https://${config.accountId}.r2.cloudflarestorage.com` : undefined)
    const endpoint = rawEndpoint?.startsWith("http")
      ? rawEndpoint
      : rawEndpoint
        ? `https://${rawEndpoint}`
        : undefined
    const accessKeyId = config.accessKeyId || config.keyId
    const bucket = config.bucket
    if (!bucket) throw new Error("Bucket name is required")
    if (!accessKeyId) throw new Error("Access Key ID / Key ID is required")

    // MinIO, most self-hosted S3 gateways and every loopback test endpoint only answer
    // path-style requests; R2/B2's real endpoints are HTTPS and virtual-host natively.
    const localEndpoint =
      endpoint !== undefined &&
      /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/.test(endpoint)
    const s3 = new S3Client({
      endpoint,
      region: config.region || "auto",
      ...(source === "s3_storage" || localEndpoint ? { forcePathStyle: true } : {}),
      credentials: { accessKeyId, secretAccessKey: token },
    })

    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }))
    } catch {
      await s3.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 1 }))
    }

    const label =
      source === "cloudflare_r2"
        ? "Cloudflare R2 (10 GB Free, $0 Egress)"
        : source === "backblaze_b2"
          ? "Backblaze B2 (10 GB Free)"
          : "S3 Storage"
    return `Connected to bucket "${bucket}" on ${label}`
  }

  if (source === "huggingface") {
    const res = await fetch(
      `${origin(bases.huggingface, "https://huggingface.co")}/api/whoami-v2`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    )
    if (!res.ok) throw new Error(`Hugging Face API returned HTTP ${res.status}`)
    const data = (await res.json().catch(() => ({}))) as { name?: string }
    return `Connected to Hugging Face as @${data.name ?? "user"}${config.repoId ? ` (${config.repoId})` : ""}`
  }

  if (source === "composio") {
    const base = origin(bases.composio ?? config.baseUrl, "https://backend.composio.dev/api/v3")
    const res = await fetch(`${base}/toolkits?limit=1`, {
      headers: { "x-api-key": token, Accept: "application/json" },
    })
    if (!res.ok) {
      throw new Error(
        `Composio API returned HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`,
      )
    }
    const data = (await res.json().catch(() => ({}))) as { total_items?: number; items?: unknown[] }
    const total = data.total_items ?? (Array.isArray(data.items) ? data.items.length : 0)
    return total > 0 ? `Connected to Composio (${total}+ apps available)` : "Connected to Composio"
  }

  return "Connection verified"
}
