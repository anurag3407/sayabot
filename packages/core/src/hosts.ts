/**
 * Host validation for Secret Broker grants.
 *
 * Rules:
 * - Must be a valid hostname or wildcard pattern (e.g. "api.github.com" or "*.github.com")
 * - Wildcards are only allowed as a prefix: "*.domain.tld" (at least 2 domain segments after *.)
 * - Never allow "*" alone or wildcard without dot (e.g. "*domain.com" is invalid)
 * - Never allow IP addresses (IPv4 or IPv6)
 * - Never allow private/local TLDs (.local, .internal, .localhost, .test, .example) unless allowInternal is true
 * - No protocol schemes, paths, ports or credentials
 */
export function isValidHostPattern(
  pattern: string,
  options?: { allowInternal?: boolean },
): boolean {
  if (!pattern || typeof pattern !== "string") return false
  const trimmed = pattern.trim().toLowerCase()
  if (
    !trimmed ||
    trimmed === "*" ||
    trimmed.includes("/") ||
    trimmed.includes(":") ||
    trimmed.includes("@")
  ) {
    return false
  }

  // Reject IP literals (v4: 4 octets; v6: contains colon, already checked above)
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    return false
  }

  let hostToCheck = trimmed
  if (trimmed.startsWith("*.")) {
    hostToCheck = trimmed.slice(2)
    // After "*.", must have at least one dot separating domain and TLD, e.g. "github.com"
    if (!hostToCheck.includes(".")) {
      return false
    }
  } else if (trimmed.includes("*")) {
    // Wildcards are only allowed as "*." at the very beginning
    return false
  }

  // Check valid hostname segments: RFC 1123
  const labels = hostToCheck.split(".")
  if (labels.length < 2) {
    return false
  }

  const labelRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
  for (const label of labels) {
    if (!labelRegex.test(label)) {
      return false
    }
  }

  const tld = labels[labels.length - 1]
  if (!tld) return false
  const disallowedTlds = ["local", "internal", "localhost", "test", "example", "invalid", "lan"]
  if (!options?.allowInternal && disallowedTlds.includes(tld)) {
    return false
  }

  return true
}

/**
 * Check whether a requested host matches an allowed host pattern.
 */
export function matchesHostPattern(requestedHost: string, allowedPattern: string): boolean {
  if (!requestedHost || !allowedPattern) return false
  const req = requestedHost.toLowerCase().trim()
  const pattern = allowedPattern.toLowerCase().trim()

  if (pattern.startsWith("*.")) {
    const root = pattern.slice(2)
    return req === root || req.endsWith("." + root)
  }

  return req === pattern
}
