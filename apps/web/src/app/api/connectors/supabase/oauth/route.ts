import { NextResponse } from "next/server"
import { getOrgAccess, isOrgAdmin } from "@/lib/auth"
import { requireRouteUser } from "@/lib/route-auth"
import { getPublicOrigin } from "@/lib/public-origin"
import { createAdminClient } from "@/lib/supabase/admin"
import { encryptSecret, last4 } from "@sayabot/llm"
import { getKek } from "@/lib/env"
import {
  buildSupabaseOAuthUrl,
  ensureSupabaseBucket,
  exchangeSupabaseOAuthCode,
  getSupabaseProjectApiKeys,
  listSupabaseProjects,
} from "@/lib/connectors/supabase"

const STATE_COOKIE = "supabase_oauth_state"
const ORG_COOKIE = "supabase_oauth_org"

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
 * Initiates Supabase OAuth for a workspace.
 */
export async function GET(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response
  const slug = new URL(request.url).searchParams.get("org")?.trim()
  if (slug && !(await adminAccess(slug, auth))) {
    return NextResponse.json(
      { error: "Only workspace admins can connect cloud storage accounts" },
      { status: 403 },
    )
  }

  try {
    const origin = getPublicOrigin(request)
    const state = Math.random().toString(36).substring(2) + Date.now().toString(36)
    const { authUrl } = buildSupabaseOAuthUrl(`${origin}/oauth/callback/supabase`, state)
    const response = NextResponse.json({ authUrl })
    const cookie = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: 60 * 15,
      path: "/",
    }
    response.cookies.set(STATE_COOKIE, state, cookie)
    if (slug) response.cookies.set(ORG_COOKIE, slug, cookie)
    return response
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to generate Supabase authorization URL",
      },
      { status: 500 },
    )
  }
}

/**
 * Exchanges authorization code, fetches projects, auto-provisions sayabot-storage bucket,
 * and saves as an active workspace connector.
 */
export async function POST(request: Request) {
  const auth = await requireRouteUser()
  if ("response" in auth) return auth.response

  try {
    const body = (await request.json().catch(() => ({}))) as {
      code?: string
      state?: string
      org?: string
    }
    const code = body.code
    const _state = body.state || readCookie(request, STATE_COOKIE)
    if (!code) {
      return NextResponse.json({ error: "Missing authorization code" }, { status: 400 })
    }

    const orgSlug = body.org || readCookie(request, ORG_COOKIE)
    const access = await adminAccess(orgSlug, auth)
    if (!access) {
      return NextResponse.json(
        { error: "Start the connection again from Storage in workspace settings" },
        { status: 403 },
      )
    }

    const origin = getPublicOrigin(request)
    const tokens = await exchangeSupabaseOAuthCode(code, `${origin}/oauth/callback/supabase`)
    const projects = await listSupabaseProjects(tokens.access_token)
    if (!projects || projects.length === 0) {
      return NextResponse.json(
        { error: "No projects found in your Supabase account" },
        { status: 400 },
      )
    }

    const defaultProject = projects[0]
    if (!defaultProject) {
      return NextResponse.json(
        { error: "No projects found in your Supabase account" },
        { status: 400 },
      )
    }
    if (!defaultProject) {
      return NextResponse.json(
        { error: "No projects found in your Supabase account" },
        { status: 400 },
      )
    }
    const keys = await getSupabaseProjectApiKeys(defaultProject.id, tokens.access_token)
    const serviceKey = keys.find((k) => k.name === "service_role")?.api_key || keys[0]?.api_key
    if (!serviceKey) {
      return NextResponse.json(
        { error: "Could not find API key for the selected project" },
        { status: 400 },
      )
    }

    const projectUrl = `https://${defaultProject.id}.supabase.co`
    const bucketName = "sayabot-storage"

    // Ensure bucket exists in user's project
    await ensureSupabaseBucket(projectUrl, serviceKey, bucketName).catch(() => null)

    // Save connector in workspace_connectors
    const admin = createAdminClient()
    const encrypted = encryptSecret(serviceKey, getKek())
    const config = {
      projectRef: defaultProject.id,
      projectName: defaultProject.name,
      projectUrl,
      bucket: bucketName,
      authMode: "oauth",
    }

    // Check if an existing supabase connector exists for this org
    const { data: existing } = await admin
      .from("workspace_connectors")
      .select("id")
      .eq("org_id", access.org.id)
      .eq("source", "supabase")
      .maybeSingle()

    let connectorId: string
    if (existing) {
      await admin
        .from("workspace_connectors")
        .update({
          name: `Supabase Storage (${defaultProject.name})`,
          status: "active",
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          tag: encrypted.tag,
          last4: last4(serviceKey),
          config,
          error_message: null,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
      connectorId = existing.id
    } else {
      const { data: created, error: insertError } = await admin
        .from("workspace_connectors")
        .insert({
          org_id: access.org.id,
          owner_user_id: auth.user.id,
          source: "supabase",
          name: `Supabase Storage (${defaultProject.name})`,
          status: "active",
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          tag: encrypted.tag,
          last4: last4(serviceKey),
          config,
          last_synced_at: new Date().toISOString(),
        })
        .select("id")
        .single()

      if (insertError) {
        throw new Error(`Failed to save connector: ${insertError.message}`)
      }
      connectorId = created.id
    }

    return NextResponse.json({
      ok: true,
      connectorId,
      projectName: defaultProject.name,
      projectUrl,
      bucket: bucketName,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to connect Supabase" },
      { status: 500 },
    )
  }
}
