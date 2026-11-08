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
  if (typeof window !== "undefined" && window.crypto) {
    window.crypto.getRandomValues(bytes)
  } else {
    // Node.js environment
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("node:crypto")
    nodeCrypto.randomFillSync(bytes)
  }
  return toBase64Url(bytes).slice(0, length)
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const hash = await window.crypto.subtle.digest("SHA-256", data)
    return toBase64Url(new Uint8Array(hash))
  } else {
    // Node.js
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nodeCrypto = require("node:crypto")
    const hash = nodeCrypto.createHash("sha256").update(verifier).digest()
    return toBase64Url(new Uint8Array(hash))
  }
}
