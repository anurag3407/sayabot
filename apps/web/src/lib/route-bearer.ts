import "server-only"
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js"
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env"
import { createSupabaseServerClient } from "@/lib/supabase/server"

/**
 * Who is calling an API route: the phone app sends its Supabase access token as a bearer
 * token; the web app relies on its session cookie. The returned client carries that person's
 * RLS, so reads stay scoped to what they can see.
 */
export async function userFromRequest(request: Request): Promise<{ user: User; client: SupabaseClient<any> } | null> {
  const header = request.headers.get("authorization")
  if (header && header.slice(0, 7).toLowerCase() === "bearer ") {
    const token = header.slice(7).trim()
    const client = createClient<any>(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    const { data, error } = await client.auth.getUser(token)
    if (!error && data?.user) return { user: data.user, client }
  }
  const cookieClient = await createSupabaseServerClient()
  const {
    data: { user },
  } = await cookieClient.auth.getUser()
  return user ? { user, client: cookieClient } : null
}
