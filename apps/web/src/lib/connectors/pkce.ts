/**
 * Generates cryptographic PKCE code verifier and challenge
 * Works seamlessly in both browser and Node.js environments
 */

function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export function generateCodeVerifier(length = 64): string {
  const bytes = new Uint8Array(length)
  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : globalThis.crypto
  cryptoObj.getRandomValues(bytes)
  return toBase64Url(bytes).slice(0, length)
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const cryptoObj = typeof window !== "undefined" && window.crypto ? window.crypto : globalThis.crypto
  const hash = await cryptoObj.subtle.digest("SHA-256", data)
  return toBase64Url(new Uint8Array(hash))
}
