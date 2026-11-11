"use client"

import { Download, ScanLine } from "lucide-react"
import QRCode from "qrcode"
import { useEffect, useState, useTransition } from "react"
import { createPhonePairingAction, phonePairingStatusAction } from "@/lib/actions/phones"
import { Button } from "@/components/ui/button"
import { CheckIcon, CloseIcon } from "@/components/ui/icons"

type Step = "ask" | "get-app" | "code" | "done" | "expired"

interface Pairing {
  pairingId: string
  code: string
  deepLink: string
  server: string
  expiresAt: string
}

const ANDROID_APK = "https://github.com/anurag3407/Mesh/releases/latest/download/Sayabot.apk"

function useCountdown(expiresAt: string | null) {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (!expiresAt) return
    const tick = () => setLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)))
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [expiresAt])
  return left
}

/** OpenBot-style "Add a phone": is the app installed? → one-time code (or get the app first). */
export function AddPhoneDialog({
  orgSlug,
  open,
  onClose,
  onPaired,
}: {
  orgSlug: string
  open: boolean
  onClose: () => void
  onPaired?: () => void
}) {
  const [step, setStep] = useState<Step>("ask")
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [deviceName, setDeviceName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const left = useCountdown(step === "code" ? (pairing?.expiresAt ?? null) : null)

  useEffect(() => {
    if (!open) {
      const t = window.setTimeout(() => {
        setStep("ask")
        setPairing(null)
        setQr(null)
        setDeviceName(null)
        setError(null)
      }, 200)
      return () => window.clearTimeout(t)
    }
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  useEffect(() => {
    if (step !== "code" || !pairing) return
    const id = window.setInterval(async () => {
      const result = await phonePairingStatusAction({ orgSlug, pairingId: pairing.pairingId })
      if (!result.ok) return
      const status = result.data?.status
      if (status === "paired") {
        setDeviceName((result.data?.deviceName as string | null) ?? "Your phone")
        setStep("done")
        onPaired?.()
      } else if (status === "expired") {
        setStep("expired")
      }
    }, 2_000)
    return () => window.clearInterval(id)
  }, [step, pairing, orgSlug, onPaired])

  function showCode() {
    setError(null)
    startTransition(async () => {
      const result = await createPhonePairingAction({ orgSlug })
      if (!result.ok || !result.data) {
        setError(result.error ?? "Could not make a code")
        return
      }
      const next = result.data as unknown as Pairing
      setPairing(next)
      setQr(await QRCode.toDataURL(next.deepLink, { margin: 1, width: 360, color: { dark: "#0b0b0c", light: "#ffffff" } }).catch(() => null))
      setStep("code")
    })
  }

  if (!open) return null
  const mm = Math.floor(left / 60)
  const ss = String(left % 60).padStart(2, "0")

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/70 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-phone-title"
        className="w-full max-w-lg rounded-t-xl border border-line bg-panel p-5 shadow-2xl sm:rounded-xl sm:p-7"
      >
        <div className="flex items-start justify-between">
          <h2 id="add-phone-title" className="text-[18px] font-semibold text-text">
            Add a phone
          </h2>
          <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}>
            <CloseIcon width={14} height={14} />
          </Button>
        </div>

        {step === "ask" ? (
          <div className="mt-8">
            <p className="text-center text-[15px] text-muted">Is Sayabot installed on the phone?</p>
            <div className="mt-5 space-y-3">
              <button
                type="button"
                onClick={showCode}
                disabled={pending}
                className="flex w-full items-center gap-4 rounded-xl border border-line bg-raised p-4 text-left transition-colors hover:border-line-strong hover:bg-hover disabled:opacity-60"
              >
                <ScanLine aria-hidden className="h-5 w-5 shrink-0 text-muted" />
                <span>
                  <span className="block text-[15px] font-medium text-text">{pending ? "Making a code…" : "Yes, sign in"}</span>
                  <span className="block text-[13px] text-muted">Show a one-time code</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStep("get-app")}
                className="flex w-full items-center gap-4 rounded-xl border border-line bg-raised p-4 text-left transition-colors hover:border-line-strong hover:bg-hover"
              >
                <Download aria-hidden className="h-5 w-5 shrink-0 text-muted" />
                <span>
                  <span className="block text-[15px] font-medium text-text">No, get the app</span>
                  <span className="block text-[13px] text-muted">iPhone or Android</span>
                </span>
              </button>
            </div>
            {error ? <p className="mt-3 text-center text-[13px] text-danger">{error}</p> : null}
          </div>
        ) : null}

        {step === "get-app" ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-line bg-ink p-4">
              <p className="text-[15px] font-medium text-text">Android</p>
              <p className="mt-1 text-[13px] text-muted">Open this on the phone to download the app, then install it.</p>
              <a href={ANDROID_APK} className="mt-3 inline-flex text-[13px] font-medium text-accent hover:underline">
                Download for Android ↗
              </a>
            </div>
            <div className="rounded-xl border border-line bg-ink p-4">
              <p className="text-[15px] font-medium text-text">iPhone</p>
              <p className="mt-1 text-[13px] text-muted">
                Open Sayabot in Safari on the phone, tap Share, then <span className="text-text">Add to Home Screen</span>.
              </p>
            </div>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("ask")}>
                Back
              </Button>
              <Button variant="primary" disabled={pending} onClick={showCode}>
                I&apos;ve installed it
              </Button>
            </div>
          </div>
        ) : null}

        {step === "code" && pairing ? (
          <div className="mt-6">
            <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
              {qr ? (
                <img src={qr} alt="Scan with the phone's camera to sign in" className="h-40 w-40 shrink-0 rounded-lg bg-white p-1" />
              ) : null}
              <div className="min-w-0 text-center sm:text-left">
                <p className="text-[13px] text-muted">On the phone, open Sayabot and tap</p>
                <p className="text-[15px] font-medium text-text">Sign in with a code</p>
                <p
                  className="mt-3 select-all font-mono text-[32px] font-semibold tracking-[0.12em] text-text"
                  aria-label={`Code ${pairing.code.split("").join(" ")}`}
                >
                  {pairing.code}
                </p>
                <p className="mt-1 text-[12px] text-faint">
                  {qr ? "Or scan the square with the phone's camera. " : ""}Works once · {left > 0 ? `${mm}:${ss} left` : "expired"}
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center gap-2 rounded-lg bg-ink px-3 py-2.5 text-[13px] text-muted">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
              Waiting for the phone…
            </div>
            <p className="mt-3 text-[12px] text-faint">
              If the app asks for a server, use <span className="text-muted">{pairing.server}</span>.
            </p>
          </div>
        ) : null}

        {step === "done" ? (
          <div className="mt-8 text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-ok/15 text-ok">
              <CheckIcon width={22} height={22} />
            </span>
            <p className="mt-4 text-[16px] font-medium text-text">{deviceName} is signed in</p>
            <p className="mt-1 text-[13px] text-muted">
              Answer your agents, approve actions and hand out tasks from anywhere.
            </p>
            <Button className="mt-6" variant="primary" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : null}

        {step === "expired" ? (
          <div className="mt-8 text-center">
            <p className="text-[15px] text-text">That code expired.</p>
            <Button className="mt-4" variant="primary" disabled={pending} onClick={showCode}>
              Show a new code
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
