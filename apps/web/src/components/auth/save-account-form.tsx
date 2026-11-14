"use client"

import Link from "next/link"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/empty"

/** Inside the Mac app the preload exposes this bridge; window.open goes to the system browser. */
function inDesktopApp(): boolean {
  return typeof window !== "undefined" && "sayabotDesktop" in window
}

/**
 * Saving a guest: sign in to an existing account or create a new one (Google, GitHub or email),
 * then confirm, and everything from the guest session moves into that account.
 */
export function SaveAccountForm({ next }: { next: string }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openedInBrowser, setOpenedInBrowser] = useState(false)

  async function start() {
    setPending(true)
    setError(null)
    try {
      const desktop = inDesktopApp()
      const res = await fetch("/api/account/merge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // From the Mac app, finish by handing the new login back to the app.
        body: JSON.stringify({ next: desktop ? "/auth/desktop" : next }),
      })
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !data.url) {
        setError(data.error || "Could not start saving your account. Try again.")
        return
      }
      if (desktop) {
        // Google blocks sign-in inside embedded windows, so finish in the real browser.
        window.open(data.url, "_blank")
        setOpenedInBrowser(true)
      } else {
        window.location.assign(data.url)
      }
    } catch {
      setError("Could not reach Sayabot. Check your connection and try again.")
    } finally {
      setPending(false)
    }
  }

  if (openedInBrowser) {
    return (
      <div className="space-y-4 rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-lg font-medium">Finish in your browser</h2>
        <p className="text-[13px] leading-relaxed text-muted">
          Sign in or create your account in the browser window that just opened, then confirm.
          Sayabot will switch to your account by itself.
        </p>
        <Button
          variant="outline"
          className="w-full"
          disabled={pending}
          onClick={() => void start()}
        >
          Open the browser again
        </Button>
        <Link href={next} className="block text-center text-[12px] text-faint hover:text-text">
          Back to my workspace
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-5 rounded-2xl border border-line bg-panel p-6">
      <div>
        <h2 className="text-lg font-medium">Save your account</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          Use Google, GitHub or email. If you already have a Sayabot account, sign in to it and your
          guest workspace joins your other workspaces.
        </p>
      </div>

      <Button variant="primary" className="w-full" disabled={pending} onClick={() => void start()}>
        {pending ? "Starting…" : "Sign in or create account"}
      </Button>

      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <Link href={next} className="block text-center text-[12px] text-faint hover:text-text">
        Not now
      </Link>
    </div>
  )
}
