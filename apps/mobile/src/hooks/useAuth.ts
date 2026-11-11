import { useEffect, useState } from "react"
import { AppState, Linking } from "react-native"
import type { Session, User } from "@supabase/supabase-js"
import { parsePairLink } from "../core/pair-link"
import { forgetPairing, pairWithCode, phoneWasRemoved } from "../core/pairing"
import { setDemoMode } from "../core/session-mode"
import { supabase } from "../core/supabase"

function extractTokensFromUrl(url: string): { accessToken: string; refreshToken: string } | null {
  try {
    const raw = url.includes("#") ? url.split("#")[1] : url.split("?")[1]
    if (!raw) return null

    const params = new URLSearchParams(raw)
    const accessToken = params.get("access_token")
    const refreshToken = params.get("refresh_token")

    if (accessToken && refreshToken) {
      return { accessToken, refreshToken }
    }
  } catch (err) {
    console.error("[useAuth] Failed to parse deep-link tokens:", err)
  }
  return null
}

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [pairError, setPairError] = useState<string | null>(null)

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

    // Handle deep-link auth callback (sayabot://auth/callback)
    const handleDeepLink = async (event: { url: string }) => {
      if (!event.url) return
      // sayabot://pair?code=… from a scanned "Add a phone" QR code.
      const pair = parsePairLink(event.url)
      if (pair) {
        setLoading(true)
        setPairError(null)
        try {
          await pairWithCode(pair.code, pair.server)
        } catch (err) {
          setPairError(err instanceof Error ? err.message : "Could not sign in with that code")
        } finally {
          setLoading(false)
        }
        return
      }
      const tokens = extractTokensFromUrl(event.url)
      if (tokens) {
        setLoading(true)
        try {
          await supabase.auth.setSession({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
          })
        } catch (err) {
          console.error("[useAuth] Failed to restore session from deep link:", err)
        } finally {
          setLoading(false)
        }
      }
    }

    // Check cold-start URL
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url })
    })

    const linkingSub = Linking.addEventListener("url", handleDeepLink)

    // A phone removed on the computer signs out when it opens or comes back to the foreground.
    const checkRemoved = async () => {
      if (await phoneWasRemoved()) {
        await forgetPairing()
        await supabase.auth.signOut()
      }
    }
    void checkRemoved()
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void checkRemoved()
    })

    return () => {
      authListener.subscription.unsubscribe()
      linkingSub.remove()
      appStateSub.remove()
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

  const signInWithOAuth = async (provider: "google" | "github") => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: "sayabot://auth/callback",
        skipBrowserRedirect: true,
      },
    })
    if (error) throw error
    if (data?.url) {
      await Linking.openURL(data.url)
    }
  }

  const signInWithCode = async (code: string) => {
    setPairError(null)
    await pairWithCode(code)
  }

  const signOut = async () => {
    setDemoMode(false)
    await forgetPairing()
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return { session, user, loading, pairError, signIn, signInWithOAuth, signInWithCode, signOut }
}
