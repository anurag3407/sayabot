/**
 * Which account this Mac's saved registration belongs to. The heartbeat (and the apps and models
 * it reports) lands on whichever account registered the computer, so a registration made by an
 * earlier login must not be reused by a new one, e.g. a fresh guest after the old login expired.
 */

export interface SavedHostAuth {
  serverUrl: string
  /** The account that registered this computer. Missing in files saved before 1.0.13. */
  userId?: string
}

/**
 * - "reuse": the saved registration is this account's.
 * - "verify": saved before the account was recorded; register again with it, which keeps the
 *   same computer when it is this account's, and keep using it if the server can't be reached.
 * - "register": none saved, another server, or another account's: register this account.
 */
export function hostAuthPlan(
  saved: SavedHostAuth | null,
  serverUrl: string,
  userId: string | null | undefined,
): "reuse" | "verify" | "register" {
  if (!saved || saved.serverUrl !== serverUrl) return "register"
  if (!userId) return "reuse"
  if (!saved.userId) return "verify"
  return saved.userId === userId ? "reuse" : "register"
}
