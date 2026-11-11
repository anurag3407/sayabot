/**
 * "Add a phone": a short one-time code shown on the computer and typed (or scanned) on the
 * phone. Letters that look alike (0/O, 1/I/L) are left out so codes read aloud cleanly.
 */

export const PAIRING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
export const PAIRING_CODE_LENGTH = 8
export const PAIRING_TTL_MINUTES = 10

/** What the person typed, uppercased, with spaces/dashes dropped and look-alikes folded. */
export function normalizePairingCode(input: string | null | undefined): string {
  return (input ?? "")
    .toUpperCase()
    .replace(/[O]/g, "0")
    .replace(/[IL]/g, "1")
    .replace(/[^0-9A-Z]/g, "")
}

export function isPairingCode(code: string): boolean {
  if (code.length !== PAIRING_CODE_LENGTH) return false
  for (const ch of code) if (!PAIRING_ALPHABET.includes(ch)) return false
  return true
}

/** "ABCD2345" → "ABCD-2345" for display. */
export function formatPairingCode(code: string): string {
  const half = Math.ceil(code.length / 2)
  return code.length > 4 ? `${code.slice(0, half)}-${code.slice(half)}` : code
}

/** Opens the Sayabot app straight to pairing when scanned or tapped on the phone. */
export function pairingDeepLink(code: string, serverUrl: string): string {
  return `sayabot://pair?code=${encodeURIComponent(code)}&server=${encodeURIComponent(serverUrl.replace(/\/+$/, ""))}`
}
