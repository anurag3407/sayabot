import { generateCodeChallenge, generateCodeVerifier } from "./pkce"

export const OPENAI_OAUTH_ISSUER = "https://auth.openai.com"
export const OPENAI_RESOURCE = "https://api.openai.com/v1"
export const OPENAI_DIRECT_SCOPE = "chatgpt.tokens.use.direct"
export const OPENAI_SCOPES = `openid profile email offline_access resource.invoke ${OPENAI_DIRECT_SCOPE}`

export interface ChatGptCredentials {
  accessToken: string
  refreshToken: string
  idToken?: string
  expiresAt: number
  email?: string
  plan: "chatgpt_plus" | "chatgpt_pro" | "chatgpt_team" | "free"
}

export async function buildChatGptPlanAuthUrl(callbackUrl: string, hostId = "saaya-bot"): Promise<{
  authUrl: string
  codeVerifier: string
  state: string
}> {
  const codeVerifier = generateCodeVerifier(64)
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateCodeVerifier(32)

  const url = new URL(`${OPENAI_OAUTH_ISSUER}/api/accounts/authorize`)
  url.searchParams.set("client_id", "dynamic_agent_client")
  url.searchParams.set("ext_agent_host_id", `urn:uuid:${hostId}`)
  url.searchParams.set("agent_name_hint", "saayabot")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", callbackUrl)
  url.searchParams.set("scope", OPENAI_SCOPES)
  url.searchParams.set("resource", OPENAI_RESOURCE)
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", codeChallenge)
  url.searchParams.set("code_challenge_method", "S256")

  return {
    authUrl: url.toString(),
    codeVerifier,
    state,
  }
}

export async function exchangeChatGptPlanCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<ChatGptCredentials> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: "dynamic_agent_client",
    code_verifier: codeVerifier,
  })

  const response = await fetch(`${OPENAI_OAUTH_ISSUER}/api/accounts/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => "")
    throw new Error(`ChatGPT plan authentication failed (${response.status}): ${errorText}`)
  }

  const data = (await response.json()) as {
    access_token: string
    refresh_token?: string
    id_token?: string
    expires_in: number
    scope?: string
  }

  let email: string | undefined
  let plan: ChatGptCredentials["plan"] = "chatgpt_plus"

  if (data.id_token) {
    try {
      const parts = data.id_token.split(".")
      if (parts[1]) {
        const decoded = JSON.parse(atob(parts[1])) as { email?: string; plan?: string }
        email = decoded.email
        if (decoded.plan?.includes("pro")) plan = "chatgpt_pro"
        else if (decoded.plan?.includes("team")) plan = "chatgpt_team"
      }
    } catch {
      // Ignore decoding errors
    }
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    idToken: data.id_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email,
    plan,
  }
}

