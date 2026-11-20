/**
 * Returns a same-origin relative path or the fallback. Browsers normalize a
 * backslash to a slash, so `/\evil.com` must be rejected alongside `//evil.com`.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/"): string {
  if (!value) return fallback
  if (!value.startsWith("/")) return fallback
  if (value.startsWith("//")) return fallback
  if (value.includes("\\")) return fallback
  for (const char of value) {
    const code = char.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return fallback
  }
  return value
}
