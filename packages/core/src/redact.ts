const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai_key", re: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { name: "github_token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g },
  { name: "github_pat", re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: "slack_token", re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { name: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: "groq_key", re: /\bgsk_[A-Za-z0-9]{40,}\b/g },
  { name: "mesh_agent_key", re: /\b(?:mesh_ak_|saaya_ak_|sayabot_ak_)[A-Za-z0-9_-]{20,}\b/g },
  { name: "oauth_access_token", re: /\b(?:mesh_at_|sayabot_at_)[A-Za-z0-9_-]{20,}\b/g },
  { name: "oauth_refresh_token", re: /\b(?:mesh_rt_|sayabot_rt_)[A-Za-z0-9_-]{20,}\b/g },
  { name: "invite_code", re: /\bsinv_[A-Za-z0-9_-]{20,}\b/g },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    name: "private_key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
]

export const PLACEHOLDER_PATTERN = /\bsaaya_ph_[A-Za-z0-9_-]{24,}\b/g

export interface RedactionResult {
  text: string
  redactions: { name: string; count: number }[]
}

/** Replaces secret-looking substrings with `[REDACTED:<kind>]`. */
export function redactSecrets(
  input: string,
  options?: { redactPlaceholders?: boolean },
): RedactionResult {
  let text = input
  const redactions: RedactionResult["redactions"] = []

  for (const { name, re } of PATTERNS) {
    let count = 0
    text = text.replace(re, () => {
      count++
      return `[REDACTED:${name}]`
    })
    if (count) redactions.push({ name, count })
  }

  if (options?.redactPlaceholders) {
    let count = 0
    text = text.replace(PLACEHOLDER_PATTERN, () => {
      count++
      return "[REDACTED:placeholder]"
    })
    if (count) redactions.push({ name: "placeholder", count })
  }

  return { text, redactions }
}

/**
 * Creates a per-run exact-value scrubber that replaces real secrets
 * and their base64 / URL-encoded variants with `[REDACTED:secret]`.
 */
export function createRunScrubber(values: string[]): (text: string) => string {
  const targets = new Set<string>()

  for (const val of values) {
    if (!val || typeof val !== "string" || val.length < 6) continue
    targets.add(val)

    // URL-encoded variant
    const urlEncoded = encodeURIComponent(val)
    if (urlEncoded !== val) {
      targets.add(urlEncoded)
    }

    // Base64 variant
    try {
      const b64 = Buffer.from(val, "utf8").toString("base64")
      if (b64.length >= 8) {
        targets.add(b64)
      }
    } catch {
      // ignore
    }
  }

  if (targets.size === 0) {
    return (t: string) => t
  }

  // Sort longest first so substrings don't preempt longer tokens
  const sorted = Array.from(targets).sort((a, b) => b.length - a.length)
  const escaped = sorted.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const regex = new RegExp(escaped.join("|"), "g")

  return (text: string): string => {
    if (!text || typeof text !== "string") return text
    return text.replace(regex, "[REDACTED:secret]")
  }
}
