# Secret Crypto — AES-256-GCM Envelope Encryption

Every credential in Sayabot — provider API keys, OAuth tokens, MCP headers, connector webhooks — is encrypted at rest with AES-256-GCM under a single master key (the KEK). `src/crypto.ts` is the whole implementation: four functions for the two storage shapes Sayabot uses, plus the KEK parser and a display helper. It depends only on `node:crypto`, so the helpers are safe to import from any runtime.

There is deliberately no key management, rotation or KMS integration here: callers read the KEK from the environment (`SAYABOT_KEK`, with legacy `MESH_KEK` accepted at the call sites that fetch it) and pass it as a plain string to each function.

Source files: `packages/llm/src/crypto.ts` (55 lines), `packages/llm/src/crypto.test.ts`

---

## 🔐 The `EncryptedSecret` envelope

The three-column envelope used by tables that store secrets in dedicated columns (e.g. `provider_keys`, `workspace_connectors`):

```typescript
export interface EncryptedSecret {
  ciphertext: string // Base64
  iv: string         // Base64, 12 random bytes
  tag: string        // Base64, 16-byte GCM auth tag
}
```

(`packages/llm/src/crypto.ts:3-7`.) Encrypt and decrypt:

```typescript
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
```

(`packages/llm/src/crypto.ts:18-40`.) Properties:

- A **fresh 12-byte random IV per encryption** — encrypting the same plaintext twice produces different ciphertext and IV (asserted by the first test below).
- GCM's authentication tag is stored alongside the ciphertext; any bit flipped in the ciphertext, tag or the underlying key causes `decipher.final()` to throw instead of returning corrupted plaintext.
- Input is UTF-8; output plaintext is UTF-8.

---

## 🗝️ KEK handling

```typescript
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
```

(`packages/llm/src/crypto.ts:10-16`.)

- The canonical env var is **`SAYABOT_KEK`**; **`MESH_KEK`** is the legacy alias. The alias resolution happens at *call sites* that read the environment (for example `apps/web/src/lib/env.ts` and the orchestrator's env helpers), not inside this module — `parseKek` itself accepts any base64 string.
- The key **must decode to exactly 32 bytes** (256 bits). Anything else throws with the generation hint `openssl rand -base64 32`.
- Errors are thrown eagerly by every encrypt/decrypt call, since all four functions call `parseKek` first.
- The key is never logged and never included in error messages.

---

## 🥫 Single-column sealing: `sealSecret` / `openSecret`

Tables that keep a secret in one text column (`mcp_servers.headers_enc`, `mcp_servers.oauth_enc`, vault entries) use a self-contained base64 blob:

```typescript
/** Single-column envelope for values stored as one text field. */
export function sealSecret(plaintext: string, kek: string): string {
  return Buffer.from(JSON.stringify(encryptSecret(plaintext, kek)), "utf8").toString("base64")
}

export function openSecret(sealed: string, kek: string): string {
  const parsed = JSON.parse(Buffer.from(sealed, "base64").toString("utf8")) as EncryptedSecret
  return decryptSecret(parsed, kek)
}
```

(`packages/llm/src/crypto.ts:43-50`.) The sealed format is `base64(JSON.stringify(EncryptedSecret))`. `openSecret` throws if the blob is not valid base64/JSON or the tag does not verify — callers treat any throw as "unreadable secret".

Typical usage, sealing MCP OAuth state before it is written to the `mcp_servers` row:

```typescript
import { openSecret, sealSecret } from "@sayabot/llm"
const sealed = sealSecret(JSON.stringify({ apiKey: "sk-..." }), getKek())
const plaintext = openSecret(sealed, getKek())
```

---

## ✂️ Display helper

```typescript
export function last4(value: string): string {
  return value.slice(-4)
}
```

(`packages/llm/src/crypto.ts:52-54`.) The web UI stores `last4(key)` next to the envelope so settings pages can show `…1234` without ever decrypting.

---

## ⚠️ Error modes

| Situation | Behaviour |
| :-- | :-- |
| KEK missing / empty at the call site | Callers throw before reaching crypto; `parseKek("")` decodes to a 0-byte buffer and throws the 32-bytes error |
| KEK not 32 bytes after base64 decode | `Error("SAYABOT_KEK (or MESH_KEK) must decode to exactly 32 bytes …")` from every encrypt/decrypt call |
| Wrong KEK on decrypt | `decipher.final()` throws (GCM auth failure) — the test suite pins this |
| Tampered ciphertext or tag | Same GCM auth failure; nothing is returned |
| `openSecret` on garbage / non-JSON blob | `JSON.parse` throws |
| Key/IV/tag not valid Base64 on decrypt | `Buffer.from` yields partial bytes; decipher throws on malformed lengths |

---

## 🧪 Test coverage (`crypto.test.ts`)

The suite derives a dummy KEK as `Buffer.alloc(32, 7).toString("base64")` — no real key is ever used in tests. The exact cases (`packages/llm/src/crypto.test.ts:13-51`):

| Test | Asserts |
| :-- | :-- |
| `round-trips a column envelope with a fresh IV` | Two `encryptSecret` calls on the same plaintext give different `iv` and `ciphertext`; `decryptSecret` returns the original `sk-test-1234567890` |
| `rejects a tampered ciphertext or tag` | Replacing `tag` with `Buffer.alloc(16, 1).toString("base64")` throws; replacing `ciphertext` with `Buffer.from("tampered")` throws |
| `fails with the wrong key` | A KEK of `Buffer.alloc(32, 8)` throws on decrypt |
| `validates the key length` | `parseKek` of a 16-byte key throws with a message matching `/32 bytes/` |
| `round-trips the single-column envelope` | `sealSecret(JSON.stringify({ token: "abc" }))` → `openSecret` returns `'{"token":"abc"}'` |
| `returns the last four characters` | `last4("sk-abcdefgh1234")` is `"1234"` |

The integration suite (`packages/llm/tests/integration/index.test.ts:13-18`) additionally checks that `sealSecret`/`openSecret` round-trip through the package's public entry point and that the sealed blob does not contain the plaintext.

---

## 🛡️ Where each shape is used

| Table / column | Shape | Writer | Reader |
| :-- | :-- | :-- | :-- |
| `provider_keys.ciphertext/iv/tag` | Three-column envelope | `apps/web/src/lib/provider-key-store.ts` (`encryptSecret`) | `providerKeyToApiKey()` in `packages/llm/src/registry.ts:185` (`decryptSecret`) |
| `workspace_connectors.ciphertext/iv/tag` | Three-column envelope | Connector OAuth setup in `apps/web` | `apps/orchestrator/src/connectors/service.ts` (`decryptSecret`) |
| `mcp_servers.headers_enc`, `oauth_enc` | Sealed single column | `sealSecret` / `sealMcpOAuthState` | `openSecret` / `openMcpOAuthState` at turn time |
| Vault / `$SECRET{...}` broker | Sealed single column | `apps/orchestrator/src/tools/secrets.ts` | `use_secret` tool resolves placeholders without exposing plaintext to the model |

---

## Related docs

- [overview.md](./overview.md) — package role and export surface
- [mcp-oauth.md](./mcp-oauth.md) — `sealMcpOAuthState`/`openMcpOAuthState` built on top of these primitives
- [connector-secret.md](./connector-secret.md) — plaintext packing before sealing connector credentials
- [registry-and-models.md](./registry-and-models.md) — where decrypted provider keys become AI SDK models
