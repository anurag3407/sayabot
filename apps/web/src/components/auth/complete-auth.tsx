"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { Mascot } from "@/components/ui/mascot"

export function CompleteAuth({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function finish() {
      const url = new URL(window.location.href)
      const hash = new URLSearchParams(url.hash.replace(/^#/, ""))
      const failure =
        url.searchParams.get("error_description") ??
        url.searchParams.get("error") ??
        hash.get("error_description") ??
        hash.get("error")
      if (failure) {
        setError(failure.replaceAll("+", " "))
        return
      }

      const accessToken = hash.get("access_token")
      const refreshToken = hash.get("refresh_token")
      const code = url.searchParams.get("code")
      const tokenHash = url.searchParams.get("token_hash")

      if (accessToken && refreshToken) {
        const supabase = createSupabaseBrowserClient()
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })
        if (sessionError) {
          setError("This sign-in link is invalid or has expired. Request a new one.")
          return
        }

        if (next && next !== "/" && next !== "/login" && next !== "/signup") {
          window.location.replace(next)
          return
        }

        // Direct workspace navigation to avoid bouncing on landing page "/"
        try {
          const { data: members } = await supabase
            .from("org_members")
            .select("org_id, orgs!inner(slug)")
            .limit(1)

          const slug = (members as any)?.[0]?.orgs?.slug
          if (slug) {
            window.location.replace(`/${slug}`)
            return
          }
        } catch {
          // ignore
        }

        window.location.replace("/onboarding")
        return
      }

      if (code || tokenHash) {
        window.location.replace(`/auth/callback?${url.searchParams.toString()}`)
        return
      }

      const supabase = createSupabaseBrowserClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (session) {
        if (next && next !== "/" && next !== "/login" && next !== "/signup") {
          window.location.replace(next)
          return
        }
        try {
          const { data: members } = await supabase
            .from("org_members")
            .select("org_id, orgs!inner(slug)")
            .limit(1)

          const slug = (members as any)?.[0]?.orgs?.slug
          if (slug) {
            window.location.replace(`/${slug}`)
            return
          }
        } catch {
          // ignore
        }
        window.location.replace("/onboarding")
        return
      }

      setError("This sign-in link is missing its token or has already been used.")
    }

    void finish()
  }, [next])

  if (!error) {
    return (
      <div className="flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in duration-300">
        <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-white/5 border border-white/10 shadow-2xl">
          <Mascot seed="Pip" blink lit mood="alert" className="h-12 w-12" />
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
        </div>

        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-white">Opening Sayabot Workspace</h1>
          <p className="text-sm text-neutral-400">Syncing rooms, canvas, and active agents…</p>
        </div>

        <div className="w-56 h-1 bg-white/10 rounded-full overflow-hidden mt-2">
          <div className="h-full bg-emerald-500 animate-pulse rounded-full w-2/3" />
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f130f] p-6 shadow-2xl text-center space-y-4">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-white">Sign-in Incomplete</h2>
        <p className="text-xs text-neutral-400 leading-relaxed">{error}</p>
      </div>
      <div className="pt-2">
        <Link
          href="/login"
          className="inline-block w-full py-2.5 px-4 rounded-xl bg-white/10 hover:bg-white/15 text-sm font-medium text-white transition-colors"
        >
          Back to Sign In
        </Link>
      </div>
    </div>
  )
}
