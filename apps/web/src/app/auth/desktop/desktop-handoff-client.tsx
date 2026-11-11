"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"

export interface SessionPayload {
  accessToken: string
  refreshToken: string
  email: string
  userId: string
}

export function DesktopHandoffClient({
  serverSession,
  siteUrl,
}: {
  serverSession: SessionPayload | null
  siteUrl: string
}) {
  const [session, setSession] = useState<SessionPayload | null>(serverSession)
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

        // Attempt automatic deep-link launch
        try {
          window.location.href = targetUri
        } catch (e) {
          console.error("Deep link trigger error:", e)
        }

        setTimeout(() => {
          if (mounted) setStatus("ready")
        }, 1200)
        return
      }

      // Fallback: check browser client session
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

        const data: SessionPayload = {
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
          console.error("Deep link trigger error:", e)
        }

        setTimeout(() => {
          if (mounted) setStatus("ready")
        }, 1200)
      } catch (err) {
        console.error("Desktop auth handoff error:", err)
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
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#070907] px-4 text-white selection:bg-[#34d399]/30">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0f130f] p-8 shadow-2xl text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-white/5 border border-white/10">
          <Mascot seed="Pip" blink lit mood="alert" className="h-14 w-14" />
        </div>

        {status === "checking" && (
          <div className="space-y-3">
            <h1 className="text-xl font-medium tracking-tight">Checking authentication…</h1>
            <p className="text-sm text-neutral-400">Verifying your active Sayabot session.</p>
          </div>
        )}

        {(status === "redirecting" || status === "ready") && activeSession && (
          <div className="space-y-4">
            <h1 className="text-xl font-medium tracking-tight">Connecting to Sayabot Mac App</h1>
            <p className="text-sm text-neutral-400">
              Authenticated as{" "}
              <span className="font-mono text-emerald-400">
                {activeSession.email || "Active User"}
              </span>
              .
            </p>
            <p className="text-xs text-neutral-500">
              If your browser prompted you to open Sayabot, click <strong>Open Sayabot</strong>.
            </p>

            <div className="pt-2">
              <a href={deepLink} className="inline-block w-full">
                <Button variant="primary" size="lg" className="w-full font-medium">
                  Open Sayabot Mac App
                </Button>
              </a>
            </div>

            <div className="pt-3">
              <Link
                href="/"
                className="text-xs text-neutral-500 hover:text-neutral-300 underline underline-offset-4"
              >
                Or continue to Web Workspace instead →
              </Link>
            </div>
          </div>
        )}

        {status === "unauthenticated" && (
          <div className="space-y-4">
            <h1 className="text-xl font-medium tracking-tight">Sign in Required</h1>
            <p className="text-sm text-neutral-400">
              You need to sign in to connect your Sayabot Mac application.
            </p>
            <div className="pt-2">
              <Link href="/login?next=/auth/desktop" className="inline-block w-full">
                <Button variant="primary" size="lg" className="w-full">
                  Sign in with Google or GitHub
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
