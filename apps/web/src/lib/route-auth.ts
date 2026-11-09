import "server-only"
import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { getCurrentUser } from "@/lib/auth"

/**
 * Route-handler guard: the signed-in user, or a 401 response to return as-is.
 * Connector routes spend server credentials and proxy third-party auth, so none are anonymous.
 */
export async function requireRouteUser(): Promise<{ user: User } | { response: NextResponse }> {
  const user = await getCurrentUser()
  if (!user) {
    return { response: NextResponse.json({ error: "Sign in required" }, { status: 401 }) }
  }
  return { user }
}
