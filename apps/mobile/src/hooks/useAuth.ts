import { useEffect, useState } from "react"
import type { Session, User } from "@supabase/supabase-js"
import { setDemoMode } from "../core/session-mode"
import { supabase } from "../core/supabase"

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setUser(newSession?.user ?? null)
      setLoading(false)
    })

    return () => {
      authListener.subscription.unsubscribe()
    }
  }, [])

  const signIn = async (email: string, pass: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: pass,
    })
    if (error) throw error
    return data
  }

  const signOut = async () => {
    setDemoMode(false)
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return { session, user, loading, signIn, signOut }
}
