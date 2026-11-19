"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

function SupabaseCallbackContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get("code")
  const errorParam = searchParams.get("error")

  const [status, setStatus] = useState<"loading" | "success" | "error">(code ? "loading" : "error")
  const [errorMessage, setErrorMessage] = useState<string | null>(
    errorParam || (code ? null : "No authorization code returned from Supabase"),
  )
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false

    async function exchange() {
      try {
        const res = await fetch("/api/connectors/supabase/oauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          projectName?: string
          projectUrl?: string
          bucket?: string
          error?: string
        }
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setStatus("error")
          setErrorMessage(data.error || "Supabase authorization failed")
          return
        }

        setStatus("success")
        setDetail(`Connected to "${data.projectName ?? "Supabase"}" (${data.bucket ?? "sayabot-storage"})`)

        if (window.opener) {
          window.opener.postMessage(
            {
              type: "SUPABASE_AUTH_SUCCESS",
              projectName: data.projectName,
              bucket: data.bucket,
            },
            window.location.origin,
          )
          setTimeout(() => {
            window.close()
          }, 1200)
        }
      } catch (err) {
        if (cancelled) return
        setStatus("error")
        setErrorMessage(err instanceof Error ? err.message : "Failed to connect to Supabase")
      }
    }

    exchange()
    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-sm">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-accent" />
            <h1 className="text-base font-semibold text-foreground">Connecting Supabase…</h1>
            <p className="text-xs text-muted-foreground">
              Verifying credentials and setting up your cloud storage bucket.
            </p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-3">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            <h1 className="text-base font-semibold text-foreground">Supabase Connected!</h1>
            <p className="text-xs text-muted-foreground">
              {detail ?? "Your cloud storage is ready. Closing this window…"}
            </p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3">
            <XCircle className="h-8 w-8 text-danger" />
            <h1 className="text-base font-semibold text-foreground">Connection Failed</h1>
            <p className="text-xs text-muted-foreground">{errorMessage}</p>
            <button
              onClick={() => window.close()}
              className="mt-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              Close Window
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

export default function SupabaseCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </main>
      }
    >
      <SupabaseCallbackContent />
    </Suspense>
  )
}
