"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, Loader2, XCircle } from "lucide-react"

export default function OpenRouterCallbackPage() {
  const searchParams = useSearchParams()
  const code = searchParams.get("code")
  const errorParam = searchParams.get("error")

  const [status, setStatus] = useState<"loading" | "success" | "error">(code ? "loading" : "error")
  const [errorMessage, setErrorMessage] = useState<string | null>(errorParam || (code ? null : "No authorization code found"))
  const [tierInfo, setTierInfo] = useState<string | null>(null)

  useEffect(() => {
    if (!code) return

    let cancelled = false

    async function exchange() {
      try {
        const res = await fetch("/api/connectors/openrouter/oauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })

        const data = (await res.json()) as {
          ok?: boolean
          apiKey?: string
          keyDetails?: { isFreeTier?: boolean; creditsRemaining?: number }
          error?: string
        }

        if (cancelled) return

        if (!res.ok || !data.ok) {
          setStatus("error")
          setErrorMessage(data.error || "Failed to exchange authorization code")
          return
        }

        const tier = data.keyDetails?.isFreeTier
          ? "Free Tier Active (Ready to use all free tool-calling models)"
          : `Active Account (${typeof data.keyDetails?.creditsRemaining === "number" ? `$${data.keyDetails.creditsRemaining.toFixed(2)} credits` : "Paid Tier"})`
        setTierInfo(tier)
        setStatus("success")

        // Broadcast to opener if in a popup window
        if (window.opener) {
          window.opener.postMessage(
            {
              type: "OPENROUTER_AUTH_SUCCESS",
              apiKey: data.apiKey,
              keyDetails: data.keyDetails,
            },
            "*",
          )
          setTimeout(() => {
            window.close()
          }, 1500)
        }
      } catch (err) {
        if (!cancelled) {
          setStatus("error")
          setErrorMessage(err instanceof Error ? err.message : "Network error during authentication")
        }
      }
    }

    void exchange()

    return () => {
      cancelled = true
    }
  }, [code])

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070907] p-4 text-[#e9e5d8]">
      <div className="w-full max-w-md rounded-2xl border border-[#232b25] bg-[#101411] p-6 shadow-2xl text-center">
        {status === "loading" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 className="h-10 w-10 animate-spin text-[#ff7a45]" />
            <h2 className="text-lg font-medium">Connecting OpenRouter Account...</h2>
            <p className="text-sm text-[#9aa39b]">Exchanging authorization credentials securely.</p>
          </div>
        )}

        {status === "success" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle2 className="h-12 w-12 text-[#8fbf9f]" />
            <h2 className="text-lg font-medium text-[#8fbf9f]">OpenRouter Connected!</h2>
            {tierInfo && <p className="text-xs font-mono text-[#9aa39b]">{tierInfo}</p>}
            <p className="text-xs text-[#7a857c]">This window will close automatically, or you may return to Saaya.</p>
          </div>
        )}

        {status === "error" && (
          <div className="flex flex-col items-center gap-3 py-6">
            <XCircle className="h-12 w-12 text-[#e37b74]" />
            <h2 className="text-lg font-medium text-[#e37b74]">Connection Failed</h2>
            <p className="text-sm text-[#9aa39b]">{errorMessage}</p>
            <button
              onClick={() => window.close()}
              className="mt-4 rounded-lg bg-[#232b25] px-4 py-2 text-xs font-medium text-[#e9e5d8] hover:bg-[#354037]"
            >
              Close Window
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
