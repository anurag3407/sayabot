export const SUPABASE_OAUTH_AUTH_URL = "https://api.supabase.com/v1/oauth/authorize"
export const SUPABASE_OAUTH_TOKEN_URL = "https://api.supabase.com/v1/oauth/token"
export const SUPABASE_MGMT_API_BASE = "https://api.supabase.com/v1"

export interface SupabaseOAuthTokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

export interface SupabaseProject {
  id: string
  name: string
  organization_id: string
  region: string
  created_at: string
  status: string
}

export interface SupabaseApiKey {
  name: string
  api_key: string
}

export function buildSupabaseOAuthUrl(redirectUri: string, state: string): { authUrl: string } {
  const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID
  if (!clientId) {
    throw new Error("SUPABASE_OAUTH_CLIENT_ID is not configured in environment")
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "all",
    state,
  })

  return {
    authUrl: `${SUPABASE_OAUTH_AUTH_URL}?${params.toString()}`,
  }
}

export async function exchangeSupabaseOAuthCode(
  code: string,
  redirectUri: string,
): Promise<SupabaseOAuthTokens> {
  const clientId = process.env.SUPABASE_OAUTH_CLIENT_ID
  const clientSecret = process.env.SUPABASE_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("SUPABASE_OAUTH_CLIENT_ID or SUPABASE_OAUTH_CLIENT_SECRET is missing")
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64")
  const res = await fetch(SUPABASE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Supabase OAuth token exchange failed (${res.status}): ${errorText.slice(0, 150)}`)
  }

  return (await res.json()) as SupabaseOAuthTokens
}

export async function listSupabaseProjects(accessToken: string): Promise<SupabaseProject[]> {
  const res = await fetch(`${SUPABASE_MGMT_API_BASE}/projects`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Failed to list Supabase projects (${res.status}): ${errorText.slice(0, 150)}`)
  }

  return (await res.json()) as SupabaseProject[]
}

export async function getSupabaseProjectApiKeys(
  projectRef: string,
  accessToken: string,
): Promise<SupabaseApiKey[]> {
  const res = await fetch(`${SUPABASE_MGMT_API_BASE}/projects/${projectRef}/api-keys`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Failed to retrieve Supabase API keys (${res.status}): ${errorText.slice(0, 150)}`)
  }

  return (await res.json()) as SupabaseApiKey[]
}

/**
 * Ensures that a storage bucket (default "sayabot-storage") exists in the target Supabase project.
 */
export async function ensureSupabaseBucket(
  projectUrl: string,
  apiKey: string,
  bucketName = "sayabot-storage",
): Promise<{ ok: boolean; name: string }> {
  const normalizedUrl = projectUrl.replace(/\/+$/, "")
  // 1. Check if bucket exists
  const checkRes = await fetch(`${normalizedUrl}/storage/v1/bucket/${bucketName}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
    },
  })

  if (checkRes.ok) {
    return { ok: true, name: bucketName }
  }

  // 2. Create if not exists
  const createRes = await fetch(`${normalizedUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      id: bucketName,
      name: bucketName,
      public: false,
    }),
  })

  if (!createRes.ok && createRes.status !== 409) {
    const text = await createRes.text()
    throw new Error(`Failed to create bucket "${bucketName}" (${createRes.status}): ${text.slice(0, 120)}`)
  }

  return { ok: true, name: bucketName }
}
