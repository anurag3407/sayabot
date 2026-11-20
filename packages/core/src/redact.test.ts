import { describe, expect, it } from "vitest"
import { createRunScrubber, redactSecrets } from "./redact"

// Secret-shaped fixtures are assembled at runtime so the repository never
// contains a string that a secret scanner could mistake for a live credential.
const join = (...parts: string[]) => parts.join("")

const secrets = [
  join("AKIA", "IOSFODNN7EXAMPLE"),
  join("sk-", "proj-", "abcdefghijklmnopqrstuvwxyz123456"),
  join("sk-", "ant-api03-", "abcdefghijklmnopqrstuvwxyz"),
  join("gh", "p_", "abcdefghijklmnopqrstuvwxyz0123456789"),
  join(
    "github_",
    "pat_",
    "11ABCDEFG0123456789_",
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345",
  ),
  join("xox", "b-", "123456789012-123456789012-abcdefghijklmnop"),
  join("AIz", "aSyA1234567890abcdefghijklmnopqrstuv"),
  join("gs", "k_", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"),
  join("mesh_", "ak_", "abcdefghijklmnopqrstuvwx"),
  join("saaya_", "ak_", "abcdefghijklmnopqrstuvwx"),
  join("sayabot_", "ak_", "abcdefghijklmnopqrstuvwx"),
  join("mesh_", "at_", "abcdefghijklmnopqrstuvwx"),
  join("sayabot_", "at_", "abcdefghijklmnopqrstuvwx"),
  join("mesh_", "rt_", "abcdefghijklmnopqrstuvwx"),
  join("sayabot_", "rt_", "abcdefghijklmnopqrstuvwx"),
  join("sinv_", "abcdefghijklmnopqrstuvwx"),
  join(
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    ".",
    "eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    ".",
    "dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
  ),
]

describe("redactSecrets", () => {
  it("redacts every supported secret shape", () => {
    const input = `found ${secrets.join(" and ")}`
    const { text, redactions } = redactSecrets(input)
    for (const secret of secrets) expect(text).not.toContain(secret)
    expect(text).toContain("[REDACTED:aws_access_key]")
    expect(text).toContain("[REDACTED:anthropic_key]")
    expect(text).toContain("[REDACTED:openai_key]")
    expect(text).toContain("[REDACTED:github_token]")
    expect(text).toContain("[REDACTED:github_pat]")
    expect(text).toContain("[REDACTED:slack_token]")
    expect(text).toContain("[REDACTED:google_api_key]")
    expect(text).toContain("[REDACTED:groq_key]")
    expect(text).toContain("[REDACTED:mesh_agent_key]")
    expect(text).toContain("[REDACTED:oauth_access_token]")
    expect(text).toContain("[REDACTED:oauth_refresh_token]")
    expect(text).toContain("[REDACTED:invite_code]")
    expect(text).toContain("[REDACTED:jwt]")
    expect(redactions.length).toBeGreaterThanOrEqual(13)
  })

  it("redacts PEM private keys across lines", () => {
    const pem = join(
      "-----BEGIN ",
      "RSA PRIVATE KEY",
      "-----\nMIIEow\nabc\n-----END ",
      "RSA PRIVATE KEY",
      "-----",
    )
    const { text } = redactSecrets(`key: ${pem}`)
    expect(text).toBe("key: [REDACTED:private_key]")
  })

  it("leaves placeholders untouched unless explicitly asked to redact", () => {
    const ph = "saaya_ph_0123456789abcdef0123456789abcdef"
    const normal = redactSecrets(`value is ${ph}`)
    expect(normal.text).toBe(`value is ${ph}`)

    const redacted = redactSecrets(`value is ${ph}`, { redactPlaceholders: true })
    expect(redacted.text).toBe("value is [REDACTED:placeholder]")
  })

  it("leaves innocent text unchanged", () => {
    const input = "Normal chat message with @ada discussing task #42"
    const { text, redactions } = redactSecrets(input)
    expect(text).toBe(input)
    expect(redactions).toHaveLength(0)
  })
})

describe("createRunScrubber", () => {
  it("scrubs exact plaintexts, base64 and URL-encoded variants", () => {
    const secretValue = "super-secret-token-xyz-12345"
    const scrubber = createRunScrubber([secretValue])

    const text = `The raw is ${secretValue}, b64 is ${Buffer.from(secretValue).toString("base64")}, url is ${encodeURIComponent(secretValue)}`
    const scrubbed = scrubber(text)

    expect(scrubbed).not.toContain(secretValue)
    expect(scrubbed).not.toContain(Buffer.from(secretValue).toString("base64"))
    expect(scrubbed).not.toContain(encodeURIComponent(secretValue))
    expect(scrubbed).toBe(
      "The raw is [REDACTED:secret], b64 is [REDACTED:secret], url is [REDACTED:secret]",
    )
  })

  it("safely ignores short or empty values", () => {
    const scrubber = createRunScrubber(["", "hi", "test"])
    expect(scrubber("normal hi text")).toBe("normal hi text")
  })
})
