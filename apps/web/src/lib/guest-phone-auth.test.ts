import { describe, expect, it } from "vitest"
import { magicLinkForPairing, syntheticGuestEmail, type PairingAuthAdmin } from "./guest-phone-auth"

const USER = "00000000-0000-4000-8000-000000000001"

function admin(opts: {
  email?: string | null
  anonymous?: boolean
  updateError?: string
  linkError?: string
}): PairingAuthAdmin {
  return {
    async getUserById() {
      return {
        data: {
          user: { id: USER, email: opts.email ?? null, is_anonymous: opts.anonymous === true },
        },
        error: null,
      }
    },
    async updateUserById(_id, attrs) {
      if (opts.updateError) return { data: { user: null }, error: { message: opts.updateError } }
      return { data: { user: { id: USER, email: attrs.email } }, error: null }
    },
    async generateLink(args) {
      if (opts.linkError) return { data: null, error: { message: opts.linkError } }
      return { data: { properties: { hashed_token: `token-for-${args.email}` } }, error: null }
    },
  }
}

describe("magicLinkForPairing", () => {
  it("gives a guest a confirmed address and a magic link for that same user", async () => {
    const result = await magicLinkForPairing(admin({ anonymous: true }), USER)
    expect(result).toEqual({
      ok: true,
      email: syntheticGuestEmail(USER),
      tokenHash: `token-for-${syntheticGuestEmail(USER)}`,
      wasAnonymous: true,
    })
  })

  it("uses the email a saved account already has", async () => {
    const result = await magicLinkForPairing(admin({ email: "ada@example.com" }), USER)
    expect(result).toMatchObject({ ok: true, email: "ada@example.com", wasAnonymous: false })
  })

  it("fails closed when the guest address cannot be saved", async () => {
    const result = await magicLinkForPairing(admin({ anonymous: true, updateError: "nope" }), USER)
    expect(result).toEqual({ ok: false, error: "Could not sign this phone in. Try a new code." })
  })
})
