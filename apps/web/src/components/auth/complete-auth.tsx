"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"

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
        window.location.replace(next)
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
        window.location.replace(next)
        return
      }

      setError("This sign-in link is missing its token or has already been used.")
    }

    void finish()
  }, [next])

  if (!error) {
    return (
      <p role="status" className="font-mono text-[12px] text-muted">
        Finishing sign-in…
      </p>
    )
  }

  return (
    <div>
      <p role="alert" className="text-[13px] leading-relaxed text-danger">
        {error}
      </p>
      <Link
        href="/login"
        className="mt-4 inline-block font-mono text-[12px] text-accent underline underline-offset-4"
      >
        back to sign in
      </Link>
    </div>
  )
}
