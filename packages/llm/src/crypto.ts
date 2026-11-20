import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

export interface EncryptedSecret {
  ciphertext: string
  iv: string
  tag: string
}

/** SAYABOT_KEK (or MESH_KEK) is a base64-encoded 32-byte key; never log it. */
export function parseKek(kek: string): Buffer {
  const key = Buffer.from(kek, "base64")
  if (key.length !== 32) {
    throw new Error(
      "SAYABOT_KEK (or MESH_KEK) must decode to exactly 32 bytes (generate with: openssl rand -base64 32)",
    )
  }
  return key
}

export function encryptSecret(plaintext: string, kek: string): EncryptedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", parseKek(kek), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  }
}

export function decryptSecret(secret: EncryptedSecret, kek: string): string {
  const decipher = createDecipheriv("aes-256-gcm", parseKek(kek), Buffer.from(secret.iv, "base64"))
  decipher.setAuthTag(Buffer.from(secret.tag, "base64"))
  return Buffer.concat([
    decipher.update(Buffer.from(secret.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8")
}

/** Single-column envelope for values stored as one text field. */
export function sealSecret(plaintext: string, kek: string): string {
  return Buffer.from(JSON.stringify(encryptSecret(plaintext, kek)), "utf8").toString("base64")
}

export function openSecret(sealed: string, kek: string): string {
  const parsed = JSON.parse(Buffer.from(sealed, "base64").toString("utf8")) as EncryptedSecret
  return decryptSecret(parsed, kek)
}

export function last4(value: string): string {
  return value.slice(-4)
}
