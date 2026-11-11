"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"

export default function DesktopAuthPage() {
  const [status, setStatus] = useState<"checking" | "redirecting" | "ready" | "unauthenticated">("checking")
  const [deepLink, setDeepLink] = useState<string>("")
  const [userEmail, setUserEmail] = useState<string>("")

  useEffect(() => {
    let mounted = true

    async function handleHandoff() {
      try {
        const supabase = createSupabaseBrowserClient()
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error || !session) {
          if (mounted) setStatus("unauthenticated")
          return
        }

        const email = session.user.email ?? ""
        const accessToken = session.access_token
        const refreshToken = session.refresh_token
        const userId = session.user.id
        const origin = window.location.origin

        // Construct desktop deep link
        const targetUri = `sayabot://auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&user_id=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}&server_url=${encodeURIComponent(origin)}`

        if (mounted) {
          setUserEmail(email)
          setDeepLink(targetUri)
          setStatus("redirecting")
        }

        // Attempt automatic deep-link launch
        window.location.href = targetUri

        // After a brief pause, show the fallback button in case the browser blocked auto-launch
        setTimeout(() => {
          if (mounted) setStatus("ready")
        }, 1500)
      } catch (err) {
        console.error("Desktop auth handoff error:", err)
        if (mounted) setStatus("unauthenticated")
      }
    }

    handleHandoff()
    return () => {
      mounted = false
    }
  }, [])

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

        {(status === "redirecting" || status === "ready") && (
          <div className="space-y-4">
            <h1 className="text-xl font-medium tracking-tight">Connecting to Sayabot Mac App</h1>
            <p className="text-sm text-neutral-400">
              Authenticated as <span className="font-mono text-emerald-400">{userEmail}</span>.
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

            <p className="pt-2 text-xs text-neutral-500">
              You can safely close this browser window once the Mac app opens.
            </p>
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
