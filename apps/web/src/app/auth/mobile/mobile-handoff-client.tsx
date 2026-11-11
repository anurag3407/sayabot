"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"

export interface MobileSessionPayload {
  accessToken: string
  refreshToken: string
  email: string
  userId: string
}

export function MobileHandoffClient({
  serverSession,
  siteUrl,
}: {
  serverSession: MobileSessionPayload | null
  siteUrl: string
}) {
  const [session, setSession] = useState<MobileSessionPayload | null>(serverSession)
  const [status, setStatus] = useState<"checking" | "redirecting" | "ready" | "unauthenticated">(
    serverSession ? "redirecting" : "checking",
  )

  useEffect(() => {
    let mounted = true

    async function handleHandoff() {
      const active = session || serverSession
      if (active) {
        const origin = (typeof window !== "undefined" ? window.location.origin : siteUrl) || siteUrl
        const targetUri = `sayabot://auth/callback?access_token=${encodeURIComponent(active.accessToken)}&refresh_token=${encodeURIComponent(active.refreshToken)}&user_id=${encodeURIComponent(active.userId)}&email=${encodeURIComponent(active.email)}&server_url=${encodeURIComponent(origin)}`

        try {
          window.location.href = targetUri
        } catch (e) {
          console.error("Mobile deep link trigger error:", e)
        }

        setTimeout(() => {
          if (mounted) setStatus("ready")
        }, 1200)
        return
      }

      try {
        const supabase = createSupabaseBrowserClient()
        const {
          data: { session: browserSession },
          error,
        } = await supabase.auth.getSession()

        if (error || !browserSession) {
          if (mounted) setStatus("unauthenticated")
          return
        }

        const data: MobileSessionPayload = {
          accessToken: browserSession.access_token,
          refreshToken: browserSession.refresh_token,
          email: browserSession.user.email ?? "",
          userId: browserSession.user.id,
        }

        if (mounted) {
          setSession(data)
          setStatus("redirecting")
        }

        const origin = window.location.origin || siteUrl
        const targetUri = `sayabot://auth/callback?access_token=${encodeURIComponent(data.accessToken)}&refresh_token=${encodeURIComponent(data.refreshToken)}&user_id=${encodeURIComponent(data.userId)}&email=${encodeURIComponent(data.email)}&server_url=${encodeURIComponent(origin)}`

        try {
          window.location.href = targetUri
        } catch (e) {
          console.error("Mobile deep link trigger error:", e)
        }

        setTimeout(() => {
          if (mounted) setStatus("ready")
        }, 1200)
      } catch (err) {
        console.error("Mobile auth handoff error:", err)
        if (mounted) setStatus("unauthenticated")
      }
    }

    void handleHandoff()
    return () => {
      mounted = false
    }
  }, [serverSession, siteUrl, session])

  const activeSession = session || serverSession
  const origin = (typeof window !== "undefined" ? window.location.origin : siteUrl) || siteUrl
  const deepLink = activeSession
    ? `sayabot://auth/callback?access_token=${encodeURIComponent(activeSession.accessToken)}&refresh_token=${encodeURIComponent(activeSession.refreshToken)}&user_id=${encodeURIComponent(activeSession.userId)}&email=${encodeURIComponent(activeSession.email)}&server_url=${encodeURIComponent(origin)}`
    : ""

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#070907] px-4 text-white">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f130f] p-6 shadow-2xl text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
          <Mascot seed="Juno" blink lit mood="alert" className="h-12 w-12" />
        </div>

        {status === "checking" && (
          <div className="space-y-2">
            <h1 className="text-lg font-medium">Authenticating…</h1>
            <p className="text-xs text-neutral-400">Connecting your phone to Sayabot.</p>
          </div>
        )}

        {(status === "redirecting" || status === "ready") && activeSession && (
          <div className="space-y-4">
            <h1 className="text-lg font-medium">Return to Sayabot App</h1>
            <p className="text-xs text-neutral-400">
              Authenticated as{" "}
              <span className="font-mono text-emerald-400">
                {activeSession.email || "Active User"}
              </span>
              .
            </p>
            <div>
              <a href={deepLink} className="inline-block w-full">
                <Button variant="primary" size="lg" className="w-full">
                  Open Sayabot App
                </Button>
              </a>
            </div>
            <p className="text-[11px] text-neutral-500">
              Tap the button above if the Sayabot app did not open automatically.
            </p>
          </div>
        )}

        {status === "unauthenticated" && (
          <div className="space-y-4">
            <h1 className="text-lg font-medium">Sign in Required</h1>
            <p className="text-xs text-neutral-400">
              Sign in with your Google or GitHub account to sync with your phone.
            </p>
            <div>
              <Link href="/login?next=/auth/mobile" className="inline-block w-full">
                <Button variant="primary" size="lg" className="w-full">
                  Sign In
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
