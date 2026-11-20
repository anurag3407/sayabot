"use client"

import { useEffect, useState } from "react"
import { Button, type ButtonProps } from "@/components/ui/button"

const RESET_AFTER_MS = 8_000

/** A two-step button for actions that are hard to undo: the first click only asks. */
export function ConfirmButton({
  label,
  confirmLabel,
  pendingLabel,
  warning,
  onConfirm,
  pending = false,
  disabled = false,
  size = "sm",
  variant = "danger",
  className,
  submit = false,
}: {
  label: string
  confirmLabel: string
  pendingLabel?: string
  warning?: string
  onConfirm?: () => void
  pending?: boolean
  disabled?: boolean
  size?: ButtonProps["size"]
  variant?: ButtonProps["variant"]
  className?: string
  /** Render the confirm step as a form submit button instead of calling onConfirm. */
  submit?: boolean
}) {
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming || pending) return
    const timer = window.setTimeout(() => setConfirming(false), RESET_AFTER_MS)
    return () => window.clearTimeout(timer)
  }, [confirming, pending])

  if (!confirming) {
    return (
      <Button
        size={size}
        variant={variant}
        className={className}
        disabled={disabled || pending}
        onClick={() => setConfirming(true)}
      >
        {label}
      </Button>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      {warning ? (
        <span className="max-w-xs text-[12px] leading-snug text-warn">{warning}</span>
      ) : null}
      <Button
        size={size}
        variant="danger"
        type={submit ? "submit" : "button"}
        autoFocus
        disabled={pending}
        onClick={submit ? undefined : onConfirm}
      >
        {pending ? (pendingLabel ?? "Working…") : confirmLabel}
      </Button>
      <Button size={size} variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  )
}
