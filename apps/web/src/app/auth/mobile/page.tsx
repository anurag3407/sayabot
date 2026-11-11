"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Mascot } from "@/components/ui/mascot"
import { Button } from "@/components/ui/button"

export default function MobileAuthPage() {
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

        // Construct mobile deep link
        const targetUri = `sayabot://auth/callback?access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken)}&user_id=${encodeURIComponent(userId)}&email=${encodeURIComponent(email)}&server_url=${encodeURIComponent(origin)}`

        if (mounted) {
          setUserEmail(email)
          setDeepLink(targetUri)
          setStatus("redirecting")
        }

        // Trigger mobile deep link
        window.location.href = targetUri

        setTimeout(() => {
          if (mounted) setStatus("ready")
        }, 1500)
      } catch (err) {
        console.error("Mobile auth handoff error:", err)
        if (mounted) setStatus("unauthenticated")
      }
    }

    handleHandoff()
    return () => {
      mounted = false
    }
  }, [])

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

        {(status === "redirecting" || status === "ready") && (
          <div className="space-y-4">
            <h1 className="text-lg font-medium">Return to Sayabot App</h1>
            <p className="text-xs text-neutral-400">
              Authenticated as <span className="font-mono text-emerald-400">{userEmail}</span>.
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
