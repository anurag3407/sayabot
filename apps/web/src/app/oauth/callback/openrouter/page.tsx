"use client"

import { Suspense, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"
import type { OpenRouterAuthMessage } from "@/lib/ai-accounts"

function OpenRouterCallbackContent() {
  const searchParams = useSearchParams()
  const code = searchParams.get("code")
  const errorParam = searchParams.get("error")

  const [status, setStatus] = useState<"loading" | "success" | "error">(code ? "loading" : "error")
  const [errorMessage, setErrorMessage] = useState<string | null>(
    errorParam || (code ? null : "No authorization code came back from OpenRouter"),
  )
  const [detail, setDetail] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return
    let cancelled = false

    async function exchange() {
      try {
        // The verifier and the workspace come from httpOnly cookies set when the sign-in started.
        const res = await fetch("/api/connectors/openrouter/oauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          label?: string
          last4?: string
          freeTier?: boolean
          creditsRemaining?: number
          error?: string
        }
        if (cancelled) return
        if (!res.ok || !data.ok) {
          setStatus("error")
          setErrorMessage(data.error || "OpenRouter did not finish the sign-in")
          return
        }
        setDetail(
          data.freeTier
            ? "Free tier: the free tool-calling models are ready to use."
            : typeof data.creditsRemaining === "number"
              ? `$${data.creditsRemaining.toFixed(2)} in credits.`
              : "Ready to use.",
        )
        setStatus("success")
        if (window.opener) {
          const message: OpenRouterAuthMessage = {
            type: "OPENROUTER_AUTH_SUCCESS",
            label: data.label ?? "OpenRouter",
            freeTier: Boolean(data.freeTier),
          }
          // Same origin only: nothing else may hear that an account was connected.
          window.opener.postMessage(message, window.location.origin)
          setTimeout(() => window.close(), 1500)
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error")
          setErrorMessage(err instanceof Error ? err.message : "Network error during sign-in")
        }
      }
    }

    void exchange()
    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4 text-text">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 text-center">
        {status === "loading" ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-10 w-10 animate-spin text-muted" />
            <h1 className="text-lg font-medium">Connecting OpenRouter…</h1>
            <p className="text-sm text-faint">Saving the key to your workspace.</p>
          </div>
        ) : status === "success" ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-12 w-12 text-ok" />
            <h1 className="text-lg font-medium">OpenRouter is connected</h1>
            {detail ? <p className="text-sm text-muted">{detail}</p> : null}
            <p className="text-xs text-faint">This window closes on its own.</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-6">
            <XCircle className="h-12 w-12 text-danger" />
            <h1 className="text-lg font-medium">OpenRouter is not connected</h1>
            <p className="text-sm text-muted">{errorMessage}</p>
            <p className="text-xs text-faint">
              Close this window and start again from Manage AI accounts.
            </p>
            <button
              type="button"
              onClick={() => window.close()}
              className="mt-2 rounded-lg bg-raised px-4 py-2 text-[13px] font-medium text-text hover:bg-hover"
            >
              Close window
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function OpenRouterCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-ink">
          <Loader2 className="h-10 w-10 animate-spin text-muted" />
        </div>
      }
    >
      <OpenRouterCallbackContent />
    </Suspense>
  )
}
