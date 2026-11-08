import type { DeviceCodeFlow, ModelOption } from "./types"

export const GITHUB_COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe81" // Official Copilot CLI client ID
export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code"
export const GITHUB_ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token"
export const COPILOT_INTERNAL_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token"

export interface CopilotSession {
  githubToken: string
  copilotToken: string
  expiresAt: number
  plan?: "individual" | "business" | "enterprise"
  user?: string
}

export async function startCopilotDeviceFlow(): Promise<DeviceCodeFlow> {
  const response = await fetch(GITHUB_DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_COPILOT_CLIENT_ID,
      scope: "read:user",
    }),
  })

  if (!response.ok) {
    throw new Error(`Failed to initialize Copilot device code flow (${response.status})`)
  }

  const data = (await response.json()) as {
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
  }

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  }
}

export async function pollCopilotDeviceCode(
  deviceCode: string,
): Promise<{ status: "pending" | "slow_down" | "expired" | "denied"; token?: string }> {
  const response = await fetch(GITHUB_ACCESS_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: GITHUB_COPILOT_CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  })

  if (!response.ok) {
    throw new Error(`Polling Copilot device code failed (${response.status})`)
  }

  const data = (await response.json()) as {
    access_token?: string
    error?: string
  }

  if (data.access_token) {
    return { status: "pending", token: data.access_token }
  }

  if (data.error === "authorization_pending") return { status: "pending" }
  if (data.error === "slow_down") return { status: "slow_down" }
  if (data.error === "expired_token") return { status: "expired" }
  if (data.error === "access_denied") return { status: "denied" }

  return { status: "pending" }
}

export async function getCopilotInternalToken(githubToken: string): Promise<CopilotSession> {
  const response = await fetch(COPILOT_INTERNAL_TOKEN_URL, {
    headers: {
      Authorization: `Bearer ${githubToken}`,
      Accept: "application/json",
      "User-Agent": "GitHubCopilotChat/0.22.4",
      "Editor-Version": "vscode/1.96.2",
    },
  })

  if (!response.ok) {
    throw new Error(
      `Could not verify active GitHub Copilot subscription (${response.status}). Ensure you have an active GitHub Copilot plan.`,
    )
  }

  const data = (await response.json()) as {
    token: string
    expires_at: number
    chat_enabled?: boolean
    sku?: string
  }

  return {
    githubToken,
    copilotToken: data.token,
    expiresAt: data.expires_at * 1000,
    plan: data.sku?.includes("business")
      ? "business"
      : data.sku?.includes("enterprise")
        ? "enterprise"
        : "individual",
  }
}

export function getCopilotModels(): ModelOption[] {
  return [
    {
      id: "copilot/auto",
      label: "Auto",
      provider: "copilot",
      providerGroup: "GitHub Copilot",
      route: "Auto",
      supportsTools: true,
      supportsEffort: true,
      multiplier: "1x",
    },
    {
      id: "claude-3.5-sonnet",
      label: "Claude 3.5 Sonnet",
      provider: "copilot",
      providerGroup: "GitHub Copilot",
      route: "1x",
      supportsTools: true,
      supportsEffort: true,
      multiplier: "1x",
      contextWindow: 200000,
    },
    {
      id: "gpt-4o",
      label: "GPT-4o",
      provider: "copilot",
      providerGroup: "GitHub Copilot",
      route: "1x",
      supportsTools: true,
      supportsEffort: false,
      multiplier: "1x",
      contextWindow: 128000,
    },
    {
      id: "claude-3.5-haiku",
      label: "Claude 3.5 Haiku",
      provider: "copilot",
      providerGroup: "GitHub Copilot",
      route: "0.33x",
      supportsTools: true,
      supportsEffort: false,
      multiplier: "0.33x",
      contextWindow: 200000,
    },
    {
      id: "o1-preview",
      label: "o1-preview Reasoning",
      provider: "copilot",
      providerGroup: "GitHub Copilot",
      route: "3x",
      supportsTools: true,
      supportsEffort: true,
      multiplier: "3x",
      contextWindow: 128000,
    },
  ]
}
