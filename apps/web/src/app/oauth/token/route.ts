import { createAdminClient } from "@/lib/supabase/admin"
import { hashAgentApiKey } from "@sayabot/core/server"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { type NextRequest, NextResponse } from "next/server"

function base64Url(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function verifyPkce(verifier: string, challenge: string): boolean {
  const computed = Buffer.from(base64Url(createHash("sha256").update(verifier).digest()))
  const expected = Buffer.from(challenge)
  return computed.length === expected.length && timingSafeEqual(computed, expected)
}

export async function POST(req: NextRequest) {
  let body: Record<string, string> = {}

  const contentType = req.headers.get("content-type") || ""
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await req.formData().catch(() => null)
    if (formData) {
      for (const [key, value] of formData.entries()) {
        if (typeof value === "string") body[key] = value
      }
    }
  } else {
    body = (await req.json().catch(() => ({}))) as Record<string, string>
  }

  const { grant_type, code, redirect_uri, client_id, code_verifier, refresh_token } = body
  const admin = createAdminClient()
  const now = new Date()

  if (grant_type === "authorization_code") {
    if (!code || !code_verifier || !client_id) {
      return NextResponse.json(
        {
          error: "invalid_request",
          error_description: "Missing code, code_verifier, or client_id",
        },
        { status: 400 },
      )
    }

    const codeHash = hashAgentApiKey(code)

    const { data: codeRow, error } = await admin
      .from("oauth_codes")
      .select("*")
      .eq("code_hash", codeHash)
      .eq("client_id", client_id)
      .is("used_at", null)
      .gt("expires_at", now.toISOString())
      .maybeSingle()

    if (error || !codeRow) {
      return NextResponse.json(
        {
          error: "invalid_grant",
          error_description: "Authorization code invalid, expired, or already used",
        },
        { status: 400 },
      )
    }

    // RFC 6749 4.1.3: the redirect_uri must match the one the code was issued for.
    if (!redirect_uri || redirect_uri !== codeRow.redirect_uri) {
      return NextResponse.json(
        {
          error: "invalid_grant",
          error_description: "redirect_uri does not match the authorization request",
        },
        { status: 400 },
      )
    }

    // Verify PKCE
    if (!verifyPkce(code_verifier, codeRow.code_challenge)) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "PKCE verification failed" },
        { status: 400 },
      )
    }

    // Claim the code atomically so two concurrent requests cannot both redeem it.
    const { data: claimed } = await admin
      .from("oauth_codes")
      .update({ used_at: now.toISOString() })
      .eq("id", codeRow.id)
      .is("used_at", null)
      .select("id")
    if (!claimed || claimed.length === 0) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Authorization code already used" },
        { status: 400 },
      )
    }

    // Issue tokens
    const accessToken = `mesh_at_${randomBytes(24).toString("hex")}`
    const refreshToken = `mesh_rt_${randomBytes(24).toString("hex")}`
    const accessHash = hashAgentApiKey(accessToken)
    const refreshHash = hashAgentApiKey(refreshToken)

    const accessExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString()
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()

    // Store access token
    await admin.from("oauth_tokens").insert({
      kind: "access",
      token_hash: accessHash,
      client_id,
      agent_id: codeRow.agent_id,
      scopes: codeRow.scopes,
      expires_at: accessExpiresAt,
    })

    // Store refresh token
    await admin.from("oauth_tokens").insert({
      kind: "refresh",
      token_hash: refreshHash,
      client_id,
      agent_id: codeRow.agent_id,
      scopes: codeRow.scopes,
      expires_at: refreshExpiresAt,
    })

    return NextResponse.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: codeRow.scopes.join(" "),
    })
  }

  if (grant_type === "refresh_token") {
    if (!refresh_token || !client_id) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "Missing refresh_token or client_id" },
        { status: 400 },
      )
    }

    const refreshHash = hashAgentApiKey(refresh_token)

    const { data: tokenRow } = await admin
      .from("oauth_tokens")
      .select("*")
      .eq("token_hash", refreshHash)
      .eq("kind", "refresh")
      .eq("client_id", client_id)
      .maybeSingle()

    if (!tokenRow) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Refresh token not found" },
        { status: 400 },
      )
    }

    if (tokenRow.revoked_at) {
      // Re-use detected! Revoke the entire family
      await admin
        .from("oauth_tokens")
        .update({ revoked_at: now.toISOString() })
        .eq("agent_id", tokenRow.agent_id)

      return NextResponse.json(
        { error: "invalid_grant", error_description: "Refresh token was already used and revoked" },
        { status: 400 },
      )
    }

    if (new Date(tokenRow.expires_at) <= now) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Refresh token expired" },
        { status: 400 },
      )
    }

    // Revoke the old refresh token; losing this race means another request already rotated it.
    const { data: rotated } = await admin
      .from("oauth_tokens")
      .update({ revoked_at: now.toISOString() })
      .eq("id", tokenRow.id)
      .is("revoked_at", null)
      .select("id")
    if (!rotated || rotated.length === 0) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Refresh token was already used" },
        { status: 400 },
      )
    }

    // Issue new pair
    const newAccessToken = `mesh_at_${randomBytes(24).toString("hex")}`
    const newRefreshToken = `mesh_rt_${randomBytes(24).toString("hex")}`
    const newAccessHash = hashAgentApiKey(newAccessToken)
    const newRefreshHash = hashAgentApiKey(newRefreshToken)

    const accessExpiresAt = new Date(Date.now() + 3600 * 1000).toISOString()
    const refreshExpiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()

    await admin.from("oauth_tokens").insert({
      kind: "access",
      token_hash: newAccessHash,
      client_id,
      agent_id: tokenRow.agent_id,
      scopes: tokenRow.scopes,
      expires_at: accessExpiresAt,
    })

    await admin.from("oauth_tokens").insert({
      kind: "refresh",
      token_hash: newRefreshHash,
      client_id,
      agent_id: tokenRow.agent_id,
      scopes: tokenRow.scopes,
      expires_at: refreshExpiresAt,
      rotated_from: tokenRow.id,
    })

    return NextResponse.json({
      access_token: newAccessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: newRefreshToken,
      scope: tokenRow.scopes.join(" "),
    })
  }

  return NextResponse.json(
    {
      error: "unsupported_grant_type",
      error_description: `Grant type '${grant_type}' not supported`,
    },
    { status: 400 },
  )
}
