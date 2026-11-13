import { createHash } from "node:crypto"

/**
 * GitHub Copilot through a saved GitHub sign-in. The Copilot chat API does not take the GitHub
 * token itself: each call needs a short-lived Copilot token (about 30 minutes) that GitHub hands
 * out for an account with an active Copilot plan. Sayabot stores only the GitHub token (sealed,
 * like any key) and swaps it for a Copilot token here, just before a call, reusing it until a
 * minute before it expires.
 */

export const COPILOT_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token"
export const COPILOT_API_BASE = "https://api.githubcopilot.com"

/** The client identity Copilot's chat API expects alongside the token. */
export const COPILOT_HEADERS: Readonly<Record<string, string>> = {
  "Copilot-Integration-Id": "vscode-chat",
  "Editor-Version": "vscode/1.96.2",
  "Editor-Plugin-Version": "copilot-chat/0.22.4",
  "User-Agent": "GitHubCopilotChat/0.22.4",
}

const REFRESH_MARGIN_MS = 60_000
const TIMEOUT_MS = 10_000

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
/** The token request only ever passes a URL string. */
type TokenFetch = (url: string, init?: RequestInit) => Promise<Response>

/** By a hash of the GitHub token, so the token itself is never a map key. */
const sessions = new Map<string, { token: string; expiresAt: number }>()
const inflight = new Map<string, Promise<string>>()

/** GitHub OAuth, app and personal tokens. Anything else is passed through as it is. */
export function isGitHubToken(value: string): boolean {
  return /^(gho_|ghu_|ghp_|github_pat_)/.test(value.trim())
}

/** True for a base URL that points at Copilot's chat API. */
export function isCopilotBaseUrl(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false
  try {
    return new URL(baseUrl).hostname.endsWith("githubcopilot.com")
  } catch {
    return false
  }
}

export class CopilotAuthError extends Error {}

/**
 * A Copilot token for a saved GitHub token. Fails with CopilotAuthError when GitHub refuses the
 * token or the account has no Copilot plan; never includes the token in the message.
 */
export async function copilotSessionToken(
  githubToken: string,
  options: { fetch?: TokenFetch; now?: () => number } = {},
): Promise<string> {
  const token = githubToken.trim()
  if (!isGitHubToken(token)) return token
  const now = options.now ?? Date.now
  const key = createHash("sha256").update(token).digest("hex")
  const cached = sessions.get(key)
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > now()) return cached.token
  const running = inflight.get(key)
  if (running) return running
  const request = (async () => {
    const response = await (options.fetch ?? fetch)(COPILOT_TOKEN_URL, {
      headers: { authorization: `token ${token}`, accept: "application/json", ...COPILOT_HEADERS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      sessions.delete(key)
      throw new CopilotAuthError(
        "GitHub did not give a Copilot token for this account. Check that its Copilot plan is active, then connect it again.",
      )
    }
    if (!response.ok) throw new CopilotAuthError(`GitHub answered HTTP ${response.status}`)
    const body = (await response.json().catch(() => null)) as {
      token?: unknown
      expires_at?: unknown
    } | null
    if (!body || typeof body.token !== "string" || !body.token) {
      throw new CopilotAuthError("GitHub sent a Copilot token response without a token")
    }
    const expiresAt =
      typeof body.expires_at === "number" ? body.expires_at * 1000 : now() + 20 * 60_000
    sessions.set(key, { token: body.token, expiresAt })
    return body.token
  })()
  inflight.set(key, request)
  try {
    return await request
  } finally {
    inflight.delete(key)
  }
}

/**
 * A fetch for the AI SDK that signs each Copilot call with a fresh Copilot token and Copilot's
 * client headers, whatever Authorization the SDK set from the saved key.
 */
export function copilotFetch(githubToken: string, baseFetch: FetchLike = fetch): FetchLike {
  return async (input, init) => {
    const token = await copilotSessionToken(githubToken, { fetch: baseFetch })
    const headers = new Headers(init?.headers)
    headers.set("authorization", `Bearer ${token}`)
    for (const [name, value] of Object.entries(COPILOT_HEADERS)) headers.set(name, value)
    return baseFetch(input, { ...init, headers })
  }
}

/** Forgets cached Copilot tokens (tests, or after a key is removed). */
export function clearCopilotSessions(): void {
  sessions.clear()
  inflight.clear()
}
